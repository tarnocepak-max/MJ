import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ticket, GeotagStatus, TechnicalPhotoSlotKey, DispatchApprovalWoAgentStatus } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { useVisualViewportModal } from '../../hooks/useVisualViewportModal';
import { StatusAgentBadge, StatusApprovalBadge } from '../common/Badge';
import { TicketLiveChat } from '../chat/TicketLiveChat';
import { TechnicalReportForm } from './TechnicalReportForm';
import { HistoryProgressReportView } from '../reports/HistoryProgressReportView';
import {
  isTicketAssigned,
  isTicketCheckedIn,
  getTicketCanonicalReportStatus,
  getTicketCanonicalApprovalStatus,
  isTicketClosed as isLifecycleClosed,
  DISPATCH_APPROVAL_OPTIONS,
  getDispatchApprovalOutcomeLabel,
  getRecommendedDispatchWoAgentStatus,
  getTicketDispatchWoAgentOutcome
} from '../../services/woLifecycleService';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import { formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import {
  buildGoogleMapsCoordinateUrl,
  formatCoordinates,
  isValidCoordinatePair
} from '../../services/mapsService';
import { ManagementDataDeleteModal } from '../portals/ManagementDataDeleteModal';
import { GeoLocationMiniMap } from '../maps/GeoLocationMiniMap';
import { WorkOrderLocationsCard } from '../maps/WorkOrderLocationsCard';
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
  ImageOff,
  Satellite,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  AlertTriangle
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
  slotKey?: TechnicalPhotoSlotKey;
  latitude?: number;
  longitude?: number;
  gpsAccuracyMeters?: number;
  capturedAtIso?: string;
  geotagStatus?: GeotagStatus;
  captureMethod?: 'camera' | 'gallery';
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
    loadTicketDetailOnDemand,
    markTicketEditing,
    toast
  } = useApp();
  const { isCompactUI } = useResponsiveViewport();
  const vv = useVisualViewportModal(isOpen);

  // Dispatcher verification & decision state
  const [selectedWoAgentStatus, setSelectedWoAgentStatus] = useState<DispatchApprovalWoAgentStatus>('Done');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isSavingNote, setIsSavingNote] = useState(false);

  // Reopen ticket banner state
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');

  // Delete confirm state (super_admin exclusive)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Technical report editor & chat visibility
  const [showReportEditor, setShowReportEditor] = useState(defaultTab === 'report');
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInitialCategory, setChatInitialCategory] = useState<string | undefined>(undefined);

  // Evidence lightbox & error fallback
  const [zoomPhoto, setZoomPhoto] = useState<EvidencePhotoItem | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const [isHistoryOpen, setIsHistoryOpen] = useState(defaultTab === 'history');

  const chatSectionRef = useRef<HTMLDivElement>(null);
  const historySectionRef = useRef<HTMLDivElement>(null);

  const unreadChatCount = ticket ? getTicketUnreadCount(ticket.id) : 0;

  useEffect(() => {
    if (!isOpen || !ticket) return;
    setShowReopenModal(false);
    setDecisionError(null);
    setSelectedWoAgentStatus(getRecommendedDispatchWoAgentStatus(ticket));
    setDecisionNotes(ticket.approvalNotes || ticket.remarksAgent || '');
    setShowReportEditor(defaultTab === 'report');
    setIsHistoryOpen(defaultTab === 'history');
    setChatInitialCategory(undefined);
    setZoomPhoto(null);
    setFailedImages({});

    // Respect unread preservation invariant:
    // If ticket has unread chat messages and user didn't explicitly open 'chat' tab, keep LiveChat folded until clicked.
    const initialUnread = getTicketUnreadCount(ticket.id);
    const openImmediately = defaultTab === 'chat' || initialUnread === 0;
    setIsChatOpen(openImmediately);

    // Single-WO on-demand hydration without refetching the entire WO database
    void loadTicketDetailOnDemand(ticket.id);

    if (defaultTab === 'chat') {
      const timer = setTimeout(() => {
        chatSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 180);
      return () => clearTimeout(timer);
    }

    if (defaultTab === 'history') {
      const timer = setTimeout(() => {
        historySectionRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 180);
      return () => clearTimeout(timer);
    }
  }, [isOpen, defaultTab, ticket?.id]);

  // Active-edit protection: prevent SSE / delta sync from clobbering active edits inside this modal
  const hasUnsavedDecisionNotes = Boolean(
    isOpen &&
      ticket &&
      decisionNotes.trim() !== (ticket.approvalNotes || ticket.remarksAgent || '').trim()
  );
  const isEditingModalActive = Boolean(
    isOpen &&
      ticket?.id &&
      (showReportEditor ||
        showReopenModal ||
        isApproving ||
        isRejecting ||
        isSavingNote ||
        hasUnsavedDecisionNotes)
  );

  useEffect(() => {
    if (!ticket?.id) return;
    if (isEditingModalActive) {
      markTicketEditing(ticket.id, true);
    } else {
      markTicketEditing(ticket.id, false);
    }
    return () => {
      markTicketEditing(ticket.id, false);
    };
  }, [ticket?.id, isEditingModalActive, markTicketEditing]);

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

  // Deduplicated real photo evidence from 6-slot geotag photoSlots, technicalReport, signature, and LiveChat image attachments
  const evidencePhotos = useMemo<EvidencePhotoItem[]>(() => {
    if (!ticket) return [];
    const seenUrls = new Set<string>();
    const items: EvidencePhotoItem[] = [];

    const pushPhoto = (
      url: string | undefined | null,
      title: string,
      subtitle: string,
      idPrefix: string,
      geo?: Partial<EvidencePhotoItem>
    ) => {
      if (!url || typeof url !== 'string' || !url.trim()) return;
      const safe = getSafePreviewUrl(url.trim());
      if (!safe || seenUrls.has(safe)) return;
      seenUrls.add(safe);
      items.push({
        id: `${idPrefix}-${items.length + 1}`,
        url: safe,
        title,
        subtitle,
        ...geo
      });
    };

    const tr = ticket.technicalReport;
    if (tr) {
      if (Array.isArray(tr.photoSlots)) {
        tr.photoSlots.forEach((slot, idx) => {
          if (!slot || !slot.url) return;
          const timeLabel = slot.capturedAtIso
            ? `${formatJakartaTimeOnly(slot.capturedAtIso)} WIB`
            : slot.capturedAt || '';
          const sub = [slot.badgeText, timeLabel].filter(Boolean).join(' · ') || 'Bukti SOP';
          pushPhoto(slot.url, slot.title || `Bukti SOP #${idx + 1}`, sub, `tr-slot-${slot.slotKey || idx}`, {
            slotKey: slot.slotKey,
            latitude: slot.latitude,
            longitude: slot.longitude,
            gpsAccuracyMeters: slot.gpsAccuracyMeters,
            capturedAtIso: slot.capturedAtIso,
            geotagStatus: slot.geotagStatus,
            captureMethod: slot.captureMethod
          });
        });
      }
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

    if (Array.isArray(ticket.kendalaReports)) {
      ticket.kendalaReports.forEach((kr, idx) => {
        if (!kr?.photoUrl) return;
        const timeStr = kr.createdAt ? `${formatJakartaTimeOnly(kr.createdAt)} WIB` : '';
        const sub = [kr.installerName, kr.reasonLabel || 'KENDALA', timeStr].filter(Boolean).join(' · ');
        pushPhoto(
          kr.photoUrl,
          `Foto Kendala Lapangan #${idx + 1}`,
          sub,
          `kendala-${kr.id || idx}`
        );
      });
    }

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
    const trimmedNotes = decisionNotes.trim();
    const result = await approveProgressReport(ticket.id, trimmedNotes || undefined, {
      woAgentStatus: selectedWoAgentStatus,
      remarksAgent: trimmedNotes || undefined
    });
    setIsApproving(false);
    if (result && result.success) {
      setDecisionNotes('');
      onClose();
      onApprovedAndClosed?.();
    } else if (result?.error) {
      setDecisionError(result.error);
      toast.error(result.error, 'Gagal Dispatch Approval');
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
  const isTicketClosed = isLifecycleClosed(ticket);
  const approvedOutcome = getTicketDispatchWoAgentOutcome(ticket);
  const dispatchApprovalLabel =
    ticket.dispatchApprovalStatus ||
    (approvedOutcome ? getDispatchApprovalOutcomeLabel(approvedOutcome) : undefined);
  const selectedApprovalOption =
    DISPATCH_APPROVAL_OPTIONS.find(opt => opt.woAgentStatus === selectedWoAgentStatus) ||
    DISPATCH_APPROVAL_OPTIONS[0];

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
    '-';

  const topGradientBar =
    ticket.approvalStatus === 'BUTUH APPROVAL'
      ? 'from-[#C88735] via-[#6657C8] to-[#218A63] dark:from-[#E59A27] dark:via-[#7135B5] dark:to-[#16A36A]'
      : ticket.approvalStatus === 'APPROVED'
      ? 'from-[#218A63] via-[#65B8C4] to-[#2E7D8B] dark:from-[#10B981] dark:via-[#16A36A] dark:to-[#059669]'
      : ticket.approvalStatus === 'REJECTED' || ticket.approvalStatus === 'REVISI'
      ? 'from-[#D45B66] via-[#C88735] to-[#9B2C37] dark:from-[#EF4444] dark:via-[#DC2626] dark:to-[#B91C1C]'
      : 'from-[#6657C8] via-[#65B8C4] to-[#5145A6] dark:from-[#7135B5] dark:via-[#A78BFA] dark:to-[#35105E]';

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
      className={`fixed inset-0 z-60 flex items-start sm:items-center justify-center bg-[#26364A]/45 dark:bg-[#160D29]/65 backdrop-blur-sm transition-opacity ${
        isCompactUI ? 'p-0' : 'p-2 sm:p-4 lg:p-6'
      }`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-ticket-title"
        onClick={e => e.stopPropagation()}
        style={
          vv.viewportHeight
            ? {
                maxHeight: isCompactUI
                  ? `${vv.viewportHeight}px`
                  : `${Math.max(360, vv.viewportHeight - (vv.isKeyboardOpen ? 12 : 32))}px`
              }
            : undefined
        }
        className={`relative w-full bg-white/95 dark:bg-[#1E1238] shadow-2xl border border-[#DDE6F0] dark:border-[#35105E] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
          isCompactUI ? 'h-dvh rounded-none max-w-full' : 'max-w-7xl max-h-[94dvh] rounded-2xl'
        }`}
      >
        {/* TOP SYSTEM & SYNC STRIP */}
        <div className="w-full bg-[#EDF3F8] dark:bg-[#160D29] px-4 sm:px-5 py-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#52647A] dark:text-[#CEC0E8] border-b border-[#DDE6F0] dark:border-[#35105E] shrink-0">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  syncStatus === 'SAVED'
                    ? 'bg-[#218A63] dark:bg-[#16A36A]'
                    : syncStatus === 'SYNCING' || syncStatus === 'LOADING'
                    ? 'bg-[#C88735] dark:bg-[#D97706] animate-pulse'
                    : 'bg-[#D45B66] dark:bg-[#DC4C5A]'
                }`}
              />
              <span className="font-mono font-bold text-[#26364A] dark:text-white uppercase">
                SUPABASE SYNC: {syncStatus}
              </span>
            </div>
            <span className="text-[#CFDCE8] dark:text-[#4B386B]">|</span>
            <span className="font-bold uppercase tracking-wide text-[#52647A] dark:text-[#A78BFA]">
              Cluster: {ticket.clusterName || ticket.area || '-'}
            </span>
            <span className="hidden sm:inline text-[#CFDCE8] dark:text-[#4B386B]">|</span>
            <span className="hidden sm:inline font-semibold text-[#5145A6] dark:text-[#DAB9FF]">
              Durasi Kerja: {ticket.workDurationFormatted || (ticket.checkInAt ? 'Sedang Dikerjakan' : 'Belum Check-in')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#8492A5] dark:text-[#A78BFA]">
            <Lock className="w-3 h-3" />
            <span className="truncate max-w-[260px]">
              Sesi: {currentUser.name} ({currentUser.role})
            </span>
          </div>
        </div>

        {/* MODAL HEADER */}
        <div
          className={`bg-white/95 dark:bg-[#1E1238] border-b border-[#DDE6F0] dark:border-[#35105E] flex flex-col lg:flex-row lg:items-center justify-between gap-3 shrink-0 ${
            isCompactUI ? 'px-3.5 py-3' : 'px-5 py-3.5'
          }`}
        >
          {/* Left: Title + Category + Cust ID */}
          <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 bg-[#F8FAFD] dark:bg-[#160D29] px-2.5 py-1 rounded-lg border border-[#DDE6F0] dark:border-[#4B386B] shadow-inner">
              <span
                id="modal-ticket-title"
                className="font-mono font-extrabold text-[15px] sm:text-[17px] text-[#5145A6] dark:text-[#DAB9FF] tracking-tight tabular-nums"
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
              <span className="px-2.5 py-1 rounded-full bg-[#5145A6] dark:bg-[#35105E] text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-xs">
                <Zap className="w-3 h-3 text-[#DDF4F4] dark:text-[#DAB9FF]" />
                <span>{ticket.ticketCategory}</span>
              </span>
            )}

            <span className="px-2.5 py-1 rounded-full bg-[#DDF4F4] dark:bg-[#261942] text-[#2E7D8B] dark:text-[#E9D5FF] font-mono text-[11px] font-bold flex items-center gap-1 tabular-nums border border-[#BDE4E8] dark:border-transparent">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#218A63] dark:text-[#16A36A]" />
              <span>CUST-ID: {ticket.idCustomer}</span>
            </span>

            <div className="flex items-center text-[15px] font-bold text-[#26364A] dark:text-white truncate max-w-[260px] sm:max-w-xs">
              <span className="text-[#8492A5] font-normal mr-1.5">/</span>
              <span className="truncate">{ticket.customerName}</span>
            </div>

            {ticket.isArchived && (
              <span className="px-2 py-0.5 rounded-full bg-[#EDF3F8] dark:bg-slate-700 text-[#52647A] dark:text-slate-200 text-[10px] font-bold uppercase">
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
              <MessageSquare className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#7135B5]" />
              <span>Chat</span>
              {unreadChatCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-[#D45B66] dark:bg-[#DC4C5A] text-white">
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
              <Archive className="w-3.5 h-3.5 text-[#52647A] dark:text-[#CEC0E8]" />
              <span>{ticket.isArchived ? 'Restore' : 'Arsipkan'}</span>
            </button>

            {currentUser.role === 'super_admin' && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="btn-3d-danger h-8 px-2.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                title="Hapus Work Order (Superadmin)"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Hapus WO</span>
              </button>
            )}
          </div>
        </div>

        {/* Reopen Ticket Inline Banner */}
        {showReopenModal && (
          <div className="p-4 bg-[#FFF2D9] dark:bg-amber-950/70 border-b border-[#F2CF95] dark:border-amber-800 text-xs space-y-2.5 shrink-0">
            <div className="font-bold text-[#9D661F] dark:text-amber-200 flex items-center gap-1.5">
              <RotateCcw className="w-4 h-4 text-[#C88735] dark:text-amber-600" />
              <span>Buka Kembali Tiket (Reopen Work Order)</span>
            </div>
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <input
                type="text"
                placeholder="Alasan reopen (contoh: keluhan ulang pelanggan, redaman drop kembali)..."
                value={reopenReason}
                onChange={e => setReopenReason(e.target.value)}
                className="w-full sm:flex-1 px-3 py-2 border border-[#F2CF95] dark:border-amber-800 rounded-lg bg-white dark:bg-[#160D29] text-[#26364A] dark:text-white text-xs"
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F4F7FB] dark:bg-[#140827] p-3.5 sm:p-5 space-y-5 text-xs">
          {/* ============================================================== */}
          {/* ZONE 1: DISPATCH APPROVAL & VERIFIKASI HUB                     */}
          {/* ============================================================== */}
          <section className="bg-white/95 dark:bg-[#1E1238] rounded-xl shadow-md p-4 sm:p-5 relative overflow-hidden border border-[#DDE6F0] dark:border-[#35105E] space-y-4">
            <div className={`absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r ${topGradientBar}`} />

            {/* Banner Header & Lifecycle Pill */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
              <div className="flex items-start sm:items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    ticket.approvalStatus === 'APPROVED'
                      ? 'bg-[#E4F5EC] dark:bg-[#16A36A]/15 text-[#218A63] dark:text-[#16A36A]'
                      : ticket.approvalStatus === 'REJECTED' || ticket.approvalStatus === 'REVISI'
                      ? 'bg-[#FCE9EB] dark:bg-[#DC4C5A]/15 text-[#9B2C37] dark:text-[#DC4C5A]'
                      : 'bg-[#FFF2D9] dark:bg-[#E59A27]/15 text-[#9D661F] dark:text-[#D97706]'
                  }`}
                >
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold text-[15px] sm:text-[16px] text-[#26364A] dark:text-white">
                      Verifikasi Hasil Pengerjaan Teknisi Lapangan
                    </h3>
                    <StatusApprovalBadge status={ticket.approvalStatus} />
                  </div>
                  <div className="text-[12px] text-[#52647A] dark:text-[#CEC0E8] flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span>
                      Teknisi: <strong className="text-[#26364A] dark:text-white">{ticket.installerName || 'Belum Ditugaskan'}</strong>
                      {ticket.contactorName ? ` (${ticket.contactorName})` : ''}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Mulai:{' '}
                      <strong className="text-[#26364A] dark:text-white font-mono">
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
                      <strong className="text-[#5145A6] dark:text-[#DAB9FF] font-mono font-bold">
                        {ticket.workDurationFormatted || (ticket.checkInAt ? 'Aktif' : '-')}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 px-3.5 py-2 bg-[#EAE8FF] dark:bg-[#261942] rounded-xl border border-[#DCE3F2] dark:border-[#4B386B] self-start lg:self-auto shrink-0">
                <Gauge className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF]" />
                <div className="flex flex-col text-right">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#52647A] dark:text-[#A78BFA]">
                    Lifecycle Progress
                  </span>
                  <span className="font-mono text-[12px] font-bold text-[#218A63] dark:text-[#16A36A] tabular-nums">
                    {completedStepsCount}/7 TAHAP SELESAI
                  </span>
                </div>
              </div>
            </div>

            {/* 4 Precision Telemetry Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {/* 1. Redaman OPM */}
              <div className="bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl p-3.5 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-1.5 gap-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#8492A5]">Redaman OPM ONT</span>
                  {rawOpmValue ? (
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        isOpmValid
                          ? 'bg-[#E4F5EC] dark:bg-[#16A36A]/15 text-[#218A63] dark:text-[#16A36A]'
                          : 'bg-[#FFF2D9] dark:bg-[#E59A27]/15 text-[#9D661F] dark:text-[#D97706]'
                      }`}
                    >
                      {isOpmValid ? 'PASS (-8 s/d -25)' : 'PERLU CEK'}
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-[#8492A5]">Belum Diisi</span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span
                    className={`font-mono text-[22px] font-bold tracking-tight tabular-nums ${
                      rawOpmValue ? (isOpmValid ? 'text-[#218A63] dark:text-[#16A36A]' : 'text-[#9D661F] dark:text-[#D97706]') : 'text-[#8492A5]'
                    }`}
                  >
                    {rawOpmValue ? String(rawOpmValue).replace(/\s*dBm/i, '') : '-'}
                  </span>
                  {rawOpmValue && <span className="text-xs font-semibold text-[#52647A] dark:text-[#CEC0E8]">dBm</span>}
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-1 truncate">
                  {hasValue(ticket.technicalReport?.opticalPowerRx) ? 'Data Technical Report OPM' : 'Menunggu input teknisi'}
                </div>
              </div>

              {/* 2. SN ONT / Modem */}
              <div className="bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl p-3.5 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#8492A5]">SN ONT / Modem</span>
                  {serialOnt && <CheckCircle2 className="w-4 h-4 text-[#218A63] dark:text-[#16A36A]" />}
                </div>
                <div className="font-mono text-[16px] text-[#5145A6] dark:text-[#DAB9FF] font-bold tracking-wide truncate tabular-nums">
                  {serialOnt || '-'}
                </div>
                <div className="text-[11px] text-[#218A63] dark:text-[#16A36A] font-medium mt-1 truncate">
                  {hasValue(ticket.oltRegistrationStatus)
                    ? ticket.oltRegistrationStatus
                    : hasValue(ticket.oltCode)
                    ? `OLT: ${ticket.oltCode}`
                    : 'Serial perangkat ONT'}
                </div>
              </div>

              {/* 3. Dropcore & FAT */}
              <div className="bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl p-3.5 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#8492A5]">Dropcore & FAT</span>
                  <span className="font-mono text-[10.5px] text-[#5145A6] dark:text-[#DAB9FF] font-bold">
                    {hasValue(ticket.fatPort) ? `Port ${ticket.fatPort}` : 'FAT Port -'}
                  </span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-[22px] text-[#26364A] dark:text-white font-bold tabular-nums">
                    {hasValue(dropcoreMeter) ? dropcoreMeter : '-'}
                  </span>
                  {hasValue(dropcoreMeter) && <span className="text-xs font-semibold text-[#52647A] dark:text-[#CEC0E8]">Meter</span>}
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-1 truncate">
                  {fatLabel ? `${fatLabel}${hasValue(ticket.fatRedamanDbm) ? ` (${ticket.fatRedamanDbm} dBm)` : ''}` : 'Kode FAT belum tercatat'}
                </div>
              </div>

              {/* 4. Laporan Lapangan (2-Tingkat: Status & Reason) */}
              <div className="bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl p-3.5 flex flex-col justify-between border border-[#DDE6F0] dark:border-[#35105E] hover:shadow-sm transition-all">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10.5px] font-bold uppercase tracking-wider text-[#8492A5]">Laporan Lapangan</span>
                  <Network className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF]" />
                </div>
                <div className="text-xs font-bold text-[#218A63] dark:text-[#16A36A] truncate">
                  L1: {tier1Label}
                </div>
                <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] mt-1 leading-snug">
                  <div className="truncate">L2: {tier2Label}</div>
                </div>
              </div>
            </div>

            {/* Bukti Dokumentasi Fisik (Real Photos) */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Camera className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF]" />
                  <h4 className="font-bold text-[14px] text-[#26364A] dark:text-white">
                    Bukti Dokumentasi Fisik & Lampiran Lapangan
                  </h4>
                </div>
                <span
                  className={`text-[10.5px] font-bold uppercase ${
                    evidencePhotos.length > 0 ? 'text-[#218A63] dark:text-[#16A36A]' : 'text-[#8492A5]'
                  }`}
                >
                  {evidencePhotos.length > 0
                    ? `${evidencePhotos.length} Foto Terunggah`
                    : 'Belum Ada Foto Bukti'}
                </span>
              </div>

              {evidencePhotos.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {evidencePhotos.map(photo => {
                    const hasGps = isValidCoordinatePair(photo.latitude, photo.longitude);
                    return (
                      <div
                        key={photo.id}
                        onClick={() => setZoomPhoto(photo)}
                        className="group relative rounded-xl overflow-hidden bg-[#F8FAFD] dark:bg-[#160D29] shadow-xs hover:shadow-md transition-all border border-[#DDE6F0] dark:border-[#35105E] cursor-pointer flex flex-col"
                      >
                        <div className="w-full h-32 overflow-hidden relative bg-[#EDF3F8] dark:bg-[#261942]">
                          {!failedImages[photo.id] ? (
                            <img
                              src={photo.url}
                              alt={photo.title}
                              referrerPolicy="no-referrer"
                              onError={() => setFailedImages(prev => ({ ...prev, [photo.id]: true }))}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-[#8492A5] p-2 text-center">
                              <ImageOff className="w-5 h-5 mb-1" />
                              <span className="text-[10px] truncate w-full">{photo.title}</span>
                            </div>
                          )}

                          {hasGps && (
                            <span
                              className={`absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded font-mono text-[9px] font-bold flex items-center gap-1 shadow-xs ${
                                photo.geotagStatus === 'weak'
                                  ? 'bg-[#C88735]/95 dark:bg-amber-600/95 text-white'
                                  : 'bg-[#218A63]/95 dark:bg-[#16A36A]/95 text-white'
                              }`}
                            >
                              <Satellite className="w-2.5 h-2.5" />
                              <span>
                                {photo.geotagStatus === 'weak' ? 'Weak GPS' : 'GPS Valid'}
                                {typeof photo.gpsAccuracyMeters === 'number'
                                  ? ` ±${Math.round(photo.gpsAccuracyMeters)}m`
                                  : ''}
                              </span>
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setZoomPhoto(photo);
                            }}
                            className="btn-3d-icon absolute top-2 right-2 w-7 h-7 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="Zoom Foto & Peta GPS"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="p-2.5 bg-white dark:bg-[#1E1238] space-y-1 flex-1 flex flex-col justify-between">
                          <div className="flex items-start justify-between gap-1.5">
                            <div className="min-w-0">
                              <div className="text-[11px] font-bold text-[#26364A] dark:text-white truncate">
                                {photo.title}
                              </div>
                              <div className="font-mono text-[10px] text-[#52647A] dark:text-[#CEC0E8] truncate">
                                {photo.subtitle}
                              </div>
                            </div>
                            <span className="tactile-chip text-[10px] px-1.5 py-0.5 rounded text-[#5145A6] dark:text-[#35105E] font-bold shrink-0">
                              Zoom
                            </span>
                          </div>

                          {hasGps && (
                            <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-[#DDE6F0]/80 dark:border-[#35105E] text-[9.5px] font-mono text-[#218A63] dark:text-emerald-300">
                              <span className="truncate">
                                {formatCoordinates(photo.latitude!, photo.longitude!)}
                              </span>
                              <a
                                href={buildGoogleMapsCoordinateUrl(photo.latitude!, photo.longitude!)}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="font-bold underline shrink-0 inline-flex items-center gap-0.5"
                              >
                                <span>Maps</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-[#CFDCE8] dark:border-[#4B386B] bg-[#F8FAFD] dark:bg-[#160D29] text-center text-[#8492A5] text-xs">
                  Belum ada foto bukti lapangan yang diunggah teknisi melalui Technical Report atau LiveChat.
                </div>
              )}
            </div>

            {/* Approved / Rejected Historical Banners */}
            {ticket.approvalStatus === 'APPROVED' && (
              <div className="p-3.5 rounded-xl bg-[#E4F5EC] dark:bg-emerald-950/40 border border-[#B7E4CC] dark:border-emerald-800 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs text-[#218A63] dark:text-emerald-200">
                <div className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-[#218A63] dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div>
                      <strong>{dispatchApprovalLabel || `Approved - ${approvedOutcome || 'Done'}`}</strong> oleh{' '}
                      <strong>{ticket.approvedBy || 'Dispatch'}</strong>
                      {ticket.approvedAt && ` pada ${new Date(ticket.approvedAt).toLocaleString('id-ID')}`}.
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold">Status WO Agent:</span>
                      <StatusAgentBadge status={approvedOutcome || ticket.statusWOAgent} />
                      <span className="px-2 py-0.5 rounded-full bg-[#26364A] dark:bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wide">
                        Ticket Result: Closed
                      </span>
                    </div>
                    {ticket.approvalNotes && <div className="italic">Catatan Verifikasi: "{ticket.approvalNotes}"</div>}
                  </div>
                </div>
              </div>
            )}

            {ticket.approvalStatus === 'REJECTED' && (
              <div className="p-3.5 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/40 border border-[#F3C5CA] dark:border-rose-800 flex items-start gap-2.5 text-xs text-[#9B2C37] dark:text-rose-200">
                <AlertCircle className="w-4 h-4 text-[#D45B66] dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  Laporan <strong>DITOLAK / PERLU REVISI</strong> oleh <strong>{ticket.rejectedBy || 'Dispatch'}</strong>
                  {ticket.rejectedAt && ` pada ${new Date(ticket.rejectedAt).toLocaleString('id-ID')}`}.
                  {ticket.rejectionReason && <div className="mt-1 font-semibold">Alasan: "{ticket.rejectionReason}"</div>}
                </div>
              </div>
            )}

            {/* Integrated Dispatch Approval & Verification Control Block */}
            {canManageApproval && ticket.approvalStatus === 'BUTUH APPROVAL' && (
              <div className="bg-[#EAE8FF]/70 dark:bg-[#261942] rounded-xl p-4 border border-[#DCE3F2] dark:border-[#4B386B] space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#DCE3F2] dark:border-[#4B386B]">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF]" />
                    <span className="font-bold text-[13.5px] text-[#26364A] dark:text-white">
                      Dispatch Approval &amp; Penentuan Status WO Agent
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
                    <span className="px-2 py-0.5 rounded-md bg-white dark:bg-[#160D29] border border-[#DCE3F2] dark:border-[#4B386B] font-semibold text-[#5145A6] dark:text-[#DAB9FF]">
                      {selectedApprovalOption.dispatchApprovalLabel}
                    </span>
                    <span className="text-[#8492A5]">&rarr;</span>
                    <StatusAgentBadge status={selectedWoAgentStatus} />
                    <span className="text-[#8492A5]">&rarr;</span>
                    <span className="px-2 py-0.5 rounded-full bg-[#26364A] dark:bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wide">
                      Ticket: Closed
                    </span>
                  </div>
                </div>

                {/* Ringkasan Laporan Installer & Agent sebagai dasar verifikasi Dispatch */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  <div className="p-2.5 rounded-lg bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#218A63] dark:text-emerald-300">
                      Laporan Pengerjaan Installer
                    </div>
                    <div className="text-[11.5px] font-semibold text-[#26364A] dark:text-white">
                      {tier1Label} {tier2Label !== '-' ? `· ${tier2Label}` : ''}
                    </div>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] line-clamp-2">
                      {latestProgress?.remarksReport || ticket.remarksWOInstaller || 'Tidak ada catatan tambahan dari teknisi.'}
                    </p>
                  </div>
                  <div className="p-2.5 rounded-lg bg-white dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                      Laporan / Catatan Agent &amp; Status Saat Ini
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusAgentBadge status={ticket.statusWOAgent} />
                      <span className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8]">
                        Installer: <strong className="text-[#26364A] dark:text-white">{ticket.statusWOInstaller}</strong>
                      </span>
                    </div>
                    <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] line-clamp-2">
                      {ticket.remarksAgent || ticket.remarks || 'Belum ada catatan agent sebelumnya.'}
                    </p>
                  </div>
                </div>

                {decisionError && (
                  <div className="p-2.5 rounded-lg bg-[#FCE9EB] dark:bg-rose-950 text-[#9B2C37] dark:text-rose-200 border border-[#F3C5CA] dark:border-rose-800 font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{decisionError}</span>
                  </div>
                )}

                {/* Dropdown Hierarki Status WO Agent */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
                  <div className="lg:col-span-4 space-y-1.5">
                    <label
                      htmlFor="dispatch-wo-agent-status"
                      className="text-[12.5px] font-bold text-[#26364A] dark:text-white flex items-center gap-1"
                    >
                      <span>Final Status WO Agent</span>
                      <span className="text-[#D45B66]">*</span>
                    </label>
                    <select
                      id="dispatch-wo-agent-status"
                      value={selectedWoAgentStatus}
                      onChange={e => setSelectedWoAgentStatus(e.target.value as DispatchApprovalWoAgentStatus)}
                      disabled={isApproving || isRejecting}
                      className="w-full px-3 py-2.5 bg-white dark:bg-[#160D29] rounded-lg text-xs font-bold text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#4B386B] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] shadow-sm cursor-pointer"
                    >
                      {DISPATCH_APPROVAL_OPTIONS.map(opt => (
                        <option key={opt.woAgentStatus} value={opt.woAgentStatus}>
                          {opt.dispatchApprovalLabel} (WO: {opt.woAgentStatus} → Ticket: {opt.ticketResult})
                        </option>
                      ))}
                    </select>
                    <p className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8] leading-snug">
                      {selectedApprovalOption.description}
                    </p>
                  </div>

                  <div className="lg:col-span-8 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="dispatcher-review-note" className="text-[12.5px] font-bold text-[#26364A] dark:text-white flex items-center gap-1">
                        <span>Catatan Verifikasi Dispatch</span>
                        <span className="text-[11px] font-normal text-[#8492A5]">(Wajib min. 3 karakter jika minta revisi)</span>
                      </label>

                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10.5px] font-bold uppercase text-[#8492A5]">Template Cepat:</span>
                        <button
                          type="button"
                          onClick={() => setDecisionNotes('Redaman optik sesuai standar, foto bukti lengkap dan sesuai SOP. Disetujui Done.')}
                          className="tactile-chip px-2 py-0.5 rounded text-[#5145A6] dark:text-[#35105E] text-[10.5px] font-bold cursor-pointer"
                        >
                          Acc Redaman Normal
                        </button>
                        <button
                          type="button"
                          onClick={() => setDecisionNotes('Foto barcode ONT atau bukti lapangan belum jelas, harap unggah ulang.')}
                          className="tactile-chip px-2 py-0.5 rounded text-[#5145A6] dark:text-[#35105E] text-[10.5px] font-bold cursor-pointer"
                        >
                          Kirim Ulang Foto
                        </button>
                        <button
                          type="button"
                          onClick={() => setDecisionNotes('SOP pemasangan lengkap, koordinat check-in valid, koneksi aktif.')}
                          className="tactile-chip px-2 py-0.5 rounded text-[#5145A6] dark:text-[#35105E] text-[10.5px] font-bold cursor-pointer"
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
                      placeholder="Tuliskan catatan verifikasi hasil teknisi / tindak lanjut WO di sini..."
                      className="w-full p-2.5 bg-white dark:bg-[#160D29] rounded-lg text-xs text-[#26364A] dark:text-white placeholder:text-[#8492A5] border border-[#DDE6F0] dark:border-[#4B386B] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5] shadow-sm"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2 pt-1">
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
                    <Save className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#DAB9FF]" />
                    <span>{isSavingNote ? 'Menyimpan...' : 'Simpan Catatan'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleConfirmApprove}
                    disabled={isApproving || isRejecting}
                    className="btn-3d-success flex-1 sm:flex-initial px-4 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>
                      {isApproving
                        ? 'Menyimpan Approval...'
                        : `Approve (${selectedWoAgentStatus}) & Close Ticket`}
                    </span>
                  </button>
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
              <div className="bg-white dark:bg-[#1E1238] rounded-xl shadow-sm p-4 sm:p-5 space-y-4 border border-[#DDE6F0] dark:border-[#35105E]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF]" />
                    <h4 className="font-bold text-[15px] text-[#26364A] dark:text-white">
                      Identitas Pelanggan & Lokasi Pemasangan
                    </h4>
                  </div>
                  <span className="text-[10.5px] font-bold uppercase text-[#218A63] dark:text-emerald-400 bg-[#E4F5EC] dark:bg-[#16A36A]/10 border border-[#B7E4CC] dark:border-transparent px-2 py-0.5 rounded">
                    ID: {ticket.idCustomer}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-[10.5px] font-bold uppercase text-[#8492A5]">Nama Pelanggan</div>
                    <div className="font-bold text-[16px] text-[#26364A] dark:text-white">{ticket.customerName}</div>
                    <div className="font-mono text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Cust ID: {ticket.idCustomer}{ticket.ticketNumber ? ` · Tiket: ${ticket.ticketNumber}` : ''}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[10.5px] font-bold uppercase text-[#8492A5]">Kontak Pelanggan</div>
                    <div className="font-mono font-bold text-[15px] text-[#26364A] dark:text-white tabular-nums">
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
                          <Phone className="w-3 h-3 text-[#6657C8] dark:text-[#DAB9FF]" />
                          <span>Telepon</span>
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Address & Geo */}
                <div className="p-3.5 bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl space-y-2 border border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[10.5px] font-bold uppercase text-[#8492A5]">Alamat Instalasi</div>
                      <div className="text-[13px] text-[#26364A] dark:text-white font-medium mt-0.5 leading-relaxed">
                        {ticket.clusterName && <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF]">[{ticket.clusterName}] </span>}
                        {ticket.address || ticket.streetName || '-'}
                        {ticket.city && <span className="block text-[11px] text-[#52647A] dark:text-[#CEC0E8]">{ticket.city} {ticket.postalCode || ''}</span>}
                      </div>
                    </div>

                    {mapsQuery && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-3d-ceramic shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1"
                      >
                        <Navigation className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#DAB9FF]" />
                        <span>Buka Maps</span>
                      </a>
                    )}
                  </div>

                  {(hasValue(ticket.latitude) || hasValue(ticket.longitude) || hasValue(ticket.area)) && (
                    <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      <MapPin className="w-3.5 h-3.5 text-[#D45B66]" />
                      <span>Area: {ticket.area || '-'}</span>
                      {hasValue(ticket.latitude) && hasValue(ticket.longitude) && (
                        <>
                          <span>·</span>
                          <span>LAT Import: {ticket.latitude}</span>
                          <span>·</span>
                          <span>LONG Import: {ticket.longitude}</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Isolated Geo-Tagged Field Locations: Lokasi Rumah & Lokasi FAT */}
                <WorkOrderLocationsCard ticket={ticket} />
              </div>

              {/* Card 2: Jadwal & Penugasan Kontraktor */}
              <div className="bg-white dark:bg-[#1E1238] rounded-xl shadow-sm p-4 sm:p-5 space-y-4 border border-[#DDE6F0] dark:border-[#35105E]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF]" />
                    <h4 className="font-bold text-[15px] text-[#26364A] dark:text-white">
                      Jadwal & Penugasan Kontraktor
                    </h4>
                  </div>
                  {hasValue(ticket.distributionStatus) && (
                    <span className="text-[10.5px] font-bold uppercase bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DCE3F2] dark:border-transparent px-2 py-0.5 rounded">
                      {String(ticket.distributionStatus).replace(/_/g, ' ')}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
                    <span className="text-[10px] font-bold uppercase text-[#8492A5]">Tanggal Appointment</span>
                    <div className="font-bold text-[14px] text-[#26364A] dark:text-white mt-0.5 tabular-nums">
                      {formatAppointmentDateDisplay(ticket.appointmentDate)}
                    </div>
                    <span className="text-[11px] text-[#6657C8] dark:text-[#DAB9FF] font-semibold">
                      {ticket.appointmentType || ticket.ticketCategory || 'Reguler'}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
                    <span className="text-[10px] font-bold uppercase text-[#8492A5]">Slot Waktu</span>
                    <div className="font-bold text-[14px] text-[#26364A] dark:text-white mt-0.5 flex items-center gap-1 tabular-nums">
                      <Clock className="w-3.5 h-3.5 text-[#C88735]" />
                      <span>{ticket.slotTime || 'Belum Ditentukan'}</span>
                    </div>
                    <span className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                      Upload: {ticket.dateUpload || ticket.createdAt?.slice(0, 10) || '-'}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
                    <span className="text-[10px] font-bold uppercase text-[#8492A5]">Mitra Pelaksana</span>
                    <div className="font-bold text-[14px] text-[#26364A] dark:text-white mt-0.5 truncate flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-[#218A63] shrink-0" />
                      <span className="truncate">{ticket.contactorName || 'Belum Dipetakan'}</span>
                    </div>
                    <span className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate block">
                      {ticket.contractorId ? `ID: ${ticket.contractorId}` : ticket.area || '-'}
                    </span>
                  </div>
                </div>

                {/* Hierarchy Assignment Flow (Korlap -> Teknisi) */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-3 bg-[#EAE8FF]/65 dark:bg-[#160D29] rounded-xl gap-3 border border-[#DCE3F2] dark:border-[#4B386B]">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#5145A6] dark:bg-[#35105E] text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {(ticket.leaderName || 'KL').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase text-[#8492A5]">Koordinator Lapangan (Korlap)</div>
                      <div className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                        {ticket.leaderName || '-'} {ticket.leaderContact ? `(${ticket.leaderContact})` : ''}
                      </div>
                    </div>
                  </div>

                  <ArrowRight className="w-4 h-4 text-[#8492A5] self-center rotate-90 sm:rotate-0 shrink-0" />

                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#2E7D8B] dark:bg-[#7135B5] text-white flex items-center justify-center font-bold text-xs shrink-0">
                      {(ticket.installerName || 'TK').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase text-[#8492A5]">Teknisi Eksekutor</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                          {ticket.installerName || <em className="text-[#C88735] font-normal">Belum Ditugaskan</em>}
                        </span>
                        {currentUser.role === 'leader' && (
                          <select
                            value={ticket.installerName || ''}
                            onChange={e => {
                              if (e.target.value !== ticket.installerName) {
                                assignTicketPersonnel(ticket.id, currentUser.name, e.target.value);
                              }
                            }}
                            className="px-2 py-0.5 text-[11px] bg-white dark:bg-[#1E1238] border border-[#DCE3F2] dark:border-[#A78BFA] rounded font-semibold text-[#5145A6] dark:text-[#DAB9FF] cursor-pointer"
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
                  <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[#52647A] dark:text-[#CEC0E8] font-bold text-[11px]">
                      <History className="w-3.5 h-3.5 text-[#C88735]" />
                      <span>Riwayat Penugasan & Reassign ({ticket.assignmentHistory.length})</span>
                    </div>
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {ticket.assignmentHistory.map((h, i) => (
                        <div key={h.id || i} className="p-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[10.5px] space-y-0.5">
                          <div className="flex items-center justify-between font-semibold gap-2">
                            <span>
                              {h.previousInstaller || h.previousInstallerName || 'Unassigned'} &rarr;{' '}
                              <span className="text-[#218A63] dark:text-[#16A36A]">{h.assignedInstaller || h.newInstallerName}</span>
                            </span>
                            <span className="font-mono text-[#8492A5] text-[10px] tabular-nums">
                              {new Date(h.timestamp).toLocaleString('id-ID')}
                            </span>
                          </div>
                          {h.reason && <div className="text-[#52647A] dark:text-[#CEC0E8] italic">"{h.reason}"</div>}
                          {h.performedBy && (
                            <div className="text-[#8492A5] text-[10px]">
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
              <div className="bg-white dark:bg-[#1E1238] rounded-xl shadow-sm p-4 sm:p-5 space-y-4 border border-[#DDE6F0] dark:border-[#35105E]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF]" />
                    <h4 className="font-bold text-[15px] text-[#26364A] dark:text-white">
                      Spesifikasi Teknis FTTH & Data Kanonik
                    </h4>
                  </div>
                  <span className="font-mono text-[10.5px] text-[#8492A5]">Hanya field terisi</span>
                </div>

                {canonicalFields.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {canonicalFields.map(item => (
                      <div
                        key={item.label}
                        className="p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]"
                      >
                        <span className="text-[10px] font-bold uppercase text-[#8492A5] block truncate">
                          {item.label}
                        </span>
                        <span
                          className={`text-[12px] font-bold text-[#26364A] dark:text-white block truncate mt-0.5 ${
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
                  <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {hasValue(ticket.remarksAgent) && (
                      <div className="p-3 rounded-lg bg-[#EAE8FF]/60 dark:bg-[#261942] border border-[#DCE3F2] dark:border-[#4B386B]">
                        <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF] block mb-1">Catatan Dispatch:</span>
                        <p className="text-[#26364A] dark:text-slate-200">{ticket.remarksAgent}</p>
                      </div>
                    )}
                    {hasValue(ticket.remarksWOInstaller) && (
                      <div className="p-3 rounded-lg bg-[#E4F5EC]/70 dark:bg-emerald-950/30 border border-[#B7E4CC] dark:border-emerald-800">
                        <span className="font-bold text-[#218A63] dark:text-emerald-300 block mb-1">Catatan Teknisi Lapangan:</span>
                        <p className="text-[#26364A] dark:text-slate-200">{ticket.remarksWOInstaller}</p>
                      </div>
                    )}
                    {hasValue(ticket.remarks) && !ticket.remarksAgent && (
                      <div className="p-3 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                        <span className="font-bold text-[#26364A] dark:text-white block mb-1">Catatan Umum:</span>
                        <p className="text-[#52647A] dark:text-[#CEC0E8]">{ticket.remarks}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Technical Report Section & Toggle */}
                <div className="pt-3 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-[#218A63]" />
                      <span className="font-bold text-[13px] text-[#26364A] dark:text-white">
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
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                        <div className="text-[10px] text-[#8492A5] uppercase font-bold">Hasil Pekerjaan</div>
                        <div className="font-bold text-[#218A63] dark:text-[#16A36A] mt-0.5">{ticket.technicalReport.workResult}</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                        <div className="text-[10px] text-[#8492A5] uppercase font-bold">Deskripsi Teknis</div>
                        <div className="font-semibold text-[#26364A] dark:text-white mt-0.5 truncate" title={ticket.technicalReport.technicalDescription || '-'}>
                          {ticket.technicalReport.technicalDescription || '-'}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                        <div className="text-[10px] text-[#8492A5] uppercase font-bold">Material Terpakai</div>
                        <div className="font-semibold text-[#26364A] dark:text-white mt-0.5 truncate">
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

                {/* Laporan Kendala Lapangan (Installer KENDALA Submissions) */}
                {Array.isArray(ticket.kendalaReports) && ticket.kendalaReports.length > 0 && (
                  <div className="pt-3 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-[#C88735] dark:text-amber-400" />
                        <span className="font-bold text-[13px] text-[#26364A] dark:text-white">
                          Laporan Kendala Lapangan
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-[#FFF2D9] dark:bg-amber-950/60 border border-[#F2CF95] dark:border-amber-800/60 text-[10px] font-bold text-[#9D661F] dark:text-amber-300 tabular-nums">
                        {ticket.kendalaReports.length} Laporan
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {ticket.kendalaReports.map((kr, idx) => {
                        const safePhoto = kr.photoUrl ? getSafePreviewUrl(kr.photoUrl) : '';
                        const timeLabel = kr.createdAt
                          ? `${new Date(kr.createdAt).toLocaleString('id-ID')} · ${formatJakartaTimeOnly(kr.createdAt)} WIB`
                          : '-';
                        return (
                          <div
                            key={kr.id || `kr-${idx}`}
                            className="p-3 rounded-xl bg-[#FFFDF7] dark:bg-[#160D29] border border-[#F2CF95] dark:border-amber-800/50 flex flex-col sm:flex-row items-start gap-3"
                          >
                            {safePhoto && (
                              <button
                                type="button"
                                onClick={() =>
                                  setZoomPhoto({
                                    id: `kendala-detail-${kr.id || idx}`,
                                    url: safePhoto,
                                    title: `Foto Kendala Lapangan #${idx + 1}`,
                                    subtitle: [kr.installerName, kr.reasonLabel || 'KENDALA', kr.createdAt ? `${formatJakartaTimeOnly(kr.createdAt)} WIB` : '']
                                      .filter(Boolean)
                                      .join(' · ')
                                  })
                                }
                                className="relative w-full sm:w-28 h-24 rounded-lg overflow-hidden border border-[#F2CF95] dark:border-amber-800/60 bg-[#EDF3F8] dark:bg-[#261942] shrink-0 group cursor-pointer"
                                title="Klik untuk memperbesar foto bukti kendala"
                              >
                                <img
                                  src={safePhoto}
                                  alt={`Bukti kendala ${idx + 1}`}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                />
                                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-[#26364A]/85 text-white font-mono text-[9px] flex items-center gap-1">
                                  <ZoomIn className="w-2.5 h-2.5" />
                                  Zoom
                                </span>
                              </button>
                            )}

                            <div className="flex-1 min-w-0 space-y-1.5">
                              <div className="flex flex-wrap items-center justify-between gap-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="px-2 py-0.5 rounded bg-[#FFF2D9] dark:bg-amber-950/70 border border-[#F2CF95] dark:border-amber-700/60 text-[10px] font-bold text-[#9D661F] dark:text-amber-300">
                                    {kr.reasonLabel || 'KENDALA LAPANGAN'}
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-[#EDF3F8] dark:bg-[#261942] text-[10px] font-semibold text-[#52647A] dark:text-[#DAB9FF]">
                                    {kr.status || 'Pending Technical'}
                                  </span>
                                </div>
                                <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#C5B3DF] tabular-nums">
                                  {timeLabel}
                                </span>
                              </div>

                              <p className="text-xs text-[#26364A] dark:text-white leading-relaxed whitespace-pre-wrap">
                                {kr.description}
                              </p>

                              <div className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8]">
                                Pelapor: <strong className="text-[#26364A] dark:text-white">{kr.installerName}</strong>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN (5/12): STICKY REAL-TIME LIVECHAT */}
            <div ref={chatSectionRef} className="lg:col-span-5 lg:sticky lg:top-0">
              {isChatOpen ? (
                <div className="rounded-xl shadow-md overflow-hidden border border-[#DCE3F2] dark:border-[#35105E] bg-white dark:bg-[#1E1238]">
                  <TicketLiveChat
                    ticket={ticket}
                    initialCategory={chatInitialCategory}
                    heightClass={isCompactUI ? 'h-[480px]' : 'h-[640px] lg:h-[740px]'}
                    onCollapse={() => setIsChatOpen(false)}
                  />
                </div>
              ) : (
                <div className="rounded-xl border-2 border-dashed border-[#CFDCE8] dark:border-[#4B386B] bg-white dark:bg-[#1E1238] p-6 space-y-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-[#EAE8FF] dark:bg-[#160D29] text-[#5145A6] dark:text-[#A78BFA] border border-[#DCE3F2] dark:border-transparent flex items-center justify-center shrink-0">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-[#26364A] dark:text-white flex items-center gap-2">
                        <span>Ticket LiveChat</span>
                        {unreadChatCount > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#D45B66] text-white">
                            {unreadChatCount > 99 ? '99+' : unreadChatCount} Belum Dibaca
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                        Thread WO {ticket.woNumber} · {ticketMessages.length} Pesan Tersimpan
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
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

          {/* Bottom Collapsible Panel: Riwayat Transaksi, Progress Reports & Log Perubahan Tiket */}
          <div
            ref={historySectionRef}
            className="bg-white dark:bg-[#1E1238] rounded-xl shadow-sm border border-[#DDE6F0] dark:border-[#35105E] overflow-hidden"
          >
            <button
              type="button"
              onClick={() => setIsHistoryOpen(prev => !prev)}
              aria-expanded={isHistoryOpen}
              className="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 text-left hover:bg-[#F0EDFF]/60 dark:hover:bg-[#261942] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <History className="w-4 h-4 text-[#6657C8] dark:text-[#DAB9FF] shrink-0" />
                <h4 className="font-bold text-[15px] text-[#26364A] dark:text-white truncate">
                  Riwayat Transaksi &amp; Log Perubahan Tiket
                </h4>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="text-[11px] font-bold text-[#8492A5] tabular-nums">
                  {relatedActivities.length} Aktivitas · {ticket.progressReports?.length || 0} Versi Report
                </span>
                {isHistoryOpen ? (
                  <ChevronUp className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                )}
              </div>
            </button>

            {isHistoryOpen && (
              <div className="px-4 sm:px-5 pb-4 sm:pb-5 pt-3 space-y-4 border-t border-[#DDE6F0] dark:border-[#35105E]">
                {relatedActivities.length > 0 ? (
                  <div className="relative pl-6 space-y-3.5 before:absolute before:left-2 before:top-1.5 before:bottom-1.5 before:w-0.5 before:bg-[#DDE6F0] dark:before:bg-[#35105E] max-h-64 overflow-y-auto pr-1">
                    {relatedActivities.map((act, idx) => (
                      <div key={act.id || idx} className="relative">
                        <span
                          className={`absolute -left-6 top-1 w-3.5 h-3.5 rounded-full ring-4 ring-white dark:ring-[#1E1238] ${
                            idx === 0 ? 'bg-[#6657C8] dark:bg-[#7135B5]' : 'bg-[#3E81C6] dark:bg-[#3977C9]'
                          }`}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                            {new Date(act.timestamp).toLocaleString('id-ID')}
                          </span>
                          <span className="text-[10px] font-bold uppercase text-[#8492A5]">
                            {act.performedBy} ({act.userRole})
                          </span>
                        </div>
                        <div className="font-semibold text-[#26364A] dark:text-white mt-0.5">{act.action}</div>
                        <div className="text-[11.5px] text-[#52647A] dark:text-[#CEC0E8]">{act.description}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                    Belum ada riwayat perubahan tiket tercatat.
                  </p>
                )}

                <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] mb-2">
                    History Progress Report &amp; Approval Versions
                  </div>
                  <HistoryProgressReportView ticketId={ticket.id} compact />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* MODAL FOOTER */}
        <div className="bg-white dark:bg-[#1E1238] px-4 sm:px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex flex-col sm:flex-row items-center justify-end gap-3 border-t border-[#DDE6F0] dark:border-[#35105E] shrink-0">
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="btn-3d-ceramic flex-1 sm:flex-initial px-4 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-bold cursor-pointer"
            >
              Tutup Modal
            </button>
            {canManageApproval ? (
              <button
                type="button"
                onClick={() => {
                  if (ticket.approvalStatus === 'BUTUH APPROVAL') {
                    void handleConfirmApprove();
                  }
                }}
                disabled={isApproving || isRejecting || isTicketClosed || ticket.approvalStatus !== 'BUTUH APPROVAL'}
                title={
                  isTicketClosed
                    ? `${dispatchApprovalLabel || 'Approved'} (Ticket Closed)`
                    : ticket.approvalStatus === 'BUTUH APPROVAL'
                    ? `Simpan Dispatch Approval (${selectedWoAgentStatus}) dan selesaikan tiket`
                    : 'Menunggu laporan teknisi masuk antrean BUTUH APPROVAL'
                }
                className="btn-3d-success flex-1 sm:flex-initial px-4 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {isApproving
                    ? 'Memproses...'
                    : isTicketClosed
                    ? `${dispatchApprovalLabel || `Approved - ${approvedOutcome || 'Done'}`} · Closed`
                    : ticket.approvalStatus === 'BUTUH APPROVAL'
                    ? `Approve (${selectedWoAgentStatus}) & Close Ticket`
                    : 'Menunggu Laporan Teknisi'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => window.print()}
                className="btn-3d-primary flex-1 sm:flex-initial px-4 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Cetak Berita Acara (BA)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Evidence Photo Lightbox + GeoTag Interactive Mini Map */}
      {zoomPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-70 bg-black/90 flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs"
          onClick={() => setZoomPhoto(null)}
        >
          <div
            className="relative w-full max-w-3xl max-h-[92dvh] min-h-0 flex flex-col gap-3 bg-[#160D29] border border-[#A78BFA]/30 rounded-2xl p-3.5 sm:p-4 overflow-y-auto overscroll-contain"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 text-white shrink-0">
              <div className="min-w-0">
                <div className="font-bold text-sm truncate">{zoomPhoto.title}</div>
                <div className="text-[11px] text-[#DAB9FF] font-mono truncate">
                  {zoomPhoto.subtitle}
                  {typeof zoomPhoto.gpsAccuracyMeters === 'number'
                    ? ` · Akurasi ±${Math.round(zoomPhoto.gpsAccuracyMeters)}m`
                    : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setZoomPhoto(null)}
                aria-label="Tutup lightbox foto"
                className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center bg-black/60 text-white rounded-full border border-white/20 hover:bg-[#DC4C5A] transition-colors cursor-pointer shadow-lg shrink-0"
                title="Tutup"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex justify-center bg-black/40 rounded-xl overflow-hidden shrink-0">
              <img
                src={zoomPhoto.url}
                alt={zoomPhoto.title}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[52dvh] object-contain"
              />
            </div>

            {isValidCoordinatePair(zoomPhoto.latitude, zoomPhoto.longitude) && (
              <div className="rounded-xl bg-[#1E1238] border border-white/10 p-2.5 shrink-0">
                <GeoLocationMiniMap
                  latitude={zoomPhoto.latitude}
                  longitude={zoomPhoto.longitude}
                  accuracyMeters={zoomPhoto.gpsAccuracyMeters}
                  geotagStatus={zoomPhoto.geotagStatus}
                  label={zoomPhoto.title}
                  markerVariant={
                    zoomPhoto.slotKey === 'customer_house'
                      ? 'house'
                      : zoomPhoto.slotKey === 'fat_attenuation'
                      ? 'fat'
                      : 'photo'
                  }
                  heightClass="h-44"
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Superadmin Delete Modal Guard */}
      {showDeleteConfirm && currentUser.role === 'super_admin' && (
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
