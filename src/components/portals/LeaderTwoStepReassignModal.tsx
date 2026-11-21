import React, { useMemo, useState, useEffect } from 'react';
import {
  ArrowRight,
  ArrowRightLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  MapPin,
  MessageSquare,
  Phone,
  Radio,
  Search,
  ShieldCheck,
  Users,
  Wrench,
  ChevronLeft
} from 'lucide-react';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { Ticket, User } from '../../types/index.ts';
import {
  LeaderQuotaConfig,
  TechnicianCapacitySummary
} from '../../services/leaderQuotaService';
import { formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { getTicketWorkStatus, formatJakartaTimeOnly } from '../../services/workSessionService';

interface LeaderTwoStepReassignModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: Ticket | null;
  technicians: TechnicianCapacitySummary[];
  quotaConfig: LeaderQuotaConfig;
  currentUser: User;
  displayContractor: string;
  displayArea: string;
  isLeaderRole: boolean;
  isSubmitting: boolean;
  onConfirmReassign: (payload: {
    ticket: Ticket;
    targetInstallerName: string;
    reason: string;
    prepareWhatsAppNotice: boolean;
  }) => Promise<void> | void;
}

type CandidateFilterMode = 'all' | 'available' | 'standby' | 'same_area';

const REASON_PRESETS = [
  'Kendala alat / armada teknisi di lapangan',
  'Pemerataan beban kuota harian tim',
  'Teknisi pengganti lebih dekat ke cluster/ODP',
  'Teknisi sebelumnya berhalangan mendadak'
];

