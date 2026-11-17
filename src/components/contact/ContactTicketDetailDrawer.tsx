import React, { useState } from 'react';
import { Ticket } from '../../types';
import { useApp } from '../../context/AppContext';
import { StatusAgentBadge, StatusInstallerBadge, StatusWhatsAppBadge, StatusApprovalBadge } from '../common/Badge';
import { formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { buildGoogleMapsSearchUrl } from '../../services/mapsService';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import {
  X,
  User,
  Phone,
  MapPin,
  Calendar,
  Clock,
  Building2,
  Wrench,
  Cpu,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
  MessageSquare,
  AlertCircle,
  Activity,
  FileText,
  Copy,
  Check
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';

interface ContactTicketDetailDrawerProps {
  ticket: Ticket;
  isOpen: boolean;
  onClose: () => void;
  onOpenFullModal?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

const hasValue = (val: unknown): boolean => {
  if (val === undefined || val === null) return false;
  const str = String(val).trim();
  return str !== '' && str !== '-' && str !== 'null' && str !== 'undefined';
};

export const ContactTicketDetailDrawer: React.FC<ContactTicketDetailDrawerProps> = ({
  ticket,
  isOpen,
  onClose,
  onOpenFullModal,
  onOpenWhatsApp
}) => {
  const { currentUser, approveProgressReport, rejectProgressReport } = useApp();
  const { toast } = useToast();

  const [approvalMode, setApprovalMode] = useState<'none' | 'approve' | 'reject'>('none');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);

  if (!isOpen) return null;

  const handleCopySummary = async () => {
    const summaryText = [
      `WO: ${ticket.woNumber} (ID: ${ticket.idCustomer || ticket.customerId || '-'})`,
      `Pelanggan: ${ticket.customerName} (${ticket.customerPhone || '-'})`,
      `Lokasi: ${ticket.clusterName ? `[${ticket.clusterName}] ` : ''}${ticket.address || ticket.streetName || '-'}`,
      `Slot: ${ticket.slotTime || '-'} | Teknisi: ${ticket.installerName || '-'}`,
      `OLT/FAT: ${ticket.oltCode || '-'} / ${ticket.fatCode || '-'}${ticket.fatPort ? ` (${ticket.fatPort})` : ''}`,
      `Redaman OPM: ${ticket.rosetRedamanDbm ?? ticket.technicalReport?.opticalPowerRx ?? '-'} dBm | SN: ${ticket.ontSerialNumber || '-'}`
    ].join('\n');
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopiedSummary(true);
      toast.success(`Rekap singkat ${ticket.woNumber} berhasil disalin.`, 'Rekap Disalin');
      setTimeout(() => setCopiedSummary(false), 1800);
    } catch {
      toast.error('Gagal menyalin rekap WO.');
    }
  };

  const canApproveOrReject =
    (currentUser?.role === 'dispatch' || currentUser?.role === 'super_admin') &&
    ticket.approvalStatus === 'BUTUH APPROVAL';

  const mapsInfo = buildGoogleMapsSearchUrl(ticket);
  const coordsUrl =
    ticket.latitude && ticket.longitude
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${ticket.latitude},${ticket.longitude}`)}`
      : mapsInfo.url;

  const latestProgressReport =
    ticket.progressReports && ticket.progressReports.length > 0
      ? ticket.progressReports[ticket.progressReports.length - 1]
      : null;

  const handleConfirmApprove = async () => {
    if (isProcessing || !canApproveOrReject) return;
    setIsProcessing(true);
    try {
      const res = await approveProgressReport(ticket.id, approvalNotes.trim());
      if (res?.success) {
        setApprovalMode('none');
        setApprovalNotes('');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmReject = async () => {
    if (isProcessing || !canApproveOrReject || !rejectReason.trim()) return;
    setIsProcessing(true);
    try {
      const res = await rejectProgressReport(ticket.id, rejectReason.trim());
      if (res?.success) {
        setApprovalMode('none');
        setRejectReason('');
      }
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      {/* Mobile / Narrow Viewport Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-xs xl:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        aria-label="Detail Tiket Work Order"
        data-testid="contact-ticket-detail-drawer"
        className="fixed xl:static inset-y-0 right-0 z-50 xl:z-auto w-full max-w-[390px] xl:w-[390px] bg-white dark:bg-[#1A0E2E] border-l border-[#E9E5F0] dark:border-[#35105E] flex flex-col shrink-0 shadow-2xl h-full overflow-hidden"
      >
        {/* Drawer Header */}
        <div className="px-4 py-3.5 bg-[#F0E3FF] dark:bg-[#22123F] border-b border-[#E9E5F0] dark:border-[#35105E] flex items-center justify-between gap-2 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#58149C] dark:text-[#D8B4FE] shrink-0" />
              <span className="font-mono font-bold text-sm text-[#35105E] dark:text-[#D8B4FE] truncate">
                {ticket.woNumber}
              </span>
              {hasValue(ticket.ticketCategory) && (
                <span className="px-2 py-0.5 rounded bg-[#431599] text-white text-[10px] font-bold uppercase tracking-wide shrink-0">
                  {ticket.ticketCategory}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[#494453] dark:text-[#CEC0E8] truncate mt-0.5">
              Data Lembar Kerja & Verifikasi · Shift + D
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup Detail Tiket"
            className="btn-3d-icon w-8 h-8 rounded-lg cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Status Matrix Summary */}
          <section className="p-3 rounded-xl bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] space-y-2.5">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA]">
              Matriks Status 4-Dimensi
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusAgentBadge status={ticket.statusWOAgent} />
              <StatusInstallerBadge status={ticket.statusWOInstaller} />
              <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
              <StatusApprovalBadge status={ticket.approvalStatus} />
            </div>
          </section>

          {/* Dispatch Approval Quick Action Box */}
          {ticket.approvalStatus === 'BUTUH APPROVAL' && (
            <section className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-2.5">
              <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Laporan Teknisi Menunggu Approval Dispatch</span>
              </div>

              {latestProgressReport && (
                <div className="text-[11px] text-amber-800 dark:text-amber-300 space-y-1">
                  <div>
                    Status Report: <strong>{latestProgressReport.reportStatus}</strong>
                  </div>
                  {hasValue(latestProgressReport.reasonReport) && (
                    <div>Reason: {latestProgressReport.reasonReport}</div>
                  )}
                  {hasValue(latestProgressReport.rootCause) && (
                    <div>Root Cause: {latestProgressReport.rootCause}</div>
                  )}
                  {hasValue(latestProgressReport.remarksReport) && (
                    <div className="p-2 rounded-lg bg-white/70 dark:bg-[#160D29]/60 italic text-[#211A2E] dark:text-[#E9D5FF]">
                      "{latestProgressReport.remarksReport}"
                    </div>
                  )}
                </div>
              )}

              {canApproveOrReject && approvalMode === 'none' && (
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setApprovalMode('approve')}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#16A36A] hover:bg-emerald-700 text-white font-bold text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>Setujui</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setApprovalMode('reject')}
                    className="flex-1 py-2 px-3 rounded-lg bg-[#DC4C5A] hover:bg-rose-700 text-white font-bold text-[11px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>Tolak / Revisi</span>
                  </button>
                </div>
              )}

              {canApproveOrReject && approvalMode === 'approve' && (
                <div className="space-y-2 pt-1">
                  <input
                    type="text"
                    value={approvalNotes}
                    onChange={e => setApprovalNotes(e.target.value)}
                    placeholder="Catatan approval (opsional)..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#160D29] border border-emerald-300 dark:border-emerald-800 text-xs text-[#211A2E] dark:text-white"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setApprovalMode('none')}
                      className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#22123F] border border-[#E9E5F0] dark:border-[#35105E] text-[#494453] dark:text-[#CEC0E8] font-semibold cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={isProcessing}
                      onClick={handleConfirmApprove}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-[#16A36A] hover:bg-emerald-700 disabled:opacity-50 text-white font-bold cursor-pointer"
                    >
                      {isProcessing ? 'Memproses...' : 'Konfirmasi Approve'}
                    </button>
                  </div>
                </div>
              )}

              {canApproveOrReject && approvalMode === 'reject' && (
                <div className="space-y-2 pt-1">
                  <input
                    type="text"
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    placeholder="Alasan penolakan / revisi wajib diisi..."
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#160D29] border border-rose-300 dark:border-rose-800 text-xs text-[#211A2E] dark:text-white"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setApprovalMode('none')}
                      className="px-3 py-1.5 rounded-lg bg-white dark:bg-[#22123F] border border-[#E9E5F0] dark:border-[#35105E] text-[#494453] dark:text-[#CEC0E8] font-semibold cursor-pointer"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={isProcessing || !rejectReason.trim()}
                      onClick={handleConfirmReject}
                      className="flex-1 py-1.5 px-3 rounded-lg bg-[#DC4C5A] hover:bg-rose-700 disabled:opacity-50 text-white font-bold cursor-pointer"
                    >
                      {isProcessing ? 'Memproses...' : 'Kirim Revisi'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Customer Information */}
          <section className="space-y-2 pb-3 border-b border-[#E9E5F0] dark:border-[#35105E]">
            <div className="flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA]">
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#7135B5]" />
                <span>Pelanggan & Lokasi</span>
              </span>
              <span className="font-mono text-[#431599] dark:text-[#D8B4FE]">
                ID: {ticket.idCustomer || ticket.customerId || '-'}
              </span>
            </div>
            <div className="font-bold text-sm text-[#211A2E] dark:text-white">
              {ticket.customerName}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[#494453] dark:text-[#CEC0E8]">
                {ticket.customerPhone || '-'}
              </span>
              <div className="flex items-center gap-1.5">
                {hasValue(ticket.customerPhone) && (
                  <a
                    href={`tel:${ticket.customerPhone}`}
                    className="px-2 py-1 rounded-lg bg-[#F7F6FA] dark:bg-[#22123F] border border-[#E9E5F0] dark:border-[#35105E] text-[#211A2E] dark:text-white hover:bg-[#F4EAFF] font-semibold text-[11px] inline-flex items-center gap-1"
                  >
                    <Phone className="w-3 h-3 text-[#7135B5]" />
                    <span>Call</span>
                  </a>
                )}
                {onOpenWhatsApp && (
                  <button
                    type="button"
                    onClick={() => onOpenWhatsApp(ticket)}
                    className="px-2 py-1 rounded-lg bg-[#16A36A] hover:bg-emerald-700 text-white font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <MessageSquare className="w-3 h-3" />
                    <span>WhatsApp</span>
                  </button>
                )}
              </div>
            </div>
            {(hasValue(ticket.address) || hasValue(ticket.streetName) || hasValue(ticket.clusterName)) && (
              <div className="flex items-start gap-1.5 text-[11.5px] text-[#494453] dark:text-[#CEC0E8] pt-1">
                <MapPin className="w-3.5 h-3.5 text-[#DC4C5A] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  {hasValue(ticket.clusterName) && (
                    <span className="font-semibold text-[#211A2E] dark:text-white">
                      [{ticket.clusterName}]{' '}
                    </span>
                  )}
                  <span>{ticket.address || ticket.streetName}</span>
                  {hasValue(ticket.area) && (
                    <div className="text-[11px] text-[#766B83] dark:text-[#A78BFA] mt-0.5">
                      Area: {ticket.area} {hasValue(ticket.city) ? `· ${ticket.city}` : ''}
                    </div>
                  )}
                  {coordsUrl && (
                    <a
                      href={coordsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#3977C9] hover:underline mt-1"
                    >
                      <span>Buka di Google Maps</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Appointment & Team */}
          <section className="space-y-2.5 pb-3 border-b border-[#E9E5F0] dark:border-[#35105E]">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA] flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-[#E59A27]" />
              <span>Jadwal & Tim Penugasan</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="text-[10px] text-[#766B83] dark:text-[#8B8495]">Appointment</div>
                <div className="font-semibold text-[#211A2E] dark:text-white mt-0.5 tabular-nums">
                  {formatAppointmentDateDisplay(ticket.appointmentDate)}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="text-[10px] text-[#766B83] dark:text-[#8B8495]">Slot Waktu</div>
                <div className="font-semibold text-[#211A2E] dark:text-white mt-0.5 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-[#E59A27]" />
                  <span className="truncate">{ticket.slotTime || '-'}</span>
                </div>
              </div>
            </div>

            <div className="space-y-1.5 text-[11.5px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#766B83] dark:text-[#8B8495] flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" /> Mitra
                </span>
                <span className="font-semibold text-[#211A2E] dark:text-white text-right truncate">
                  {ticket.contactorName || ticket.contractorName || '-'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#766B83] dark:text-[#8B8495]">Korlap / Leader</span>
                <span className="font-medium text-[#211A2E] dark:text-[#E9D5FF] text-right truncate">
                  {ticket.leaderName || '-'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#766B83] dark:text-[#8B8495] flex items-center gap-1">
                  <Wrench className="w-3.5 h-3.5 text-[#16A36A]" /> Teknisi
                </span>
                <span className="font-bold text-[#16A36A] dark:text-emerald-400 text-right truncate">
                  {ticket.installerName || 'Belum Ditugaskan'}
                </span>
              </div>
            </div>
          </section>

          {/* Work Session & Check-in / Check-out */}
          <section className="space-y-2 pb-3 border-b border-[#E9E5F0] dark:border-[#35105E]">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA] flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[#3977C9]" />
              <span>Progres Check-in & Durasi</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="text-[10px] text-[#766B83] dark:text-[#8B8495]">Check-in</div>
                <div className="font-mono font-bold text-[#211A2E] dark:text-white mt-0.5 tabular-nums">
                  {ticket.checkInAt ? formatJakartaTimeOnly(ticket.checkInAt) : '-'}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="text-[10px] text-[#766B83] dark:text-[#8B8495]">Check-out</div>
                <div className="font-mono font-bold text-[#211A2E] dark:text-white mt-0.5 tabular-nums">
                  {ticket.checkOutAt ? formatJakartaTimeOnly(ticket.checkOutAt) : '-'}
                </div>
              </div>
              <div className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="text-[10px] text-[#766B83] dark:text-[#8B8495]">Durasi</div>
                <div className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE] mt-0.5 tabular-nums">
                  {ticket.workDurationFormatted || '-'}
                </div>
              </div>
            </div>
          </section>

          {/* Network & Infrastructure */}
          {(hasValue(ticket.oltCode) ||
            hasValue(ticket.fdtCode) ||
            hasValue(ticket.fatCode) ||
            hasValue(ticket.ontSerialNumber) ||
            hasValue(ticket.serviceType)) && (
            <section className="space-y-2 pb-3 border-b border-[#E9E5F0] dark:border-[#35105E]">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA] flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-[#431599]" />
                <span>Infrastruktur Jaringan</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                {hasValue(ticket.serviceType) && (
                  <div className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                    <div className="text-[10px] text-[#766B83]">Layanan</div>
                    <div className="font-semibold text-[#211A2E] dark:text-white truncate">{ticket.serviceType}</div>
                  </div>
                )}
                {hasValue(ticket.fatCode) && (
                  <div className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                    <div className="text-[10px] text-[#766B83]">FAT / Port</div>
                    <div className="font-mono font-semibold text-[#211A2E] dark:text-white truncate">
                      {ticket.fatCode} {hasValue(ticket.fatPort) ? `(${ticket.fatPort})` : ''}
                    </div>
                  </div>
                )}
                {hasValue(ticket.oltCode) && (
                  <div className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                    <div className="text-[10px] text-[#766B83]">OLT</div>
                    <div className="font-mono font-semibold text-[#211A2E] dark:text-white truncate">{ticket.oltCode}</div>
                  </div>
                )}
                {hasValue(ticket.fdtCode) && (
                  <div className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                    <div className="text-[10px] text-[#766B83]">FDT</div>
                    <div className="font-mono font-semibold text-[#211A2E] dark:text-white truncate">{ticket.fdtCode}</div>
                  </div>
                )}
                {hasValue(ticket.ontSerialNumber) && (
                  <div className="col-span-2 p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                    <div className="text-[10px] text-[#766B83]">ONT SN / MAC</div>
                    <div className="font-mono font-semibold text-[#211A2E] dark:text-white truncate">
                      {ticket.ontSerialNumber} {hasValue(ticket.ontMacAddress) ? `· ${ticket.ontMacAddress}` : ''}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Technical Report Snapshot */}
          {ticket.technicalReport && (
            <section className="space-y-2">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#766B83] dark:text-[#A78BFA] flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#16A36A]" />
                <span>Ringkasan Technical Report</span>
              </div>
              <div className="p-3 rounded-xl bg-[#ECFDF5]/60 dark:bg-emerald-950/30 border border-[#16A36A]/30 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[#494453] dark:text-[#CEC0E8]">Redaman Rx:</span>
                  <span className="font-mono font-bold text-[#16A36A] dark:text-emerald-300">
                    {ticket.technicalReport.opticalPowerRx || '-'} dBm
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#494453] dark:text-[#CEC0E8]">Hasil:</span>
                  <span className="font-semibold text-[#211A2E] dark:text-white">
                    {ticket.technicalReport.workResult || '-'}
                  </span>
                </div>
                {hasValue(ticket.technicalReport.technicalDescription) && (
                  <p className="text-[11px] text-[#494453] dark:text-[#CEC0E8] pt-1 border-t border-[#16A36A]/20">
                    {ticket.technicalReport.technicalDescription}
                  </p>
                )}
              </div>
            </section>
          )}

          {ticket.approvalStatus === 'APPROVED' && (
            <div className="p-3 rounded-xl bg-[#ECFDF5] dark:bg-emerald-950/40 border border-[#16A36A]/30 flex items-center gap-2 text-[#15803D] dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="text-[11px] font-semibold">
                Laporan telah disetujui oleh {ticket.approvedBy || 'Dispatch'}.
              </span>
            </div>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-3.5 bg-[#F9F0FF] dark:bg-[#160D29] border-t border-[#E9E5F0] dark:border-[#35105E] flex flex-col gap-2 shrink-0">
          {onOpenFullModal ? (
            <button
              type="button"
              onClick={() => onOpenFullModal(ticket, 'overview')}
              className="btn-3d-primary w-full py-2.5 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Buka Detail Tiket Lengkap</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="btn-3d-primary w-full py-2.5 px-4 rounded-xl font-bold text-xs cursor-pointer"
            >
              Tutup Drawer
            </button>
          )}
          <button
            type="button"
            onClick={handleCopySummary}
            className="btn-3d-secondary w-full py-2 px-4 rounded-xl font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {copiedSummary ? (
              <Check className="w-3.5 h-3.5 text-[#16A36A]" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-[#58149C] dark:text-[#D8B4FE]" />
            )}
            <span>{copiedSummary ? 'Ringkasan Disalin' : 'Salin Rekap Log Tiket'}</span>
          </button>
        </div>
      </aside>
    </>
  );
};
