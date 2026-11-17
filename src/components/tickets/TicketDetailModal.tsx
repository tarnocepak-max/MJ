import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ticket } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { StatusApprovalBadge } from '../common/Badge';
import { TicketLiveChat } from '../chat/TicketLiveChat';
import { TechnicalReportForm } from './TechnicalReportForm';
import { HistoryProgressReportView } from '../reports/HistoryProgressReportView';
import {
  isTicketAssigned,
  isTicketCheckedIn,
  getTicketCanonicalReportStatus,
  getTicketCanonicalApprovalStatus,
  isTicketClosed as isLifecycleClosed
} from '../../services/woLifecycleService';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import { formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { ManagementDataDeleteModal } from '../portals/ManagementDataDeleteModal';
import {
  X,
  MessageSquare,
  Archive,
  RotateCcw,
  Trash2,
  Phone,
  MapPin,
  Clock,
  Calendar,
  Building2,
  Wrench,
  User,
  ShieldCheck,
  CheckCircle2,
  FileText,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Zap,
  Lock,
  Gauge,
  Network,
  Camera,
  ZoomIn,
  Save,
  Navigation,
  ArrowRight,
  Printer,
  History,
  ImageOff
} from 'lucide-react';

interface TicketDetailModalProps {
  ticket: Ticket | null;
  isOpen: boolean;
  onClose: () => void;
  onApprovedAndClosed?: () => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
  defaultTab?: 'overview' | 'report' | 'chat' | 'history';
}

interface EvidencePhotoItem {
  id: string;
  url: string;
  title: string;
  subtitle: string;
}

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  isOpen,
  onClose,
  onApprovedAndClosed,
  onOpenWhatsApp,
  defaultTab = 'overview'
}) => {
  const {
    currentUser,
    syncStatus,
    updateTicket,
    assignTicketPersonnel,
    closeTicket,
    reopenTicket,
    archiveTicket,
    restoreTicket,
    installersList,
    approveProgressReport,
    rejectProgressReport,
    getTicketUnreadCount,
    setTicketChatCategory,
    getMessagesForTicket,
    ticketActivities,
    toast
  } = useApp();
  const { isCompactUI } = useResponsiveViewport();

  // Dispatcher verification & decision state
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Close ticket banner state
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeNotes, setCloseNotes] = useState('');
  const [closeError, setCloseError] = useState<string | null>(null);

  // Reopen ticket banner state
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  // Delete confirm state (management_data exclusive)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Technical report editor & chat visibility
  const [showReportEditor, setShowReportEditor] = useState(defaultTab === 'report');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInitialCategory, setChatInitialCategory] = useState<string | undefined>(undefined);

  // Evidence lightbox & error fallback
  const [zoomPhoto, setZoomPhoto] = useState<EvidencePhotoItem | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const chatSectionRef = useRef<HTMLDivElement>(null);

  const unreadChatCount = ticket ? getTicketUnreadCount(ticket.id) : 0;

  useEffect(() => {
    if (!isOpen || !ticket) return;
    setShowCloseModal(false);
    setShowReopenModal(false);
    setDecisionError(null);
    setDecisionNotes(ticket.remarksAgent || '');
    setShowReportEditor(defaultTab === 'report');
    setChatInitialCategory(undefined);
    setZoomPhoto(null);
    setFailedImages({});

    // Respect unread preservation invariant:
    // If ticket has unread chat messages and user didn't explicitly open 'chat' tab, keep LiveChat folded until clicked.
    const initialUnread = getTicketUnreadCount(ticket.id);
    const openImmediately = defaultTab === 'chat' || initialUnread === 0;
    setIsChatOpen(openImmediately);

    if (defaultTab === 'chat') {
      const timer = setTimeout(() => {
        chatSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [isOpen, defaultTab, ticket?.id]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomPhoto) {
          setZoomPhoto(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, zoomPhoto, onClose]);

  const ticketMessages = useMemo(() => {
    if (!ticket) return [];
    return getMessagesForTicket(ticket.id);
  }, [ticket, getMessagesForTicket]);

  const relatedActivities = useMemo(() => {
    if (!ticket) return [];
    return (ticketActivities || [])
      .filter(a => a.ticketId === ticket.id || a.woNumber === ticket.woNumber)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [ticket, ticketActivities]);

  // Deduplicated real photo evidence from technicalReport, signature, and LiveChat image attachments
  const evidencePhotos = useMemo<EvidencePhotoItem[]>(() => {
    if (!ticket) return [];
    const seenUrls = new Set<string>();
    const items: EvidencePhotoItem[] = [];

    const pushPhoto = (url: string | undefined | null, title: string, subtitle: string, idPrefix: string) => {
      if (!url || typeof url !== 'string' || !url.trim()) return;
      const safe = getSafePreviewUrl(url.trim());
      if (!safe || seenUrls.has(safe)) return;
      seenUrls.add(safe);
      items.push({
        id: `${idPrefix}-${items.length + 1}`,
        url: safe,
        title,
        subtitle
      });
    };

    const tr = ticket.technicalReport;
    if (tr) {
      pushPhoto(tr.photoBeforeUrl, 'Foto Kondisi Awal', 'Technical Report (Before)', 'tr-before');
      pushPhoto(tr.photoAfterUrl, 'Foto Hasil & OPM', tr.opticalPowerRx || tr.opticalPowerDbm || 'Technical Report (After)', 'tr-after');
      if (Array.isArray(tr.photos)) {
        tr.photos.forEach((p, idx) => {
          pushPhoto(p, `Lampiran Teknis #${idx + 1}`, tr.deviceSerialNumber || 'Technical Report', `tr-photo-${idx}`);
        });
      }
    }

    pushPhoto(ticket.customerSignatureUrl, 'Tanda Tangan Pelanggan', 'Konfirmasi Instalasi', 'cust-sig');

    ticketMessages.forEach(msg => {
      if (!Array.isArray(msg.attachments)) return;
      msg.attachments.forEach((att, idx) => {
        if (!att.url) return;
        const mime = String(att.mimeType || '').toLowerCase();
        const isImg = mime.startsWith('image/') || att.url.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(att.url);
        if (!isImg) return;
        pushPhoto(
          att.url,
          att.fileName || `Bukti LiveChat #${idx + 1}`,
          `${msg.senderName} · ${msg.category || 'CHAT'}`,
          `chat-${att.id || idx}`
        );
      });
    });

    return items;
  }, [ticket, ticketMessages]);

  if (!isOpen || !ticket) return null;

  const hasValue = (val: unknown): boolean => {
    if (val === undefined || val === null) return false;
    const str = String(val).trim();
    return str !== '' && str !== '-' && str !== 'null' && str !== 'undefined';
  };

  const scrollToChat = () => {
    setIsChatOpen(true);
    setTimeout(() => {
      chatSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 80);
  };

  const handleCopyWO = async () => {
    try {
      await navigator.clipboard.writeText(ticket.woNumber);
      toast.success(`WO Number ${ticket.woNumber} disalin ke clipboard.`);
    } catch {
      toast.info(`WO Number: ${ticket.woNumber}`);
    }
  };

  const handleArchive = () => {
    if (ticket.isArchived) {
      restoreTicket(ticket.id);
    } else {
      archiveTicket(ticket.id);
    }
  };

  const handleConfirmCloseTicket = () => {
    setCloseError(null);
    const result = closeTicket(ticket.id, closeNotes);
    if (result.success) {
      setShowCloseModal(false);
      setCloseNotes('');
    } else {
      setCloseError(result.error || 'Gagal menutup tiket.');
    }
  };

  const handleConfirmReopen = () => {
    if (!reopenReason.trim()) return;
    reopenTicket(ticket.id, reopenReason.trim());
    setShowReopenModal(false);
    setReopenReason('');
  };

  const handleConfirmApprove = async () => {
    if (isApproving || ticket.approvalStatus !== 'BUTUH APPROVAL') return;
    setDecisionError(null);
    setIsApproving(true);
    const result = await approveProgressReport(ticket.id, decisionNotes.trim() || undefined);
    setIsApproving(false);
    if (result && result.success) {
      setDecisionNotes('');
      onClose();
      onApprovedAndClosed?.();
    } else if (result?.error) {
      setDecisionError(result.error);
    }
  };

  const handleConfirmReject = async () => {
    if (isRejecting) return;
    if (decisionNotes.trim().length < 3) {
      setDecisionError('Catatan pemeriksaan / alasan revisi wajib diisi minimal 3 karakter sebelum menolak laporan.');
      return;
    }
    setDecisionError(null);
    setIsRejecting(true);
    const res = await rejectProgressReport(ticket.id, decisionNotes.trim());
    setIsRejecting(false);
    if (res && !res.success && res.error) {
      setDecisionError(res.error);
    }
  };

  const handleSaveInternalNote = async () => {
    if (isSavingNote) return;
    setIsSavingNote(true);
    const res = updateTicket(ticket.id, { remarksAgent: decisionNotes.trim() }, 'Simpan catatan pemeriksaan dispatcher');
    setIsSavingNote(false);
    if (res && !res.success && res.error) {
      setDecisionError(res.error);
      toast.error(res.error, 'Gagal Menyimpan Catatan');
    } else {
      toast.success('Catatan pemeriksaan dispatcher berhasil disimpan.');
    }
  };

  const canManageApproval = currentUser.role === 'dispatch' || currentUser.role === 'super_admin';
  const canCloseTicket = canManageApproval && ticket.statusWOAgent !== 'Closed';
  const isTicketClosed = ticket.statusWOAgent === 'Closed';

  // Lifecycle steps (preserved 7-step MoraJaws contract)
  const lifecycleSteps = [
    { label: '1. Import', done: Boolean(ticket.createdAt), detail: ticket.appointmentDate || '-' },
    { label: '2. Distribusi', done: Boolean(ticket.leaderName), detail: ticket.leaderName || 'Unmapped' },
    { label: '3. Assign', done: isTicketAssigned(ticket), detail: ticket.installerName || 'Belum Assign' },
    { label: '4. Check-in', done: isTicketCheckedIn(ticket), detail: ticket.checkInAt ? 'PROGRESS' : 'Belum' },
    {
      label: '5. Report',
      done: getTicketCanonicalReportStatus(ticket) !== 'NONE',
      detail: getTicketCanonicalReportStatus(ticket) !== 'NONE' ? getTicketCanonicalReportStatus(ticket) : 'Belum'
    },
    {
      label: '6. Approval',
      done: getTicketCanonicalApprovalStatus(ticket) === 'APPROVED',
      detail: getTicketCanonicalApprovalStatus(ticket) !== 'NONE' ? getTicketCanonicalApprovalStatus(ticket) : '-'
    },
    { label: '7. Closed', done: isLifecycleClosed(ticket), detail: isLifecycleClosed(ticket) ? 'CLOSED' : 'Open' }
  ];
  const completedStepsCount = lifecycleSteps.filter(s => s.done).length;

  // Derived Telemetry Values (strictly from real fields)
  const latestProgress = ticket.progressReports?.[0];
  const rawOpmValue =
    ticket.technicalReport?.opticalPowerRx ||
    ticket.technicalReport?.opticalPowerDbm ||
    (hasValue(ticket.rosetRedamanDbm) ? `${ticket.rosetRedamanDbm}` : '');
  const numericOpm = rawOpmValue ? parseFloat(String(rawOpmValue).replace(/[^\d.-]/g, '')) : NaN;
  const isOpmValid = !Number.isNaN(numericOpm) && numericOpm <= -8 && numericOpm >= -25;

  const serialOnt =
    ticket.technicalReport?.deviceSerialNumber ||
    ticket.ontSerialNumber ||
    ticket.routerSerialNumber ||
    '';

  const dropcoreMeter = ticket.dropcoreLengthMeter ?? ticket.dropcoreLength;
  const fatLabel = ticket.fatCode || ticket.fat;

  const tier1Label =
    latestProgress?.reportStatusLabel ||
    latestProgress?.reportStatus ||
    ticket.reportStatusLabel ||
    ticket.technicalReport?.workResult ||
    ticket.statusWOInstaller ||
    '-';
  const tier2Label =
    latestProgress?.reasonReportLabel ||
    latestProgress?.reasonReport ||
    ticket.reasonReportLabel ||
    ticket.technicalReport?.mainCategory ||
    '-';
  const tier3Label =
    latestProgress?.rootcauseLabel ||
    latestProgress?.rootCause ||
    ticket.rootcauseLabel ||
    ticket.technicalReport?.rootCause ||
    '-';

  const topGradientBar =
    ticket.approvalStatus === 'BUTUH APPROVAL'
      ? 'from-[#E59A27] via-[#7135B5] to-[#16A36A]'
      : ticket.approvalStatus === 'APPROVED'
      ? 'from-[#10B981] via-[#16A36A] to-[#059669]'
      : ticket.approvalStatus === 'REJECTED' || ticket.approvalStatus === 'REVISI'
      ? 'from-[#EF4444] via-[#DC2626] to-[#B91C1C]'
      : 'from-[#7135B5] via-[#A78BFA] to-[#35105E]';

  const mapsQuery =
    hasValue(ticket.latitude) && hasValue(ticket.longitude)
      ? `${ticket.latitude},${ticket.longitude}`
      : ticket.customerCoordinates || ticket.address || ticket.streetName || ticket.clusterName || '';

  const canonicalFields: { label: string; value: unknown; mono?: boolean }[] = [
    { label: 'No Ticket', value: ticket.ticketNumber, mono: true },
    { label: 'Area', value: ticket.area },
    { label: 'Cluster', value: ticket.clusterName },
    { label: 'Paket / Plan', value: ticket.plan },
    { label: 'Tipe Instalasi', value: ticket.installationType },
    { label: 'Tipe Layanan', value: ticket.serviceType },
    { label: 'Tipe Homepass', value: ticket.homepassType },
    { label: 'Homepass ID', value: ticket.homepassDetailId, mono: true },
    { label: 'Kode OLT', value: ticket.oltCode, mono: true },
    { label: 'Status OLT', value: ticket.oltRegistrationStatus },
    { label: 'Kode FDT', value: ticket.fdtCode || ticket.fdt, mono: true },
    { label: 'Kode FAT', value: ticket.fatCode || ticket.fat, mono: true },
    { label: 'Port FAT', value: ticket.fatPort, mono: true },
    { label: 'Redaman FAT', value: hasValue(ticket.fatRedamanDbm) ? `${ticket.fatRedamanDbm} dBm` : '', mono: true },
    { label: 'Dropcore', value: hasValue(dropcoreMeter) ? `${dropcoreMeter} Meter` : '', mono: true },
    { label: 'Brand ONT', value: hasValue(ticket.ontBrand) ? `${ticket.ontBrand} ${ticket.ontModel || ''}`.trim() : '' },
    { label: 'SN ONT', value: ticket.ontSerialNumber, mono: true },
    { label: 'MAC ONT', value: ticket.ontMacAddress, mono: true },
    { label: 'Router', value: hasValue(ticket.routerBrand) ? `${ticket.routerBrand} ${ticket.routerModel || ''}`.trim() : ticket.router },
    { label: 'SN Router', value: ticket.routerSerialNumber, mono: true },
    { label: 'STB 1 SN', value: ticket.stb1Sn || ticket.stbSerialNumber, mono: true },
    { label: 'Telepon 2', value: ticket.customerContact2, mono: true },
    { label: 'Agent ID', value: ticket.agentId, mono: true },
    { label: 'File Sumber', value: ticket.fileName, mono: true }
  ].filter(f => hasValue(f.value));

  return (
    <div
      className={`fixed inset-0 z-60 flex items-start sm:items-center justify-center bg-[#160D29]/65 backdrop-blur-sm transition-opacity ${
        isCompactUI ? 'p-0' : 'p-2 sm:p-4 lg:p-6'
      }`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-ticket-title"
        onClick={e => e.stopPropagation()}
        className={`relative w-full bg-white dark:bg-[#1E1238] shadow-2xl border border-[#E8DDFF] dark:border-[#35105E] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
          isCompactUI ? 'h-dvh rounded-none max-w-full' : 'max-w-7xl max-h-[94vh] rounded-2xl'
        }`}
      >
        {/* TOP SYSTEM & SYNC STRIP */}
        <div className="w-full bg-[#F5F1FF] dark:bg-[#160D29] px-4 sm:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#766B83] dark:text-[#CEC0E8] border-b border-[#E9E5F0] dark:border-[#35105E] shrink-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  syncStatus === 'SAVED'
                    ? 'bg-[#16A36A]'
                    : syncStatus === 'SYNCING' || syncStatus === 'LOADING'
                    ? 'bg-[#D97706] animate-pulse'
                    : 'bg-[#DC4C5A]'
                }`}
              />
              <span className="font-mono font-bold text-[#160D29] dark:text-white uppercase">
                SUPABASE SYNC: {syncStatus}
              </span>
            </div>
            <span className="text-[#CEC3D4] dark:text-[#4B386B]">|</span>
            <span className="font-bold uppercase tracking-wide text-[#766B83] dark:text-[#A78BFA]">
              Cluster: {ticket.clusterName || ticket.area || '-'}
            </span>
            <span className="hidden sm:inline text-[#CEC3D4] dark:text-[#4B386B]">|</span>
            <span className="hidden sm:inline font-semibold text-[#7135B5] dark:text-[#DAB9FF]">
              Durasi Kerja: {ticket.workDurationFormatted || (ticket.checkInAt ? 'Sedang Dikerjakan' : 'Belum Check-in')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#8B8495] dark:text-[#A78BFA]">
            <Lock className="w-3 h-3" />
            <span className="truncate max-w-[260px]">
              Sesi: {currentUser.name} ({currentUser.role})
            </span>
          </div>
        </div>

        {/* MODAL HEADER */}
        <div
          className={`bg-white dark:bg-[#1E1238] border-b border-[#E9E5F0] dark:border-[#35105E] flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0 ${
            isCompactUI ? 'px-3.5 py-3' : 'px-5 py-3.5'
          }`}
        >
          {/* Left: Title + Category + Cust ID */}
          <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 bg-[#F7F6FA] dark:bg-[#160D29] px-2.5 py-1 rounded-lg border border-[#D8CCF3] dark:border-[#4B386B] shadow-inner">
              <span
                id="modal-ticket-title"
                className="font-mono font-extrabold text-[15px] sm:text-[17px] text-[#35105E] dark:text-[#DAB9FF] tracking-tight tabular-nums"
              >
                {ticket.woNumber}
              </span>
              <button
                type="button"
                onClick={handleCopyWO}
                className="btn-3d-icon w-6 h-6 rounded-md cursor-pointer"
                title="Salin Work Order Number"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>

            {hasValue(ticket.ticketCategory) && (
              <span className="px-2.5 py-1 rounded-full bg-[#35105E] text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-xs">
                <Zap className="w-3 h-3 text-[#DAB9FF]" />
                <span>{ticket.ticketCategory}</span>
              </span>
            )}

            <span className="px-2.5 py-1 rounded-full bg-[#F4EAFF] dark:bg-[#261942] text-[#35105E] dark:text-[#E9D5FF] font-mono text-[11px] font-bold flex items-center gap-1 tabular-nums">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#16A36A]" />
              <span>CUST-ID: {ticket.idCustomer}</span>
            </span>

            <div className="flex items-center text-[15px] font-bold text-[#211A2E] dark:text-white truncate max-w-[260px] sm:max-w-xs">
              <span className="text-[#8B8495] font-normal mr-1.5">/</span>
              <span className="truncate">{ticket.customerName}</span>
            </div>

            {ticket.isArchived && (
              <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-[10px] font-bold uppercase">
                Archived
              </span>
            )}
          </div>

          {/* Right: 3D Tactile Header Action Utilities */}
          <div className="flex flex-wrap items-center justify-end gap-2 w-full lg:w-auto shrink-0">
            <button
              type="button"
              onClick={scrollToChat}
              className="btn-3d-ceramic h-8 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer lg:hidden"
              title="Buka & gulir ke LiveChat"
            >
              <MessageSquare className="w-3.5 h-3.5 text-[#7135B5]" />
              <span>Chat</span>
              {unreadChatCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-[#DC4C5A] text-white">
                  {unreadChatCount > 99 ? '99+' : unreadChatCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onOpenWhatsApp(ticket)}
              className="btn-3d-success h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              title="Kirim / Update Status WhatsApp Pelanggan"
            >
              <Phone className="w-3.5 h-3.5" />
              <span>WhatsApp</span>
            </button>

            {canCloseTicket && (
              <button
                type="button"
                onClick={() => setShowCloseModal(v => !v)}
                className="btn-3d-primary h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Close WO</span>
              </button>
            )}

            {isTicketClosed && canManageApproval && (
              <button
                type="button"
                onClick={() => setShowReopenModal(v => !v)}
                className="btn-3d-warning h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reopen</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleArchive}
              className="btn-3d-ceramic h-8 px-3 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              title={ticket.isArchived ? 'Pulihkan dari Arsip' : 'Arsipkan Tiket'}
            >
              <Archive className="w-3.5 h-3.5 text-[#766B83] dark:text-[#CEC0E8]" />
              <span>{ticket.isArchived ? 'Restore' : 'Arsipkan'}</span>
            </button>

            {currentUser.role === 'management_data' && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="btn-3d-danger h-8 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                title="Hapus Work Order (Khusus Management Data)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Hapus WO</span>
              </button>
            )}

            <div className="hidden sm:block h-5 w-px bg-[#E9E5F0] dark:bg-[#35105E] mx-0.5" aria-hidden="true" />

            <button
              type="button"
              onClick={onClose}
              className="btn-3d-icon w-8 h-8 rounded-lg cursor-pointer hover:text-[#BA1A1A] ml-auto sm:ml-0"
              aria-label="Tutup Dialog"
              title="Tutup Modal (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Close Ticket Inline Banner */}
        {showCloseModal && (
          <div className="p-4 bg-[#F5F1FF] dark:bg-[#261942] border-b border-[#D8CCF3] dark:border-[#4B386B] text-xs space-y-2.5 shrink-0">
            <div className="font-bold text-[#35105E] dark:text-[#E9D5FF] flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-[#7135B5]" />
              <span>Verifikasi & Penyelesaian Resmi Tiket (Close Ticket WO: {ticket.woNumber})</span>
            </div>
            {closeError && (
              <div className="p-2 rounded-lg bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-semibold">
                {closeError}
              </div>
            )}
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="text"
                placeholder="Catatan penutupan (contoh: Redaman -18 dBm baik, internet aktif, pelanggan puas)..."
                value={closeNotes}
                onChange={e => setCloseNotes(e.target.value)}
                className="w-full sm:flex-1 px-3 py-2 border border-[#D8CCF3] dark:border-[#4B386B] rounded-lg bg-white dark:bg-[#160D29] text-[#211A2E] dark:text-white text-xs focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
              />
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setShowCloseModal(false)}
                  className="btn-3d-ceramic px-3 py-2 rounded-lg font-bold text-xs cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCloseTicket}
                  className="btn-3d-primary px-4 py-2 rounded-lg font-bold text-xs cursor-pointer"
                >
                  Konfirmasi Close Ticket
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Reopen Ticket Inline Banner */}
        {showReopenModal && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/70 border-b border-amber-200 dark:border-amber-800 text-xs space-y-2.5 shrink-0">
            <div className="font-bold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4 text-amber-600" />
              <span>Buka Kembali Tiket (Reopen Work Order)</span>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="text"
                placeholder="Alasan reopen (contoh: keluhan ulang pelanggan, redaman drop kembali)..."
                value={reopenReason}
                onChange={e => setReopenReason(e.target.value)}
                className="w-full sm:flex-1 px-3 py-2 border border-amber-300 dark:border-amber-800 rounded-lg bg-white dark:bg-[#160D29] text-[#211A2E] dark:text-white text-xs"
              />
              <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={() => setShowReopenModal(false)}
                  className="btn-3d-ceramic px-3 py-2 rounded-lg font-bold text-xs cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleConfirmReopen}
                  disabled={!reopenReason.trim()}
                  className="btn-3d-warning px-4 py-2 rounded-lg font-bold text-xs disabled:opacity-40 cursor-pointer"
                >
                  Buka Kembali
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SCROLLABLE INTERACTIVE BODY STAGE */}
        <div className="flex-1 overflow-y-auto bg-[#F7F6FA] dark:bg-[#140827] p-3.5 sm:p-5 space-y-5 text-xs">
          {/* ============================================================== */}
          {/* ZONE 1: DISPATCH APPROVAL & VERIFIKASI HUB                     */}
          {/* ============================================================== */}
          <section className="bg-white dark:bg-[#1E1238] rounded-xl shadow-md p-4 sm:p-5 relative overflow-hidden border border-[#E9E5F0] dark:border-[#35105E] space-y-4">
            <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${topGradientBar}`} />

            {/* Banner Header & Lifecycle Pill */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
              <div className="flex items-start sm:items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    ticket.approvalStatus === 'APPROVED'
                      ? 'bg-[#16A36A]/15 text-[#16A36A]'
                      : ticket.approvalStatus === 'REJECTED' || ticket.approvalStatus === 'REVISI'
                      ? 'bg-[#DC4C5A]/15 text-[#DC4C5A]'
                      : 'bg-[#E59A27]/15 text-[#D97706]'
                  }`}
                >
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-[15px] sm:text-[16px] text-[#160D29] dark:text-white">
                      Verifikasi Hasil Pengerjaan Teknisi Lapangan
                    </h3>
                    <StatusApprovalBadge status={ticket.approvalStatus} />
                  </div>
                  <div className="text-[12px] text-[#766B83] dark:text-[#CEC0E8] flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span>
                      Teknisi: <strong className="text-[#211A2E] dark:text-white">{ticket.installerName || 'Belum Ditugaskan'}</strong>
                      {ticket.contactorName ? ` (${ticket.contactorName})` : ''}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Mulai:{' '}
                      <strong className="text-[#211A2E] dark:text-white font-mono">
                        {ticket.workStartedAt
                          ? new Date(ticket.workStartedAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                          : ticket.checkInAt
                          ? new Date(ticket.checkInAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
                          : '-'}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Durasi:{' '}
                      <strong className="text-[#7135B5] dark:text-[#DAB9FF] font-mono font-bold">
                        {ticket.workDurationFormatted || (ticket.checkInAt ? 'Aktif' : '-')}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 px-3.5 py-2 bg-[#F5F1FF] dark:bg-[#261942] rounded-xl border border-[#D8CCF3] dark:border-[#4B386B] self-start lg:self-auto shrink-0">
                <Gauge className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF]" />
                <div className="flex flex-col text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#8B8495] dark:text-[#A78BFA]">
                    Lifecycle Progress
                  </span>
                  <span className="font-mono text-[12px] font-bold text-[#16A36A] tabular-nums">
                    {completedStepsCount}/7 TAHAP SELESAI
                  </span>
                </div>
              </div>
            </div>

            {/* Compact 7-Step WO Lifecycle Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
              {lifecycleSteps.map(step => (
                <div
                  key={step.label}
                  className={`rounded-lg px-2.5 py-2 border text-[10.5px] ${
                    step.done
                      ? 'bg-[#ECFDF5]/70 dark:bg-emerald-950/30 border-[#86EFAC] dark:border-emerald-800 text-[#15803D] dark:text-emerald-300'
                      : 'bg-[#F8FAFC] dark:bg-[#160D29] border-[#E2E8F0] dark:border-[#35105E] text-[#766B83] dark:text-[#CEC0E8]'
                  }`}
                >
                  <div className="font-bold truncate">{step.label}</div>
                  <div className="truncate font-mono text-[10px] mt-0.5 tabular-nums">{step.detail}</div>
                </div>
              ))}
            </div>

            {/* 4 Precision Telemetry Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {/* 1. Redaman OPM */}
              <div className="bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl p-3.5 flex flex-col justify-between border border-[#E9E5F0] dark:border-[#35105E] hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#8B8495]">Redaman OPM ONT</span>
                  {rawOpmValue ? (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isOpmValid
                          ? 'bg-[#16A36A]/15 text-[#16A36A]'
                          : 'bg-[#E59A27]/15 text-[#D97706]'
                      }`}
                    >
                      {isOpmValid ? 'PASS (-8 s/d -25)' : 'PERLU CEK'}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-[#8B8495]">Belum Diisi</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span
                    className={`font-mono text-[22px] font-bold tracking-tight tabular-nums ${
                      rawOpmValue ? (isOpmValid ? 'text-[#16A36A]' : 'text-[#D97706]') : 'text-[#8B8495]'
                    }`}
                  >
                    {rawOpmValue ? String(rawOpmValue).replace(/\s*dBm/i, '') : '-'}
                  </span>
                  {rawOpmValue && <span className="text-xs font-semibold text-[#766B83] dark:text-[#CEC0E8]">dBm</span>}
                </div>
                <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] mt-1 truncate">
                  {hasValue(ticket.technicalReport?.opticalPowerRx) ? 'Data Technical Report OPM' : 'Menunggu input teknisi'}
                </div>
              </div>

              {/* 2. SN ONT / Modem */}
              <div className="bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl p-3.5 flex flex-col justify-between border border-[#E9E5F0] dark:border-[#35105E] hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#8B8495]">SN ONT / Modem</span>
                  {serialOnt && <CheckCircle2 className="w-4 h-4 text-[#16A36A]" />}
                </div>
                <div className="font-mono text-[16px] text-[#35105E] dark:text-[#DAB9FF] font-bold tracking-wide truncate tabular-nums">
                  {serialOnt || '-'}
                </div>
                <div className="text-[11px] text-[#16A36A] font-medium mt-1 truncate">
                  {hasValue(ticket.oltRegistrationStatus)
                    ? ticket.oltRegistrationStatus
                    : hasValue(ticket.oltCode)
                    ? `OLT: ${ticket.oltCode}`
                    : 'Serial perangkat ONT'}
                </div>
              </div>

              {/* 3. Dropcore & FAT */}
              <div className="bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl p-3.5 flex flex-col justify-between border border-[#E9E5F0] dark:border-[#35105E] hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#8B8495]">Dropcore & FAT</span>
                  <span className="font-mono text-[10.5px] text-[#7135B5] dark:text-[#DAB9FF] font-bold">
                    {hasValue(ticket.fatPort) ? `Port ${ticket.fatPort}` : 'FAT Port -'}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-[22px] text-[#160D29] dark:text-white font-bold tabular-nums">
                    {hasValue(dropcoreMeter) ? dropcoreMeter : '-'}
                  </span>
                  {hasValue(dropcoreMeter) && <span className="text-xs font-semibold text-[#766B83] dark:text-[#CEC0E8]">Meter</span>}
                </div>
                <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] mt-1 truncate">
                  {fatLabel ? `${fatLabel}${hasValue(ticket.fatRedamanDbm) ? ` (${ticket.fatRedamanDbm} dBm)` : ''}` : 'Kode FAT belum tercatat'}
                </div>
              </div>

              {/* 4. Laporan 3-Tingkat */}
              <div className="bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl p-3.5 flex flex-col justify-between border border-[#E9E5F0] dark:border-[#35105E] hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#8B8495]">Laporan 3-Tingkat</span>
                  <Network className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF]" />
                </div>
                <div className="text-xs font-bold text-[#16A36A] truncate">
                  L1: {tier1Label}
                </div>
                <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] mt-1 leading-snug">
                  <div className="truncate">L2: {tier2Label}</div>
                  <div className="truncate text-[#8B8495] text-[10.5px]">L3: {tier3Label}</div>
                </div>
              </div>
            </div>

            {/* Bukti Dokumentasi Fisik (Real Photos) */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF]" />
                  <h4 className="font-bold text-[14px] text-[#160D29] dark:text-white">
                    Bukti Dokumentasi Fisik & Lampiran Lapangan
                  </h4>
                </div>
                <span
                  className={`text-[10.5px] font-bold uppercase ${
                    evidencePhotos.length > 0 ? 'text-[#16A36A]' : 'text-[#8B8495]'
                  }`}
                >
                  {evidencePhotos.length > 0
                    ? `${evidencePhotos.length} Foto Terunggah`
                    : 'Belum Ada Foto Bukti'}
                </span>
              </div>

              {evidencePhotos.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {evidencePhotos.map(photo => (
                    <div
                      key={photo.id}
                      onClick={() => setZoomPhoto(photo)}
                      className="group relative rounded-xl overflow-hidden bg-[#F7F6FA] dark:bg-[#160D29] shadow-xs hover:shadow-md transition-all border border-[#E9E5F0] dark:border-[#35105E] cursor-pointer"
                    >
                      <div className="w-full h-28 overflow-hidden relative bg-[#E9E5F0] dark:bg-[#261942]">
                        {!failedImages[photo.id] ? (
                          <img
                            src={photo.url}
                            alt={photo.title}
                            referrerPolicy="no-referrer"
                            onError={() => setFailedImages(prev => ({ ...prev, [photo.id]: true }))}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-[#8B8495] p-2 text-center">
                            <ImageOff className="w-5 h-5 mb-1" />
                            <span className="text-[10px] truncate w-full">{photo.title}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setZoomPhoto(photo);
                          }}
                          className="btn-3d-icon absolute top-2 right-2 w-7 h-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Zoom Foto"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="p-2 bg-white dark:bg-[#1E1238] flex items-center justify-between gap-1.5">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-[#211A2E] dark:text-white truncate">{photo.title}</div>
                          <div className="font-mono text-[10px] text-[#766B83] dark:text-[#CEC0E8] truncate">{photo.subtitle}</div>
                        </div>
                        <span className="tactile-chip text-[10px] px-1.5 py-0.5 rounded text-[#35105E] font-bold shrink-0">
                          Zoom
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-[#D8CCF3] dark:border-[#4B386B] bg-[#F7F6FA] dark:bg-[#160D29] text-center text-[#8B8495] text-xs">
                  Belum ada foto bukti lapangan yang diunggah teknisi melalui Technical Report atau LiveChat.
                </div>
              )}
            </div>

            {/* Approved / Rejected Historical Banners */}
            {ticket.approvalStatus === 'APPROVED' && (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex items-start gap-2.5 text-xs text-emerald-900 dark:text-emerald-200">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  Laporan telah <strong>DISETUJUI (APPROVED)</strong> oleh <strong>{ticket.approvedBy || 'Dispatch'}</strong>
                  {ticket.approvedAt && ` pada ${new Date(ticket.approvedAt).toLocaleString('id-ID')}`}, dan status WO <strong>RESMI CLOSED</strong>.
                  {ticket.approvalNotes && <div className="mt-1 italic">Catatan: "{ticket.approvalNotes}"</div>}
                </div>
              </div>
            )}

            {ticket.approvalStatus === 'REJECTED' && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  Laporan <strong>DITOLAK / PERLU REVISI</strong> oleh <strong>{ticket.rejectedBy || 'Dispatch'}</strong>
                  {ticket.rejectedAt && ` pada ${new Date(ticket.rejectedAt).toLocaleString('id-ID')}`}.
                  {ticket.rejectionReason && <div className="mt-1 font-semibold">Alasan: "{ticket.rejectionReason}"</div>}
                </div>
              </div>
            )}

            {/* Dispatcher Verification Control Block (RBAC: Dispatch & Super Admin when BUTUH APPROVAL or active notes) */}
            {canManageApproval && ticket.approvalStatus === 'BUTUH APPROVAL' && (
              <div className="bg-[#F5F1FF] dark:bg-[#261942] rounded-xl p-4 border border-[#D8CCF3] dark:border-[#4B386B] space-y-3">
                {decisionError && (
                  <div className="p-2.5 rounded-lg bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-200 font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{decisionError}</span>
                  </div>
                )}

                <div className="flex flex-col xl:flex-row gap-3 items-stretch xl:items-end">
                  <div className="flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="dispatcher-review-note" className="text-[13px] font-bold text-[#160D29] dark:text-white flex items-center gap-1">
                        <span>Catatan Pemeriksaan Dispatcher</span>
                        <span className="text-[#DC4C5A]">*</span>
                        <span className="text-[11px] font-normal text-[#8B8495]">(Wajib min. 3 karakter jika minta revisi)</span>
                      </label>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10.5px] font-bold uppercase text-[#8B8495]">Template Cepat:</span>
                        <button
                          type="button"
                          onClick={() => setDecisionNotes('Redaman optik sesuai standar, foto bukti lengkap dan sesuai SOP. Disetujui.')}
                          className="tactile-chip px-2 py-0.5 rounded text-[#35105E] text-[10.5px] font-bold cursor-pointer"
                        >
                          Acc Redaman Normal
                        </button>
                        <button
                          type="button"
                          onClick={() => setDecisionNotes('Foto barcode ONT atau bukti lapangan belum jelas, harap unggah ulang.')}
                          className="tactile-chip px-2 py-0.5 rounded text-[#35105E] text-[10.5px] font-bold cursor-pointer"
                        >
                          Kirim Ulang Foto
                        </button>
                        <button
                          type="button"
                          onClick={() => setDecisionNotes('SOP pemasangan lengkap, koordinat check-in valid, koneksi aktif.')}
                          className="tactile-chip px-2 py-0.5 rounded text-[#35105E] text-[10.5px] font-bold cursor-pointer"
                        >
                          SOP Lengkap
                        </button>
                      </div>
                    </div>

                    <textarea
                      id="dispatcher-review-note"
                      rows={2}
                      value={decisionNotes}
                      onChange={e => {
                        setDecisionNotes(e.target.value);
                        if (decisionError) setDecisionError(null);
                      }}
                      placeholder="Tuliskan catatan verifikasi hasil teknisi di sini..."
                      className="w-full p-2.5 bg-white dark:bg-[#160D29] rounded-lg text-xs text-[#211A2E] dark:text-white placeholder:text-[#8B8495] border border-[#D8CCF3] dark:border-[#4B386B] focus:outline-none focus:ring-2 focus:ring-[#7135B5] shadow-sm"
                    />
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleConfirmReject}
                      disabled={isRejecting || isApproving}
                      className="btn-3d-danger flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                      <span>{isRejecting ? 'Memproses...' : 'Tolak / Minta Revisi'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSaveInternalNote}
                      disabled={isSavingNote || isApproving || isRejecting}
                      className="btn-3d-ceramic flex-1 sm:flex-initial px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#DAB9FF]" />
                      <span>{isSavingNote ? 'Menyimpan...' : 'Simpan Catatan'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleConfirmApprove}
                      disabled={isApproving || isRejecting}
                      className="btn-3d-success flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      <span>{isApproving ? 'Menyetujui...' : 'Setujui & Selesaikan WO'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ============================================================== */}
          {/* ZONE 2: 2-COLUMN MAIN ARCHITECTURE                             */}
          {/* ============================================================== */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* LEFT COLUMN (7/12): Customer, Schedule, Technical Specs & Audit Trail */}
            <div className="lg:col-span-7 space-y-5">
              {/* Card 1: Identitas Pelanggan & Lokasi Pemasangan */}
              <div className="bg-white dark:bg-[#1E1238] rounded-xl shadow-sm p-4 sm:p-5 space-y-4 border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF]" />
                    <h4 className="font-bold text-[15px] text-[#160D29] dark:text-white">
                      Identitas Pelanggan & Lokasi Pemasangan
                    </h4>
                  </div>
                  <span className="text-[10.5px] font-bold uppercase text-[#16A36A] bg-[#16A36A]/10 px-2 py-0.5 rounded">
                    ID: {ticket.idCustomer}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-[10.5px] font-bold uppercase text-[#8B8495]">Nama Pelanggan</div>
                    <div className="font-bold text-[16px] text-[#211A2E] dark:text-white">{ticket.customerName}</div>
                    <div className="font-mono text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
                      Cust ID: {ticket.idCustomer}{ticket.ticketNumber ? ` · Tiket: ${ticket.ticketNumber}` : ''}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-bold uppercase text-[#8B8495]">Kontak Pelanggan</div>
                    <div className="font-mono font-bold text-[15px] text-[#211A2E] dark:text-white tabular-nums">
                      {ticket.customerPhone || '-'}
                    </div>

                    <div className="flex items-center gap-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => onOpenWhatsApp(ticket)}
                        className="btn-3d-success px-2.5 py-1 rounded-lg text-[10.5px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3" />
                        <span>WhatsApp</span>
                      </button>
                      {ticket.customerPhone && (
                        <a
                          href={`tel:${ticket.customerPhone}`}
                          className="btn-3d-ceramic px-2.5 py-1 rounded-lg text-[10.5px] font-bold flex items-center gap-1"
                        >
                          <Phone className="w-3 h-3 text-[#7135B5] dark:text-[#DAB9FF]" />
                          <span>Telepon</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Address & Geo */}
                <div className="p-3.5 bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl space-y-2 border border-[#E9E5F0] dark:border-[#35105E]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10.5px] font-bold uppercase text-[#8B8495]">Alamat Instalasi</div>
                      <div className="text-[13px] text-[#211A2E] dark:text-white font-medium mt-0.5 leading-relaxed">
                        {ticket.clusterName && <span className="font-bold text-[#35105E] dark:text-[#DAB9FF]">[{ticket.clusterName}] </span>}
                        {ticket.address || ticket.streetName || '-'}
                        {ticket.city && <span className="block text-[11px] text-[#766B83] dark:text-[#CEC0E8]">{ticket.city} {ticket.postalCode || ''}</span>}
                      </div>
                    </div>

                    {mapsQuery && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-3d-ceramic shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1"
                      >
                        <Navigation className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#DAB9FF]" />
                        <span>Buka Maps</span>
                      </a>
                    )}
                  </div>

                  {(hasValue(ticket.latitude) || hasValue(ticket.longitude) || hasValue(ticket.area)) && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
                      <MapPin className="w-3.5 h-3.5 text-[#DC4C5A]" />
                      <span>Area: {ticket.area || '-'}</span>
                      {hasValue(ticket.latitude) && hasValue(ticket.longitude) && (
                        <>
                          <span>·</span>
                          <span>LAT: {ticket.latitude}</span>
                          <span>·</span>
                          <span>LONG: {ticket.longitude}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Card 2: Jadwal & Penugasan Kontraktor */}
              <div className="bg-white dark:bg-[#1E1238] rounded-xl shadow-sm p-4 sm:p-5 space-y-4 border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF]" />
                    <h4 className="font-bold text-[15px] text-[#160D29] dark:text-white">
                      Jadwal & Penugasan Kontraktor
                    </h4>
                  </div>
                  {hasValue(ticket.distributionStatus) && (
                    <span className="text-[10.5px] font-bold uppercase bg-[#E9D5FF]/60 dark:bg-[#35105E] text-[#35105E] dark:text-[#DAB9FF] px-2 py-0.5 rounded">
                      {String(ticket.distributionStatus).replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl border border-[#E9E5F0] dark:border-[#35105E]">
                    <span className="text-[10px] font-bold uppercase text-[#8B8495]">Tanggal Appointment</span>
                    <div className="font-bold text-[14px] text-[#211A2E] dark:text-white mt-0.5 tabular-nums">
                      {formatAppointmentDateDisplay(ticket.appointmentDate)}
                    </div>
                    <span className="text-[11px] text-[#7135B5] dark:text-[#DAB9FF] font-semibold">
                      {ticket.appointmentType || ticket.ticketCategory || 'Reguler'}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl border border-[#E9E5F0] dark:border-[#35105E]">
                    <span className="text-[10px] font-bold uppercase text-[#8B8495]">Slot Waktu</span>
                    <div className="font-bold text-[14px] text-[#211A2E] dark:text-white mt-0.5 flex items-center gap-1 tabular-nums">
                      <Clock className="w-3.5 h-3.5 text-[#D97706]" />
                      <span>{ticket.slotTime || 'Belum Ditentukan'}</span>
                    </div>
                    <span className="text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
                      Upload: {ticket.dateUpload || ticket.createdAt?.slice(0, 10) || '-'}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F7F6FA] dark:bg-[#160D29] rounded-xl border border-[#E9E5F0] dark:border-[#35105E]">
                    <span className="text-[10px] font-bold uppercase text-[#8B8495]">Mitra Pelaksana</span>
                    <div className="font-bold text-[14px] text-[#211A2E] dark:text-white mt-0.5 truncate flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
                      <span className="truncate">{ticket.contactorName || 'Belum Dipetakan'}</span>
                    </div>
                    <span className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] truncate block">
                      {ticket.contractorId ? `ID: ${ticket.contractorId}` : ticket.area || '-'}
                    </span>
                  </div>
                </div>

                {/* Hierarchy Assignment Flow (Korlap -> Teknisi) */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-3 bg-[#F5F1FF] dark:bg-[#160D29] rounded-xl gap-3 border border-[#D8CCF3] dark:border-[#4B386B]">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#35105E] text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {(ticket.leaderName || 'KL').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase text-[#8B8495]">Koordinator Lapangan (Korlap)</div>
                      <div className="text-xs font-bold text-[#211A2E] dark:text-white truncate">
                        {ticket.leaderName || '-'} {ticket.leaderContact ? `(${ticket.leaderContact})` : ''}
                      </div>
                    </div>
                  </div>

                  <ArrowRight className="w-4 h-4 text-[#8B8495] self-center rotate-90 sm:rotate-0 shrink-0" />

                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#7135B5] text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {(ticket.installerName || 'TK').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase text-[#8B8495]">Teknisi Eksekutor</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[#211A2E] dark:text-white truncate">
                          {ticket.installerName || <em className="text-[#D97706] font-normal">Belum Ditugaskan</em>}
                        </span>
                        {currentUser.role === 'leader' && (
                          <select
                            value={ticket.installerName || ''}
                            onChange={e => {
                              if (e.target.value !== ticket.installerName) {
                                assignTicketPersonnel(ticket.id, currentUser.name, e.target.value);
                              }
                            }}
                            className="px-2 py-0.5 text-[11px] bg-white dark:bg-[#1E1238] border border-[#A78BFA] rounded font-semibold text-[#5B35B1] dark:text-[#DAB9FF] cursor-pointer"
                            title="Tugaskan Teknisi (Wewenang Khusus Leader)"
                          >
                            <option value="">-- Assign Teknisi --</option>
                            {installersList.map(inst => (
                              <option key={inst} value={inst}>{inst}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Assignment / Reassignment History */}
                {ticket.assignmentHistory && ticket.assignmentHistory.length > 0 && (
                  <div className="pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[#766B83] dark:text-[#CEC0E8] font-bold text-[11px]">
                      <History className="w-3.5 h-3.5 text-[#D97706]" />
                      <span>Riwayat Penugasan & Reassign ({ticket.assignmentHistory.length})</span>
                    </div>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {ticket.assignmentHistory.map((h, i) => (
                        <div key={h.id || i} className="p-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] text-[10.5px] space-y-0.5">
                          <div className="flex items-center justify-between font-semibold gap-2">
                            <span>
                              {h.previousInstaller || h.previousInstallerName || 'Unassigned'} &rarr;{' '}
                              <span className="text-[#16A36A]">{h.assignedInstaller || h.newInstallerName}</span>
                            </span>
                            <span className="font-mono text-[#8B8495] text-[10px] tabular-nums">
                              {new Date(h.timestamp).toLocaleString('id-ID')}
                            </span>
                          </div>
                          {h.reason && <div className="text-[#766B83] dark:text-[#CEC0E8] italic">"{h.reason}"</div>}
                          {h.performedBy && (
                            <div className="text-[#8B8495] text-[10px]">
                              Oleh: {h.performedBy} {h.performedByRole ? `(${h.performedByRole})` : ''}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Card 3: Spesifikasi Teknis FTTH & Technical Report Form */}
              <div className="bg-white dark:bg-[#1E1238] rounded-xl shadow-sm p-4 sm:p-5 space-y-4 border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF]" />
                    <h4 className="font-bold text-[15px] text-[#160D29] dark:text-white">
                      Spesifikasi Teknis FTTH & Data Kanonik
                    </h4>
                  </div>
                  <span className="font-mono text-[10.5px] text-[#8B8495]">Hanya field terisi</span>
                </div>

                {canonicalFields.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {canonicalFields.map(item => (
                      <div
                        key={item.label}
                        className="p-2.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]"
                      >
                        <span className="text-[10px] font-bold uppercase text-[#8B8495] block truncate">
                          {item.label}
                        </span>
                        <span
                          className={`text-[12px] font-bold text-[#211A2E] dark:text-white block truncate mt-0.5 ${
                            item.mono ? 'font-mono tabular-nums' : ''
                          }`}
                          title={String(item.value)}
                        >
                          {String(item.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Remarks Grid */}
                {(hasValue(ticket.remarksAgent) || hasValue(ticket.remarksWOInstaller) || hasValue(ticket.remarks)) && (
                  <div className="pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {hasValue(ticket.remarksAgent) && (
                      <div className="p-3 rounded-lg bg-[#F5F1FF] dark:bg-[#261942] border border-[#D8CCF3] dark:border-[#4B386B]">
                        <span className="font-bold text-[#35105E] dark:text-[#DAB9FF] block mb-1">Catatan Dispatch:</span>
                        <p className="text-[#211A2E] dark:text-slate-200">{ticket.remarksAgent}</p>
                      </div>
                    )}
                    {hasValue(ticket.remarksWOInstaller) && (
                      <div className="p-3 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                        <span className="font-bold text-emerald-900 dark:text-emerald-300 block mb-1">Catatan Teknisi Lapangan:</span>
                        <p className="text-[#211A2E] dark:text-slate-200">{ticket.remarksWOInstaller}</p>
                      </div>
                    )}
                    {hasValue(ticket.remarks) && !ticket.remarksAgent && (
                      <div className="p-3 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                        <span className="font-bold text-[#211A2E] dark:text-white block mb-1">Catatan Umum:</span>
                        <p className="text-[#766B83] dark:text-[#CEC0E8]">{ticket.remarks}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Technical Report Section & Toggle */}
                <div className="pt-3 border-t border-[#E9E5F0] dark:border-[#35105E] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-[#16A36A]" />
                      <span className="font-bold text-[13px] text-[#160D29] dark:text-white">
                        Laporan Teknis Lapangan (Technical Report)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowReportEditor(v => !v)}
                      className="btn-3d-ceramic px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
                    >
                      {showReportEditor
                        ? 'Sembunyikan Form Laporan'
                        : ticket.technicalReport
                        ? 'Lihat / Ubah Laporan Teknis'
                        : '+ Input Laporan Teknis'}
                    </button>
                  </div>

                  {ticket.technicalReport && !showReportEditor && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <div className="p-2.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                        <div className="text-[10px] text-[#8B8495] uppercase font-bold">Hasil Pekerjaan</div>
                        <div className="font-bold text-[#16A36A] mt-0.5">{ticket.technicalReport.workResult}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                        <div className="text-[10px] text-[#8B8495] uppercase font-bold">Root Cause</div>
                        <div className="font-semibold text-[#211A2E] dark:text-white mt-0.5 truncate">
                          {ticket.technicalReport.rootCause || '-'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]">
                        <div className="text-[10px] text-[#8B8495] uppercase font-bold">Material Terpakai</div>
                        <div className="font-semibold text-[#211A2E] dark:text-white mt-0.5 truncate">
                          {ticket.technicalReport.usedMaterials || '-'}
                        </div>
                      </div>
                    </div>
                  )}

                  {showReportEditor && (
                    <TechnicalReportForm
                      ticket={ticket}
                      onRequestProgressCheckIn={() => {
                        setChatInitialCategory('PROGRESS');
                        setTicketChatCategory(ticket.id, 'PROGRESS');
                        scrollToChat();
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Card 4: Riwayat Transaksi, Progress Reports & Log Perubahan Tiket */}
              <div className="bg-white dark:bg-[#1E1238] rounded-xl shadow-sm p-4 sm:p-5 space-y-4 border border-[#E9E5F0] dark:border-[#35105E]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-[#7135B5] dark:text-[#DAB9FF]" />
                    <h4 className="font-bold text-[15px] text-[#160D29] dark:text-white">
                      Riwayat Transaksi & Log Perubahan Tiket
                    </h4>
                  </div>
                  <span className="text-[11px] font-bold text-[#8B8495] tabular-nums">
                    {relatedActivities.length} Aktivitas · {ticket.progressReports?.length || 0} Versi Report
                  </span>
                </div>

                {relatedActivities.length > 0 && (
                  <div className="relative pl-6 space-y-3.5 before:absolute before:left-2 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-[#E9E5F0] dark:before:bg-[#35105E] max-h-64 overflow-y-auto pr-1">
                    {relatedActivities.map((act, idx) => (
                      <div key={act.id || idx} className="relative">
                        <span
                          className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full ring-4 ring-white dark:ring-[#1E1238] ${
                            idx === 0 ? 'bg-[#7135B5]' : 'bg-[#3977C9]'
                          }`}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-bold text-[#35105E] dark:text-[#DAB9FF] tabular-nums">
                            {new Date(act.timestamp).toLocaleString('id-ID')}
                          </span>
                          <span className="text-[10px] font-bold uppercase text-[#8B8495]">
                            {act.performedBy} ({act.userRole})
                          </span>
                        </div>
                        <div className="font-semibold text-[#211A2E] dark:text-white mt-0.5">{act.action}</div>
                        <div className="text-[11.5px] text-[#766B83] dark:text-[#CEC0E8]">{act.description}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-2 border-t border-[#E9E5F0] dark:border-[#35105E]">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#8B8495] mb-2">
                    History Progress Report & Approval Versions
                  </div>
                  <HistoryProgressReportView ticketId={ticket.id} compact />
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN (5/12): STICKY REAL-TIME LIVECHAT */}
            <div ref={chatSectionRef} className="lg:col-span-5 lg:sticky lg:top-0">
              {isChatOpen ? (
                <div className="rounded-xl shadow-md overflow-hidden border border-[#D8CCF3] dark:border-[#35105E] bg-white dark:bg-[#1E1238]">
                  <TicketLiveChat
                    ticket={ticket}
                    initialCategory={chatInitialCategory}
                    heightClass={isCompactUI ? 'h-[480px]' : 'h-[640px] lg:h-[740px]'}
                    onCollapse={() => setIsChatOpen(false)}
                  />
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-[#D8CCF3] dark:border-[#4B386B] bg-white dark:bg-[#1E1238] p-6 space-y-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#160D29] text-[#A78BFA] flex items-center justify-center shrink-0">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-[#160D29] dark:text-white flex items-center gap-2">
                        <span>Ticket LiveChat</span>
                        {unreadChatCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DC4C5A] text-white">
                            {unreadChatCount > 99 ? '99+' : unreadChatCount} Belum Dibaca
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8]">
                        Thread WO {ticket.woNumber} · {ticketMessages.length} Pesan Tersimpan
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] leading-relaxed">
                    Panel LiveChat dilipat sementara agar status <strong>unread</strong> tidak terhapus otomatis saat membuka detail WO. Klik tombol di bawah untuk membuka percakapan real-time.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsChatOpen(true)}
                    className="btn-3d-primary w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>
                      {unreadChatCount > 0
                        ? `Buka LiveChat (${unreadChatCount} Pesan Baru)`
                        : 'Buka Panel LiveChat'}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="bg-white dark:bg-[#1E1238] px-4 sm:px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-[#E9E5F0] dark:border-[#35105E] shrink-0">
          <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[#766B83] dark:text-[#CEC0E8]">
            <span
              className={`w-2 h-2 rounded-full ${
                syncStatus === 'SAVED' ? 'bg-[#16A36A]' : 'bg-[#D97706] animate-pulse'
              }`}
            />
            <span>
              Sync Status: <strong className="text-[#211A2E] dark:text-white">Express API & Supabase PostgreSQL</strong>
            </span>
            <span className="text-[#8B8495]">
              · WO ID: <span className="font-mono">{ticket.id}</span> · Update:{' '}
              {new Date(ticket.updatedAt).toLocaleTimeString('id-ID')}
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="btn-3d-ceramic flex-1 sm:flex-initial px-4 py-2 min-h-[40px] sm:min-h-0 rounded-xl text-xs font-bold cursor-pointer"
            >
              Tutup Modal
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-3d-primary flex-1 sm:flex-initial px-4 py-2 min-h-[40px] sm:min-h-0 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Cetak Berita Acara (BA)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Evidence Photo Lightbox */}
      {zoomPhoto && (
        <div
          className="fixed inset-0 z-70 bg-black/90 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setZoomPhoto(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoomPhoto(null)}
              className="absolute -top-2 -right-2 p-2 bg-[#160D29] text-white rounded-full border border-white/20 hover:bg-[#DC4C5A] transition-colors z-10 cursor-pointer shadow-lg"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={zoomPhoto.url}
              alt={zoomPhoto.title}
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[80vh] object-contain rounded-2xl shadow-2xl border border-white/10"
            />
            <div className="px-4 py-2 rounded-xl bg-[#160D29]/90 text-white text-xs text-center border border-[#A78BFA]/30">
              <div className="font-bold">{zoomPhoto.title}</div>
              <div className="text-[11px] text-[#DAB9FF] font-mono">{zoomPhoto.subtitle}</div>
            </div>
          </div>
        </div>
      )}

      {/* Management Data Delete Modal Guard */}
      {showDeleteConfirm && currentUser.role === 'management_data' && (
        <ManagementDataDeleteModal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          ticket={ticket}
          onSuccess={() => {
            setShowDeleteConfirm(false);
            onClose();
          }}
        />
      )}
    </div>
  );
};