function getInitials(name?: string): string {
  const parts = String(name || 'TK').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TK';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const LeaderTwoStepReassignModal: React.FC<LeaderTwoStepReassignModalProps> = ({
  isOpen,
  onClose,
  ticket,
  technicians,
  quotaConfig,
  currentUser,
  displayContractor,
  displayArea,
  isLeaderRole,
  isSubmitting,
  onConfirmReassign
}) => {
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [targetInstallerName, setTargetInstallerName] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [candidateSearch, setCandidateSearch] = useState<string>('');
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilterMode>('all');
  const [prepareWhatsAppNotice, setPrepareWhatsAppNotice] = useState<boolean>(true);
  const [validationError, setValidationError] = useState<string>('');

  // Reset internal modal state when opening a new ticket
  useEffect(() => {
    if (isOpen && ticket?.id) {
      setStep('form');
      setTargetInstallerName('');
      setReason('');
      setCandidateSearch('');
      setCandidateFilter('all');
      setPrepareWhatsAppNotice(true);
      setValidationError('');
    }
  }, [isOpen, ticket?.id]);

  const currentInstallerSummary = useMemo(() => {
    if (!ticket?.installerName) return undefined;
    const key = ticket.installerName.toLowerCase().trim();
    return technicians.find(t => t.installer.name.toLowerCase().trim() === key);
  }, [technicians, ticket?.installerName]);

  const candidatePool = useMemo(() => {
    const currentKey = String(ticket?.installerName || '').toLowerCase().trim();
    return technicians
      .filter(item => {
        if (!item.installer.active || item.installer.isArchived) return false;
        return item.installer.name.toLowerCase().trim() !== currentKey;
      })
      .sort((a, b) => {
        if (a.isFull !== b.isFull) return a.isFull ? 1 : -1;
        if (a.assignedCount !== b.assignedCount) return a.assignedCount - b.assignedCount;
        return a.installer.name.localeCompare(b.installer.name);
      });
  }, [technicians, ticket?.installerName]);

  const filteredCandidates = useMemo(() => {
    const q = candidateSearch.trim().toLowerCase();
    const woCluster = String(ticket?.clusterName || '').trim().toLowerCase();
    const woArea = String(ticket?.area || '').trim().toLowerCase();

    return candidatePool.filter(item => {
      if (q) {
        const matchName = item.installer.name.toLowerCase().includes(q);
        const matchArea = String(item.installer.area || '').toLowerCase().includes(q);
        const matchCluster = String(item.installer.clusterName || '').toLowerCase().includes(q);
        const matchPhone = String(item.installer.phone || '').toLowerCase().includes(q);
        if (!matchName && !matchArea && !matchCluster && !matchPhone) return false;
      }

      if (candidateFilter === 'available' && item.isFull) return false;
      if (candidateFilter === 'standby' && item.liveTone !== 'standby') return false;
      if (candidateFilter === 'same_area') {
        const instArea = String(item.installer.area || '').toLowerCase();
        const instCluster = String(item.installer.clusterName || '').toLowerCase();
        const matchesCluster = woCluster && instCluster && (instCluster.includes(woCluster) || woCluster.includes(instCluster));
        const matchesArea = woArea && instArea && (instArea.includes(woArea) || woArea.includes(instArea));
        if (!matchesCluster && !matchesArea) return false;
      }

      return true;
    });
  }, [candidatePool, candidateSearch, candidateFilter, ticket?.clusterName, ticket?.area]);

  const selectedCandidate = useMemo(() => {
    if (!targetInstallerName) return undefined;
    return candidatePool.find(c => c.installer.name === targetInstallerName);
  }, [candidatePool, targetInstallerName]);

  const workStatus = ticket ? getTicketWorkStatus(ticket) : null;
  const opmValue =
    ticket?.technicalReport?.opticalPowerDbm ||
    ticket?.technicalReport?.opticalPowerRx ||
    ticket?.rosetRedamanDbm ||
    ticket?.fatRedamanDbm;

  const isReasonValid = reason.trim().length >= 5;
  const isTargetValid = Boolean(targetInstallerName && selectedCandidate);
  const isStrictBlocked = Boolean(
    selectedCandidate && quotaConfig.enforceStrictLimit && selectedCandidate.isFull
  );

  const handleGoToConfirm = () => {
    if (!isLeaderRole) {
      setValidationError('Hanya akun dengan peran Leader yang berwenang melakukan reassign teknisi.');
      return;
    }
    if (!isTargetValid) {
      setValidationError('Pilih teknisi pengganti dari daftar kandidat terlebih dahulu.');
      return;
    }
    if (isStrictBlocked) {
      setValidationError(
        `Kuota harian ${targetInstallerName} sudah penuh (${selectedCandidate?.assignedCount}/${selectedCandidate?.maxLimit} WO) dan Mode Pembatasan Ketat aktif.`
      );
      return;
    }
    if (!isReasonValid) {
      setValidationError('Masukkan alasan pengalihan tugas yang jelas (minimal 5 karakter).');
      return;
    }
    setValidationError('');
    setStep('confirm');
  };

  const handleFinalSubmit = async () => {
    if (!ticket || !selectedCandidate || !isReasonValid || isStrictBlocked) return;
    await onConfirmReassign({
      ticket,
      targetInstallerName: selectedCandidate.installer.name,
      reason: reason.trim(),
      prepareWhatsAppNotice
    });
  };

  if (!ticket) return null;

  const currentObstacles =
    ticket.remarksWOInstaller?.trim() ||
    ticket.remarksAgent?.trim() ||
    ticket.reassignmentReason?.trim() ||
    '';

  const modalTitle =
    step === 'form' ? 'Reassign Work Order' : 'Konfirmasi Pengalihan Work Order';
  const modalSubtitle =
    step === 'form'
      ? `Penugasan ulang teknisi untuk ${ticket.woNumber} (${displayContractor})`
      : 'Verifikasi transfer tanggung jawab lapangan sebelum disimpan ke riwayat audit';

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      size="xl"
      mobileVariant="sheet"
      zIndexClass="z-60"
      icon={<ArrowRightLeft className="w-4 h-4" />}
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{modalTitle}</span>
          <span className="px-2 py-0.5 rounded-lg bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] font-mono text-xs font-extrabold">
            {ticket.woNumber}
          </span>
        </span>
      }
      subtitle={modalSubtitle}
      headerExtra={
        <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white dark:bg-[#261942] border border-[#E8DDFF] dark:border-[#4B386B] text-[10.5px] font-bold">
          <span
            className={`px-2 py-0.5 rounded-md ${
              step === 'form'
                ? 'bg-[#58149C] text-white'
                : 'bg-[#DCFCE7] dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-300'
            }`}
          >
            1. Pilih Teknisi
          </span>
          <ArrowRight className="w-3 h-3 text-[#7D7484]" />
          <span
            className={`px-2 py-0.5 rounded-md ${
              step === 'confirm'
                ? 'bg-[#58149C] text-white'
                : 'text-[#7D7484] dark:text-[#A79BC0]'
            }`}
          >
            2. Konfirmasi
          </span>
        </div>
      }
      footer={
        step === 'form' ? (
          <div className="w-full flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="mj-btn-leader-neutral min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
            >
              Batal
            </button>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {selectedCandidate && (
                <span className="text-[11px] font-medium text-[#4B4452] dark:text-[#CEC0E8] text-center sm:text-right">
                  Tujuan:{' '}
                  <strong className="text-[#58149C] dark:text-[#DAB9FF]">
                    {selectedCandidate.installer.name}
                  </strong>
                </span>
              )}
              <button
                type="button"
                disabled={!isLeaderRole || !isTargetValid || !isReasonValid || isStrictBlocked}
                onClick={handleGoToConfirm}
                className="mj-btn-leader-primary min-h-[44px] sm:min-h-[40px] px-5 py-2 rounded-xl text-xs font-extrabold flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Lanjut ke Konfirmasi</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setStep('form')}
              className="mj-btn-leader-neutral min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Kembali / Ubah Teknisi</span>
            </button>

            <button
              type="button"
              disabled={isSubmitting || !isLeaderRole || !isTargetValid || !isReasonValid || isStrictBlocked}
              onClick={handleFinalSubmit}
              className={`mj-btn-leader-primary min-h-[44px] sm:min-h-[40px] px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wide flex items-center justify-center gap-2 cursor-pointer ${
                isSubmitting ? 'mj-btn-loading' : ''
              }`}
            >
              <ArrowRightLeft className={`w-4 h-4 ${isSubmitting ? 'animate-spin' : ''}`} />
              <span>{isSubmitting ? 'Menyimpan Pengalihan...' : 'Confirm Reassignment'}</span>
            </button>
          </div>
        )
      }
    >
      {step === 'form' ? (
        <div className="space-y-4 text-xs">
          {/* WO Context Header Banner */}
          <div className="p-3.5 sm:p-4 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#58149C] text-white font-bold text-[11px]">
                  <Wrench className="w-3 h-3" />
                  <span>{ticket.ticketCategory || 'Work Order'}</span>
                </span>
                <span
                  className={`px-2.5 py-1 rounded-lg text-[10.5px] font-bold border ${
                    ticket.statusWOInstaller === 'Pending Technical' ||
                    ticket.statusWOInstaller === 'Failed / Cancelled'
                      ? 'bg-[#FFDAD6] dark:bg-rose-950/60 border-[#FCA5A5] dark:border-rose-800 text-[#93000A] dark:text-rose-300'
                      : 'bg-white dark:bg-[#261942] border-[#D8CCF3] dark:border-[#4B386B] text-[#58149C] dark:text-[#DAB9FF]'
                  }`}
                >
                  {ticket.statusWOInstaller || 'Assigned'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-[#261942] border border-[#E8DDFF] dark:border-[#4B386B] text-[11px] font-mono font-bold text-[#1F1638] dark:text-[#F5EEFF] tabular-nums">
                <Clock className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                <span>
                  {formatAppointmentDateDisplay(ticket.appointmentDate)} · {ticket.slotTime || '-'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[#E8DDFF] dark:border-[#35105E]">
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                  Pelanggan
                </span>
                <span className="font-bold text-[#1F1638] dark:text-white block truncate mt-0.5">
                  {ticket.customerName}
                </span>
                <span className="font-mono text-[10.5px] text-[#58149C] dark:text-[#DAB9FF]">
                  ID: {ticket.idCustomer || '-'}
                </span>
              </div>

              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                  Alamat / Cluster &amp; Area
                </span>
                <span className="font-semibold text-[#1F1638] dark:text-slate-200 block truncate mt-0.5">
                  {ticket.clusterName || ticket.streetName || '-'}
                </span>
                <span className="text-[10.5px] text-[#4B4452] dark:text-[#CEC0E8] truncate block">
                  {ticket.area || displayArea}
                  {ticket.fatCode ? ` · FAT ${ticket.fatCode}` : ''}
                </span>
              </div>

              <div>
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                  Status Sesi &amp; Check-In
                </span>
                <span className="font-semibold text-[#1F1638] dark:text-slate-200 block mt-0.5">
                  {workStatus?.status || 'Belum Check-in'}
                </span>
                <span className="font-mono text-[10.5px] text-[#7D7484] dark:text-[#A79BC0] tabular-nums">
                  {ticket.checkInAt ? `Check-in ${formatJakartaTimeOnly(ticket.checkInAt)}` : 'Belum ada Check-in'}
                </span>
              </div>
            </div>
          </div>

          {validationError && (
            <div className="p-3 rounded-xl bg-[#FFDAD6] dark:bg-rose-950/60 border border-[#FCA5A5] dark:border-rose-800 text-[#93000A] dark:text-rose-200 flex items-start gap-2 font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{validationError}</span>
            </div>
          )}

          {/* 2-Column Split */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* LEFT COLUMN: Current Tech + Obstacles + Optical Telemetry + History */}
            <div className="lg:col-span-5 space-y-3">
              <div className="p-3.5 rounded-2xl bg-white dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                    Teknisi Saat Ini (Asal)
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FEF3C7] dark:bg-amber-950/60 text-[#B45309] dark:text-amber-300 border border-[#FCD34D] dark:border-amber-800">
                    {ticket.statusWOInstaller || 'Assigned'}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] font-display font-extrabold text-sm flex items-center justify-center shrink-0">
                    {getInitials(ticket.installerName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm text-[#1F1638] dark:text-white truncate">
                      {ticket.installerName || 'Belum Ditugaskan'}
                    </div>
                    <div className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                      {currentInstallerSummary && (
                        <span className="font-mono font-bold tabular-nums">
                          Beban: {currentInstallerSummary.assignedCount}/{currentInstallerSummary.maxLimit} WO
                        </span>
                      )}
                      {currentInstallerSummary?.installer.phone && (
                        <span className="font-mono text-[#7D7484] dark:text-[#A79BC0]">
                          · {currentInstallerSummary.installer.phone}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[#F8F1FF] dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F]">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0] mb-1">
                    Catatan / Kendala Lapangan
                  </span>
                  <p className="text-[11px] text-[#1F1638] dark:text-slate-200 leading-relaxed">
                    {currentObstacles || 'Tidak ada catatan kendala khusus yang tercatat pada tiket.'}
                  </p>
                </div>
              </div>

              {/* Dark Purple Optical Trace & Network Card (100% Real Ticket Fields) */}
              <div className="p-3.5 rounded-2xl bg-[#160D29] text-white border border-[#35105E] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-[#DAB9FF]">
                    <Radio className="w-3.5 h-3.5" />
                    <span>Data Jaringan &amp; OPM</span>
                  </span>
                  <span className="font-mono text-[10px] text-[#A78BFA]">
                    {ticket.oltCode || ticket.fdtCode || 'FTTH NODE'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-[10px] text-[#CEC0E8]/75 block">Redaman OPM</span>
                    <strong className="font-mono font-bold text-sm text-white tabular-nums">
                      {opmValue ? `${opmValue} dBm` : 'Belum diukur'}
                    </strong>
                  </div>
                  <div className="p-2 rounded-xl bg-white/5 border border-white/10">
                    <span className="text-[10px] text-[#CEC0E8]/75 block">FDT / FAT Port</span>
                    <strong className="font-mono font-bold text-white truncate block">
                      {ticket.fatCode || ticket.fdtCode || '-'}
                      {ticket.fatPort ? ` / P${ticket.fatPort}` : ''}
                    </strong>
                  </div>
                </div>

                {(ticket.ontModel || ticket.dropcoreLength) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-[#CEC0E8] pt-1 border-t border-white/10">
                    <span>ONT: {ticket.ontModel || '-'}</span>
                    {ticket.dropcoreLength && (
                      <span className="font-mono">Dropcore: {ticket.dropcoreLength}m</span>
                    )}
                  </div>
                )}
              </div>

              {/* Existing Append-Only History */}
              {ticket.assignmentHistory && ticket.assignmentHistory.length > 0 && (
                <div className="p-3 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#58149C] dark:text-[#DAB9FF]">
                    <History className="w-3.5 h-3.5" />
                    <span>Riwayat Penugasan ({ticket.assignmentHistory.length})</span>
                  </div>
                  <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                    {ticket.assignmentHistory.map((h, idx) => (
                      <div
                        key={h.id || idx}
                        className="p-2 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] text-[10.5px]"
                      >
                        <div className="flex items-center justify-between gap-2 font-bold text-[#1F1638] dark:text-white">
                          <span className="truncate">
                            {h.previousInstallerName || h.previousInstaller || 'Unassigned'} &rarr;{' '}
                            {h.newInstallerName || h.assignedInstaller}
                          </span>
                          <span className="font-mono text-[9.5px] text-[#7D7484] shrink-0">
                            {new Date(h.timestamp).toLocaleTimeString('id-ID', {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </span>
                        </div>
                        {h.reason && (
                          <p className="text-[#4B4452] dark:text-[#CEC0E8] mt-0.5 line-clamp-2">
                            "{h.reason}" &mdash; {h.performedBy || h.leaderName}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Candidate Search, Filter Chips, Radio Cards, Audit Reason */}
            <div className="lg:col-span-7 space-y-3">
              <div className="p-3.5 rounded-2xl bg-white dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <label className="text-xs font-extrabold text-[#1F1638] dark:text-white flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />
                    <span>Pilih Teknisi Pengganti ({filteredCandidates.length} kandidat)</span>
                  </label>

                  <div className="relative flex-1 sm:max-w-[230px]">
                    <Search className="w-3.5 h-3.5 text-[#7D7484] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={candidateSearch}
                      onChange={e => setCandidateSearch(e.target.value)}
                      placeholder="Cari teknisi / area..."
                      className="tactile-debossed-input w-full pl-8 pr-3 py-1.5 min-h-[36px] rounded-xl bg-[#F8F1FF] dark:bg-[#1E1238] border border-[#D8CCF3] dark:border-[#4B386B] text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#58149C]"
                    />
                  </div>
                </div>

                {/* Candidate Filter Chips */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {[
                    { id: 'all' as const, label: `Semua (${candidatePool.length})` },
                    {
                      id: 'available' as const,
                      label: `Kuota Tersedia (${candidatePool.filter(c => !c.isFull).length})`
                    },
                    {
                      id: 'standby' as const,
                      label: `Standby (${candidatePool.filter(c => c.liveTone === 'standby').length})`
                    },
                    { id: 'same_area' as const, label: 'Area / Cluster Sama' }
                  ].map(chip => {
                    const active = candidateFilter === chip.id;
                    return (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setCandidateFilter(chip.id)}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap cursor-pointer ${
                          active
                            ? 'mj-btn-leader-secondary mj-btn-xs'
                            : 'mj-btn-leader-neutral mj-btn-xs'
                        }`}
                      >
                        {chip.label}
                      </button>
                    );
                  })}
                </div>

                {/* Candidate Radio List */}
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {filteredCandidates.length === 0 ? (
                    <div className="p-6 text-center rounded-xl bg-[#F8F1FF] dark:bg-[#1E1238] border border-dashed border-[#D8CCF3] dark:border-[#4B386B] text-[#7D7484] dark:text-[#CEC0E8]">
                      Tidak ada teknisi aktif yang cocok dengan filter kandidat saat ini.
                    </div>
                  ) : (
                    filteredCandidates.map(cand => {
                      const isSelected = targetInstallerName === cand.installer.name;
                      const isBlocked = quotaConfig.enforceStrictLimit && cand.isFull;
                      return (
                        <button
                          key={cand.installer.id}
                          type="button"
                          disabled={isBlocked}
                          onClick={() => {
                            setTargetInstallerName(cand.installer.name);
                            setValidationError('');
                          }}
                          className={`w-full text-left p-3 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                            isBlocked
                              ? 'opacity-55 cursor-not-allowed bg-slate-50 dark:bg-[#1E1238]/50 border-slate-200 dark:border-[#35105E]'
                              : isSelected
                              ? 'bg-[#F8F1FF] dark:bg-[#2E1B59] border-[#58149C] ring-2 ring-[#58149C]/25 cursor-pointer'
                              : 'bg-white dark:bg-[#1E1238] border-[#E8DDFF] dark:border-[#3E246F] hover:border-[#A380FE] cursor-pointer'
                          }`}
                        >
                          <div className="flex items-start gap-2.5 min-w-0 flex-1">
                            <div
                              className={`w-9 h-9 rounded-xl font-display font-extrabold text-xs flex items-center justify-center shrink-0 ${
                                isSelected
                                  ? 'bg-[#58149C] text-white'
                                  : 'bg-[#EEDBFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
                              }`}
                            >
                              {getInitials(cand.installer.name)}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-bold text-xs text-[#1F1638] dark:text-white truncate">
                                  {cand.installer.name}
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[9.5px] font-bold ${
                                    cand.liveTone === 'standby'
                                      ? 'bg-[#DCFCE7] dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-300'
                                      : cand.liveTone === 'onsite'
                                      ? 'bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF]'
                                      : cand.liveTone === 'enroute'
                                      ? 'bg-[#FEF3C7] dark:bg-amber-950/60 text-[#B45309] dark:text-amber-300'
                                      : 'bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
                                  }`}
                                >
                                  {cand.liveStatusLabel}
                                </span>
                              </div>

                              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10.5px] text-[#7D7484] dark:text-[#A79BC0] mt-1">
                                <span className="inline-flex items-center gap-1 truncate">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  {cand.installer.clusterName || cand.installer.area || displayArea}
                                </span>
                                {cand.installer.phone && (
                                  <span className="inline-flex items-center gap-1 font-mono">
                                    <Phone className="w-3 h-3 shrink-0" />
                                    {cand.installer.phone}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0 space-y-1">
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-mono font-extrabold tabular-nums ${
                                cand.isFull
                                  ? 'bg-[#FFDAD6] dark:bg-rose-950/70 text-[#93000A] dark:text-rose-300'
                                  : 'bg-[#DCFCE7] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-300'
                              }`}
                            >
                              {cand.assignedCount}/{cand.maxLimit} WO
                            </span>
                            <div className="text-[10px] font-semibold text-[#7D7484] dark:text-[#A79BC0] tabular-nums">
                              {cand.isFull
                                ? quotaConfig.enforceStrictLimit
                                  ? 'Kuota Penuh'
                                  : 'Melebihi Kuota'
                                : `Sisa ${cand.remainingSlots} slot`}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Reason Box with Presets */}
              <div className="p-3.5 rounded-2xl bg-white dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-2.5">
                <label className="block text-xs font-extrabold text-[#1F1638] dark:text-white">
                  Alasan Pengalihan Tugas / Audit Reason <span className="text-[#BA1A1A]">*</span>
                </label>

                <div className="flex flex-wrap gap-1.5">
                  {REASON_PRESETS.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setReason(preset);
                        setValidationError('');
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[10.5px] font-semibold cursor-pointer ${
                        reason === preset
                          ? 'mj-btn-leader-secondary mj-btn-xs'
                          : 'mj-btn-leader-neutral mj-btn-xs'
                      }`}
                    >
                      + {preset}
                    </button>
                  ))}
                </div>

                <textarea
                  rows={2}
                  value={reason}
                  onChange={e => {
                    setReason(e.target.value);
                    if (validationError) setValidationError('');
                  }}
                  placeholder="Tuliskan alasan operasional reassign minimal 5 karakter (tercatat di append-only history)..."
                  className="tactile-debossed-input w-full px-3 py-2 rounded-xl bg-[#F8F1FF] dark:bg-[#1E1238] border border-[#D8CCF3] dark:border-[#4B386B] text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#58149C]"
                />
                <div className="flex items-center justify-between text-[10.5px] text-[#7D7484] dark:text-[#A79BC0]">
                  <span>Wajib untuk jejak audit Leader &amp; riwayat WO.</span>
                  <span className={`font-mono tabular-nums ${isReasonValid ? 'text-[#16A36A] font-bold' : ''}`}>
                    {reason.trim().length}/5+ karakter
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* STEP 2: VISUAL CONFIRMATION MATRIX */
        <div className="space-y-4 text-xs">
          {/* Asal <-> Tujuan Transfer Matrix */}
          <div className="grid grid-cols-1 md:grid-cols-11 gap-3 items-stretch">
            {/* Previous Technician Card */}
            <div className="md:col-span-5 p-4 rounded-2xl bg-[#FFF8F6] dark:bg-rose-950/20 border border-[#FCA5A5]/70 dark:border-rose-900/50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#93000A] dark:text-rose-300">
                  Teknisi Asal (Dilepas)
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white dark:bg-[#261942] border border-[#FCA5A5] dark:border-rose-800 text-[#93000A] dark:text-rose-300">
                  {ticket.statusWOInstaller || 'Assigned'}
                </span>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <div className="w-10 h-10 rounded-xl bg-[#FFDAD6] dark:bg-rose-900/50 text-[#93000A] dark:text-rose-200 font-display font-extrabold text-xs flex items-center justify-center shrink-0">
                  {getInitials(ticket.installerName)}
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-sm text-[#1F1638] dark:text-white truncate">
                    {ticket.installerName}
                  </div>
                  <div className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] font-mono tabular-nums">
                    {currentInstallerSummary
                      ? `Beban saat ini: ${currentInstallerSummary.assignedCount}/${currentInstallerSummary.maxLimit} WO`
                      : displayArea}
                  </div>
                </div>
              </div>
            </div>

            {/* Center Swap Arrow */}
            <div className="md:col-span-1 flex items-center justify-center py-1">
              <div className="w-10 h-10 rounded-2xl bg-[#58149C] text-white flex items-center justify-center shadow-md">
                <ArrowRightLeft className="w-4 h-4" />
              </div>
            </div>

            {/* Target Technician Card */}
            <div className="md:col-span-5 p-4 rounded-2xl bg-[#F4FBF7] dark:bg-emerald-950/20 border border-[#86EFAC] dark:border-emerald-800/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#15803D] dark:text-emerald-300">
                  Teknisi Tujuan (Penerima)
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DCFCE7] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-300">
                  {selectedCandidate?.liveStatusLabel || 'Aktif'}
                </span>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <div className="w-10 h-10 rounded-xl bg-[#58149C] text-white font-display font-extrabold text-xs flex items-center justify-center shrink-0">
                  {getInitials(selectedCandidate?.installer.name)}
                </div>
                <div className="min-w-0">
                  <div className="font-extrabold text-sm text-[#1F1638] dark:text-white truncate">
                    {selectedCandidate?.installer.name}
                  </div>
                  <div className="text-[11px] text-[#15803D] dark:text-emerald-300 font-mono font-bold tabular-nums">
                    Proyeksi beban:{' '}
                    {selectedCandidate
                      ? `${selectedCandidate.assignedCount + 1}/${selectedCandidate.maxLimit} WO`
                      : '-'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Ticket & Audit Details Split */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#58149C] dark:text-[#DAB9FF]">
                  Detail Tiket Lapangan
                </span>
                <span className="text-[10.5px] font-bold text-[#4B4452] dark:text-[#CEC0E8]">
                  {ticket.ticketCategory}
                </span>
              </div>

              <div className="space-y-1 text-[#1F1638] dark:text-white">
                <div className="font-mono font-extrabold text-sm text-[#58149C] dark:text-[#DAB9FF]">
                  {ticket.woNumber}
                </div>
                <div className="font-bold">{ticket.customerName}</div>
                <div className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#58149C] dark:text-[#DAB9FF]" />
                  <span>
                    {ticket.streetName || ticket.clusterName || '-'} · {ticket.area || displayArea}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-[10px] text-[#7D7484] block">Jadwal &amp; Slot</span>
                  <strong className="font-mono tabular-nums">
                    {formatAppointmentDateDisplay(ticket.appointmentDate)} · {ticket.slotTime || '-'}
                  </strong>
                </div>
                <div>
                  <span className="text-[10px] text-[#7D7484] block">FDT / FAT Code</span>
                  <strong className="font-mono">
                    {ticket.fatCode || ticket.fdtCode || '-'}
                    {ticket.fatPort ? ` / Port ${ticket.fatPort}` : ''}
                  </strong>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#58149C] dark:text-[#DAB9FF]">
                  Audit &amp; Otorisasi Leader
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#DCFCE7] dark:bg-emerald-950/60 text-[#15803D] dark:text-emerald-300 text-[10px] font-bold">
                  <ShieldCheck className="w-3 h-3" />
                  <span>Leader Scope Verified</span>
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E8DDFF] dark:border-[#3E246F] space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#7D7484] block">
                  Alasan Pengalihan Tercatat
                </span>
                <p className="text-xs font-semibold text-[#1F1638] dark:text-white italic">
                  "{reason.trim()}"
                </p>
              </div>

              <div className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] space-y-1">
                <div className="flex items-center justify-between">
                  <span>Pelaksana Otorisasi:</span>
                  <strong className="text-[#1F1638] dark:text-white">
                    {currentUser.name} ({currentUser.role})
                  </strong>
                </div>
                <div className="flex items-center justify-between">
                  <span>Cakupan Mitra:</span>
                  <strong className="text-[#1F1638] dark:text-white">{displayContractor}</strong>
                </div>
              </div>
            </div>
          </div>

          {/* Preservation & Notification Callout */}
          <div className="p-3.5 rounded-2xl bg-[#EEDBFF]/55 dark:bg-[#261942] border border-[#D0BCFF] dark:border-[#4B386B] space-y-2.5">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold text-[#1F1638] dark:text-white">
                  Jaminan Integritas Data &amp; Notifikasi Penugasan
                </div>
                <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
                  Pengalihan teknisi mencatat log append-only pada <code className="font-mono">assignmentHistory</code> tanpa menghapus Check-in, LiveChat, Evidence, maupun versi Report yang sudah ada.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 pt-2 border-t border-[#D0BCFF]/70 dark:border-[#4B386B] cursor-pointer text-[11px] font-semibold text-[#1F1638] dark:text-[#F5EEFF]">
              <input
                type="checkbox"
                checked={prepareWhatsAppNotice}
                onChange={e => setPrepareWhatsAppNotice(e.target.checked)}
                className="w-4 h-4 accent-[#58149C] rounded cursor-pointer"
              />
              <MessageSquare className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
              <span>Siapkan pratinjau pesan WhatsApp untuk teknisi pengganti setelah konfirmasi</span>
            </label>
          </div>
        </div>
      )}
    </ResponsiveModal>
  );
};
