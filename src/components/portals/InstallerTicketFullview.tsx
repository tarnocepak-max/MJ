import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Ticket,
  ProgressReportEntry,
  ChatAttachment,
  TechnicalPhotoSlot
} from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { StatusInstallerBadge, StatusApprovalBadge, StatusBadge } from '../common/Badge';
import {
  isTicketClosed,
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus
} from '../../services/woLifecycleService';
import { buildWhatsAppClickToChatUrl } from '../../services/whatsappService';
import {
  buildGoogleMapsCoordinateUrl,
  formatCoordinates,
  isValidCoordinatePair,
  openCustomerAddressInGoogleMaps
} from '../../services/mapsService';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import { formatAppointmentDateDisplay, getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import { GeoTagCameraModal, CapturedPhotoPayload } from '../camera/GeoTagCameraModal';
import { GeoTagCameraCheckInModal } from '../camera/GeoTagCameraCheckInModal';
import {
  ArrowLeft,
  ArrowRight,
  Phone,
  MessageSquare,
  MapPin,
  CheckCircle2,
  Navigation,
  Clock,
  Radio,
  Copy,
  Check,
  Camera,
  FileText,
  History,
  AlertCircle,
  X,
  ChevronRight,
  ChevronDown,
  Lock,
  LockOpen,
  GitBranch,
  QrCode,
  Cable,
  PenTool,
  HardDriveDownload,
  Timer,
  AlertTriangle,
  User,
  Wrench,
  Trash2,
  Package,
  ShieldAlert,
  SlidersHorizontal,
  Zap,
  MoreVertical,
  Building2,
  Calendar,
  Router,
  ClipboardCheck,
  WifiOff,
  BadgeCheck,
  ExternalLink
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAnimation } from '../../context/AnimationContext';
import { useMoraJawsSound } from '../../context/SoundContext';
import { TactileConfirmModal, EscalationReasonOption } from '../common/TactileConfirmModal';
import { WorkOrderQuickUpdateSheet } from '../tickets/WorkOrderQuickUpdateSheet';
import {
  PHOTO_SLOT_DEFINITIONS,
  PhotoSlotDefinition,
  PhotoSlotKey,
  PhotoSlotsRecord,
  SlotUploadMeta,
  createEmptyPhotoSlotsMap
} from './fullview/types';
import { PhotoEvidenceMatrixSection } from './fullview/PhotoEvidenceMatrixSection';
import { PhotoLightboxModal } from './fullview/PhotoLightboxModal';
import { FullviewLiveChatSection } from './fullview/FullviewLiveChatSection';

export type FullviewFocusSection = 'checkin' | 'installation' | 'photos' | 'report' | 'checkout';

interface InstallerTicketFullviewProps {
  ticket: Ticket;
  onBack: () => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
  initialFocusSection?: FullviewFocusSection;
}

function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hrs, mins, secs].map(v => String(v).padStart(2, '0')).join(':');
}

function buildInitialPhotoSlots(ticket: Ticket): PhotoSlotsRecord {
  const map = createEmptyPhotoSlotsMap();

  const existingSlots = ticket.technicalReport?.photoSlots;
  if (Array.isArray(existingSlots)) {
    existingSlots.forEach(slot => {
      if (slot && slot.url && slot.slotKey in map) {
        map[slot.slotKey] = slot;
      }
    });
  }

  const legacyPhotos = Array.isArray(ticket.technicalReport?.photos)
    ? ticket.technicalReport!.photos
    : [];
  const legacyMapping: Array<{ slotKey: PhotoSlotKey; url?: string }> = [
    { slotKey: 'opm', url: ticket.technicalReport?.photoAfterUrl || legacyPhotos[0] },
    { slotKey: 'barcode_sn', url: legacyPhotos[1] },
    { slotKey: 'fat_pole', url: ticket.technicalReport?.photoBeforeUrl || legacyPhotos[2] },
    { slotKey: 'customer_install', url: legacyPhotos[3] }
  ];

  legacyMapping.forEach(item => {
    if (!map[item.slotKey] && item.url) {
      const def = PHOTO_SLOT_DEFINITIONS.find(d => d.slotKey === item.slotKey);
      map[item.slotKey] = {
        slotKey: item.slotKey,
        title: def?.title || item.slotKey,
        url: item.url,
        capturedAt: ticket.technicalReport?.submittedAt
          ? formatJakartaTimeOnly(ticket.technicalReport.submittedAt)
          : undefined,
        statusTag: def?.verifiedTag || 'GPS OK'
      };
    }
  });

  return map;
}

export const InstallerTicketFullview: React.FC<InstallerTicketFullviewProps> = ({
  ticket: initialTicket,
  onBack,
  onOpenWhatsApp,
  initialFocusSection
}) => {
  const {
    tickets,
    updateTicketStatus,
    saveProgressReport,
    uploadWoPhotoEvidence,
    currentUser,
    getMessagesForTicket,
    refreshMessagesForTicket,
    sendTicketMessage,
    markTicketMessagesAsRead,
    getTicketUnreadCount,
    hierarchicalStatuses,
    chatCategories,
    setTicketChatCategory,
    ticketActivities
  } = useApp();
  const { isOnline, isSyncing, pendingCount, setIsOfflineModalOpen } = useOfflineSync();
  const { toast } = useToast();
  const { showGlobalError, startLoading, stopLoading } = useAnimation();
  const { playReportSavedSound, playErrorSound } = useMoraJawsSound();

  const activeTicket = useMemo(() => {
    return tickets.find(t => t.id === initialTicket.id) || initialTicket;
  }, [tickets, initialTicket]);

  const [serverProgressTriggerByTicket, setServerProgressTriggerByTicket] = useState<
    Record<string, boolean>
  >({});
  const triggerKey = `${activeTicket.id}::${currentUser?.id || ''}`;
  const draftStorageKey = `mj_checkout_draft_${activeTicket.id}`;

  const unreadChatCount = getTicketUnreadCount(activeTicket.id);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [showProfilePopover, setShowProfilePopover] = useState(false);

  // Modals, Sheets & Section Refs
  const [showQcConfirmSheet, setShowQcConfirmSheet] = useState(false);
  const [sopChecks, setSopChecks] = useState({
    dropcoreNeat: true,
    opmClean: true,
    customerTested: true
  });
  const [showKendalaModal, setShowKendalaModal] = useState(false);
  const [isSubmittingKendala, setIsSubmittingKendala] = useState(false);
  const [showQuickUpdateSheet, setShowQuickUpdateSheet] = useState(false);
  const [showEscalationMenu, setShowEscalationMenu] = useState(false);

  const checkInSectionRef = useRef<HTMLDetailsElement>(null);
  const photoAccordionRef = useRef<HTMLDetailsElement>(null);
  const photoSectionRef = useRef<HTMLElement>(null);
  const technicalAccordionRef = useRef<HTMLDetailsElement>(null);
  const reportAccordionRef = useRef<HTMLDetailsElement>(null);
  const checkoutFormRef = useRef<HTMLFormElement>(null);
  const signatureSectionRef = useRef<HTMLDetailsElement>(null);

  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [savedReportSnapshot, setSavedReportSnapshot] = useState<{
    status: string;
    reason: string;
    rootCause: string;
    remarks: string;
  } | null>(null);

  // -------------------------------------------------------------
  // 3-TIER CASCADE REPORT STATE
  // -------------------------------------------------------------
  const latestReport = activeTicket.progressReports?.[0];
  const ticketClosed = isTicketClosed(activeTicket);
  const canonicalApproval = getTicketCanonicalApprovalStatus(activeTicket);
  const canonicalReport = getTicketCanonicalReportStatus(activeTicket);
  const latestRevisionReason =
    activeTicket.rejectionReason ||
    latestReport?.revisionReason ||
    (latestReport as any)?.rejectionReason ||
    '';

  const [reportStatus, setReportStatus] = useState<string>(() => {
    return latestReport?.reportStatus || activeTicket.reportStatusLabel || '';
  });
  const [reportStatusId, setReportStatusId] = useState<string>(() => {
    return latestReport?.reportStatusId || activeTicket.reportStatusId || '';
  });

  const [reasonReport, setReasonReport] = useState<string>(() => {
    return latestReport?.reasonReport || activeTicket.reasonReportLabel || '';
  });
  const [reasonReportId, setReasonReportId] = useState<string>(() => {
    return latestReport?.reasonReportId || activeTicket.reasonReportId || '';
  });

  const [rootCause, setRootCause] = useState<string>(() => {
    return (
      latestReport?.rootCause ||
      activeTicket.rootcauseLabel ||
      activeTicket.technicalReport?.rootCause ||
      ''
    );
  });
  const [rootcauseId, setRootcauseId] = useState<string>(() => {
    return latestReport?.rootcauseId || activeTicket.rootcauseId || '';
  });

  const [remarksReport, setRemarksReport] = useState<string>(() => {
    return (
      latestReport?.remarksReport ||
      activeTicket.remarksWOInstaller ||
      activeTicket.technicalReport?.technicalDescription ||
      ''
    );
  });

  // -------------------------------------------------------------
  // TELEMETRY, 7-POINT PHOTO EVIDENCE & CUSTOMER SIGN-OFF STATE
  // -------------------------------------------------------------
  const [opmDbm, setOpmDbm] = useState<string>(() => {
    const raw =
      activeTicket.technicalReport?.opticalPowerDbm ||
      activeTicket.technicalReport?.opticalPowerRx ||
      (activeTicket.rosetRedamanDbm !== undefined && activeTicket.rosetRedamanDbm !== null
        ? String(activeTicket.rosetRedamanDbm)
        : '');
    return raw.replace(/\s*dBm$/i, '').trim();
  });

  const [ontSerialNumber, setOntSerialNumber] = useState<string>(() => {
    return (
      activeTicket.technicalReport?.deviceSerialNumber ||
      activeTicket.ontSerialNumber ||
      activeTicket.routerSerialNumber ||
      ''
    );
  });

  const [dropcoreLength, setDropcoreLength] = useState<string>(() => {
    const raw =
      activeTicket.technicalReport?.dropcoreLength ||
      activeTicket.dropcoreLength ||
      (activeTicket.dropcoreLengthMeter !== undefined && activeTicket.dropcoreLengthMeter !== null
        ? String(activeTicket.dropcoreLengthMeter)
        : '');
    return raw.replace(/[^\d.]/g, '');
  });

  const [fatPort, setFatPort] = useState<string>(() => {
    return activeTicket.technicalReport?.fatPort || activeTicket.fatPort || '';
  });

  const [usedMaterials, setUsedMaterials] = useState<string>(() => {
    return activeTicket.technicalReport?.usedMaterials || '';
  });
  const materialInputRef = useRef<HTMLInputElement>(null);

  const [photoSlots, setPhotoSlots] = useState<PhotoSlotsRecord>(() =>
    buildInitialPhotoSlots(activeTicket)
  );
  const [cameraModalSlot, setCameraModalSlot] = useState<PhotoSlotDefinition | null>(null);
  const [showCheckInCameraModal, setShowCheckInCameraModal] = useState(false);
  const [expandedMapSlot, setExpandedMapSlot] = useState<PhotoSlotKey | null>(null);
  const [slotUploadState, setSlotUploadState] = useState<Partial<Record<PhotoSlotKey, SlotUploadMeta>>>(
    {}
  );

  // Lightbox Modal State
  const [lightboxState, setLightboxState] = useState<{
    url: string;
    slotDef?: PhotoSlotDefinition;
  } | null>(null);

  // Customer Digital Signature Canvas
  const signatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingSignatureRef = useRef(false);
  const [customerSignatureUrl, setCustomerSignatureUrl] = useState<string>(() => {
    return (
      activeTicket.customerSignatureUrl ||
      activeTicket.technicalReport?.customerSignatureUrl ||
      ''
    );
  });
  const [customerConsentConfirmed, setCustomerConsentConfirmed] = useState<boolean>(() => {
    return Boolean(
      activeTicket.technicalReport?.customerConsentConfirmed ||
        activeTicket.customerSignatureUrl ||
        activeTicket.technicalReport?.customerSignatureUrl
    );
  });

  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [showSnScannerTip, setShowSnScannerTip] = useState(false);
  const snInputRef = useRef<HTMLInputElement>(null);

  // Restore local draft when switching tickets
  useEffect(() => {
    if (ticketClosed) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (draft && typeof draft === 'object') {
        if (draft.reportStatus) setReportStatus(draft.reportStatus);
        if (draft.reportStatusId) setReportStatusId(draft.reportStatusId);
        if (draft.reasonReport) setReasonReport(draft.reasonReport);
        if (draft.reasonReportId) setReasonReportId(draft.reasonReportId);
        if (draft.rootCause) setRootCause(draft.rootCause);
        if (draft.rootcauseId) setRootcauseId(draft.rootcauseId);
        if (typeof draft.remarksReport === 'string' && draft.remarksReport.trim()) {
          setRemarksReport(draft.remarksReport);
        }
        if (typeof draft.opmDbm === 'string' && draft.opmDbm.trim()) setOpmDbm(draft.opmDbm);
        if (typeof draft.ontSerialNumber === 'string' && draft.ontSerialNumber.trim()) {
          setOntSerialNumber(draft.ontSerialNumber);
        }
        if (typeof draft.dropcoreLength === 'string' && draft.dropcoreLength.trim()) {
          setDropcoreLength(draft.dropcoreLength);
        }
        if (typeof draft.fatPort === 'string' && draft.fatPort.trim()) {
          setFatPort(draft.fatPort);
        }
        if (typeof draft.usedMaterials === 'string' && draft.usedMaterials.trim()) {
          setUsedMaterials(draft.usedMaterials);
        }
        if (draft.photoSlots && typeof draft.photoSlots === 'object') {
          setPhotoSlots(prev => {
            const next = { ...prev };
            Object.entries(draft.photoSlots).forEach(([k, val]) => {
              const key = k as PhotoSlotKey;
              if (!(key in next) || !val || typeof val !== 'object') return;
              const draftSlot = val as TechnicalPhotoSlot;
              if (!draftSlot.url) return;
              const existing = next[key];
              if (!existing || existing.uploadStatus !== 'uploaded') {
                next[key] = draftSlot;
              }
            });
            return next;
          });
        }
        if (typeof draft.customerSignatureUrl === 'string' && draft.customerSignatureUrl) {
          setCustomerSignatureUrl(draft.customerSignatureUrl);
        }
        if (typeof draft.customerConsentConfirmed === 'boolean') {
          setCustomerConsentConfirmed(draft.customerConsentConfirmed);
        }
        if (draft.savedAt) {
          setDraftSavedAt(draft.savedAt);
        }
      }
    } catch {
      // Ignore malformed draft
    }
  }, [draftStorageKey, ticketClosed]);

  // Auto-focus exact next stage section when requested via Continue Work
  useEffect(() => {
    if (!initialFocusSection) return;
    const timer = setTimeout(() => {
      if (initialFocusSection === 'checkin') {
        if (checkInSectionRef.current) checkInSectionRef.current.open = true;
        checkInSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (initialFocusSection === 'installation') {
        if (technicalAccordionRef.current) technicalAccordionRef.current.open = true;
        technicalAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (initialFocusSection === 'photos') {
        if (photoAccordionRef.current) photoAccordionRef.current.open = true;
        photoAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (initialFocusSection === 'report') {
        if (reportAccordionRef.current) reportAccordionRef.current.open = true;
        reportAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (initialFocusSection === 'checkout') {
        if (signatureSectionRef.current) signatureSectionRef.current.open = true;
        signatureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [initialFocusSection, activeTicket.id]);

  const persistDraftToDevice = useCallback(
    (notify = false) => {
      if (ticketClosed) return;
      try {
        const nowIso = new Date().toISOString();
        const payload = {
          reportStatus,
          reportStatusId,
          reasonReport,
          reasonReportId,
          rootCause,
          rootcauseId,
          remarksReport,
          opmDbm,
          ontSerialNumber,
          dropcoreLength,
          fatPort,
          usedMaterials,
          photoSlots,
          customerSignatureUrl,
          customerConsentConfirmed,
          savedAt: nowIso
        };
        localStorage.setItem(draftStorageKey, JSON.stringify(payload));
        setDraftSavedAt(nowIso);
        if (notify) {
          toast.success(
            `Draft checkout WO ${activeTicket.woNumber} tersimpan aman di perangkat lokal.`,
            'Draft Tersimpan'
          );
        }
      } catch {
        if (notify) {
          toast.warning(
            'Penyimpanan lokal penuh. Kurangi ukuran foto atau kirim langsung saat online.',
            'Draft Penuh'
          );
        }
      }
    },
    [
      ticketClosed,
      reportStatus,
      reportStatusId,
      reasonReport,
      reasonReportId,
      rootCause,
      rootcauseId,
      remarksReport,
      opmDbm,
      ontSerialNumber,
      dropcoreLength,
      fatPort,
      usedMaterials,
      photoSlots,
      customerSignatureUrl,
      customerConsentConfirmed,
      draftStorageKey,
      activeTicket.woNumber,
      toast
    ]
  );

  // Auto-save draft silently with 700ms debounce
  useEffect(() => {
    if (ticketClosed) return;
    const hasAnyInput =
      Boolean(
        reportStatus ||
          reasonReport ||
          rootCause ||
          remarksReport.trim() ||
          opmDbm ||
          ontSerialNumber ||
          dropcoreLength ||
          customerSignatureUrl
      ) || Object.values(photoSlots).some(Boolean);
    if (!hasAnyInput) return;

    const timer = setTimeout(() => {
      persistDraftToDevice(false);
    }, 700);
    return () => clearTimeout(timer);
  }, [
    ticketClosed,
    reportStatus,
    reasonReport,
    rootCause,
    remarksReport,
    opmDbm,
    ontSerialNumber,
    dropcoreLength,
    fatPort,
    photoSlots,
    customerSignatureUrl,
    customerConsentConfirmed,
    persistDraftToDevice
  ]);

  // Draw persisted signature onto canvas when mounted or restored
  useEffect(() => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(280, Math.round(rect.width || 320));
    const height = Math.max(108, Math.round(rect.height || 112));

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (customerSignatureUrl) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
      };
      img.src = customerSignatureUrl;
    }
  }, [customerSignatureUrl]);

  // -------------------------------------------------------------
  // LIVE WORK DURATION TIMER
  // -------------------------------------------------------------
  const [nowTick, setNowTick] = useState(() => Date.now());
  const sessionStartIso = activeTicket.checkInAt || activeTicket.workStartedAt;

  useEffect(() => {
    if (!sessionStartIso || activeTicket.checkOutAt || ticketClosed) return;
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [sessionStartIso, activeTicket.checkOutAt, ticketClosed]);

  const elapsedClockLabel = useMemo(() => {
    if (!sessionStartIso) return '00:00:00';
    const startMs = new Date(sessionStartIso).getTime();
    if (Number.isNaN(startMs)) return '00:00:00';
    const endMs = activeTicket.checkOutAt ? new Date(activeTicket.checkOutAt).getTime() : nowTick;
    return formatDurationClock(Math.max(0, (endMs - startMs) / 1000));
  }, [sessionStartIso, activeTicket.checkOutAt, nowTick]);

  // -------------------------------------------------------------
  // 3-TIER HIERARCHICAL OPTIONS & DEPENDENT HANDLERS
  // -------------------------------------------------------------
  const availableStatusOptions = useMemo(() => {
    if (hierarchicalStatuses && hierarchicalStatuses.length > 0) {
      return hierarchicalStatuses
        .filter(s => s.active !== false && (s as any).isActive !== false)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
    }
    return [];
  }, [hierarchicalStatuses]);

  const selectedStatusObj = useMemo(() => {
    if (!reportStatus) return null;
    const norm = reportStatus.trim().toLowerCase();
    return (
      availableStatusOptions.find(
        s =>
          s.id === reportStatusId ||
          s.name.trim().toLowerCase() === norm ||
          (s.code && s.code.trim().toLowerCase() === norm)
      ) || null
    );
  }, [availableStatusOptions, reportStatus, reportStatusId]);

  const availableReasonOptions = useMemo(() => {
    if (!selectedStatusObj) return [];
    return (selectedStatusObj.reasons || [])
      .filter(r => r.active !== false && (r as any).isActive !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [selectedStatusObj]);

  const selectedReasonObj = useMemo(() => {
    if (!reasonReport || !selectedStatusObj) return null;
    const norm = reasonReport.trim().toLowerCase();
    return (
      availableReasonOptions.find(
        r => r.id === reasonReportId || r.name.trim().toLowerCase() === norm
      ) || null
    );
  }, [availableReasonOptions, reasonReport, reasonReportId, selectedStatusObj]);

  const availableRootcauseOptions = useMemo(() => {
    if (!selectedReasonObj) return [];
    return (selectedReasonObj.remarks || [])
      .filter(rm => rm.active !== false && (rm as any).isActive !== false)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [selectedReasonObj]);

  const availableRemarksTemplates = useMemo(() => {
    return availableRootcauseOptions.map(rm => rm.text || rm.name);
  }, [availableRootcauseOptions]);

  const handleReportStatusChange = (newStatusName: string) => {
    setReportStatus(newStatusName);
    const matched = availableStatusOptions.find(
      s => s.name === newStatusName || s.id === newStatusName || (s.code && s.code === newStatusName)
    );
    setReportStatusId(matched?.id || '');
    setReasonReport('');
    setReasonReportId('');
    setRootCause('');
    setRootcauseId('');
    setReportError(null);
  };

  const handleReasonReportChange = (newReasonName: string) => {
    setReasonReport(newReasonName);
    const matched = availableReasonOptions.find(
      r => r.name === newReasonName || r.id === newReasonName
    );
    setReasonReportId(matched?.id || '');
    setRootCause('');
    setRootcauseId('');
    setReportError(null);
  };

  const handleRootcauseChange = (newRootcauseText: string) => {
    setRootCause(newRootcauseText);
    const matched = availableRootcauseOptions.find(
      rm =>
        (rm.text || rm.name) === newRootcauseText ||
        rm.name === newRootcauseText ||
        rm.id === newRootcauseText
    );
    setRootcauseId(matched?.id || '');
    setReportError(null);

    if (!remarksReport.trim()) {
      setRemarksReport(matched?.text || matched?.name || newRootcauseText);
    }
  };

  // -------------------------------------------------------------
  // OPM CALIBRATION STATUS
  // -------------------------------------------------------------
  const opmNumeric = useMemo(() => {
    const cleaned = opmDbm.replace(/[^\d.-]/g, '').trim();
    if (!cleaned || cleaned === '-') return NaN;
    return parseFloat(cleaned);
  }, [opmDbm]);

  const opmStatus = useMemo(() => {
    if (Number.isNaN(opmNumeric)) {
      return {
        label: 'Menunggu Ukur',
        badgeCls: 'bg-[#f3eaff] text-[#58149c] border-[#d8ccf3]',
        isOutOfSpec: false
      };
    }
    if (opmNumeric <= -15 && opmNumeric >= -22) {
      return {
        label: 'PASS (Optimal)',
        badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        isOutOfSpec: false
      };
    }
    if (opmNumeric > -24 && opmNumeric < -8) {
      return {
        label: 'PASS (SOP OK)',
        badgeCls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        isOutOfSpec: false
      };
    }
    return {
      label: 'Out of Spec (SOP)',
      badgeCls: 'bg-rose-50 text-[#ba1a1a] border-rose-200',
      isOutOfSpec: true
    };
  }, [opmNumeric]);

  // -------------------------------------------------------------
  // 7-POINT SOP GEOTAG CAMERA & PHOTO UPLOAD HANDLERS
  // -------------------------------------------------------------
  useEffect(() => {
    const serverSlots = activeTicket.technicalReport?.photoSlots;
    if (!Array.isArray(serverSlots) || serverSlots.length === 0) return;
    setPhotoSlots(prev => {
      const next = { ...prev };
      let changed = false;
      serverSlots.forEach(s => {
        if (s && s.url && s.slotKey in next) {
          const current = next[s.slotKey];
          if (
            !current ||
            (current.uploadStatus !== 'uploading' &&
              current.uploadStatus !== 'pending_offline' &&
              current.uploadStatus !== 'failed') ||
            current.clientCaptureId === s.clientCaptureId
          ) {
            if (
              !current ||
              current.url !== s.url ||
              current.capturedAtIso !== s.capturedAtIso ||
              current.latitude !== s.latitude ||
              current.longitude !== s.longitude ||
              current.uploadStatus !== s.uploadStatus
            ) {
              next[s.slotKey] = s;
              changed = true;
            }
          }
        }
      });
      return changed ? next : prev;
    });
  }, [activeTicket.technicalReport?.photoSlots]);

  const uploadedPhotoSlotsList = useMemo(() => {
    return PHOTO_SLOT_DEFINITIONS.map(def => photoSlots[def.slotKey]).filter(
      (s): s is TechnicalPhotoSlot => Boolean(s && s.url)
    );
  }, [photoSlots]);

  const messages = getMessagesForTicket(activeTicket.id);

  // Authoritative check against persisted DB LiveChat messages for PROGRESS check-in
  const persistedProgressMessage = useMemo(() => {
    const cleanUid = String(currentUser?.id || '').trim();
    if (!cleanUid) return undefined;
    const targetId = String(activeTicket.id || '').trim();
    const targetWo = String(activeTicket.woNumber || '').trim().toUpperCase();

    return (messages || []).find(m => {
      if (!m || !m.id) return false;
      const msgId = String(m.id).trim();
      if (
        !msgId ||
        msgId.startsWith('temp_') ||
        msgId.startsWith('pending_') ||
        msgId.startsWith('local_offline_')
      ) {
        return false;
      }
      if (
        (m as any)._offlineSyncStatus === 'pending' ||
        (m as any).status === 'failed' ||
        (m as any).status === 'pending'
      ) {
        return false;
      }

      const msgTicketId = String(m.ticketId || '').trim();
      const msgWo = String(m.woNumber || '').trim().toUpperCase();
      const woMatches =
        (targetId && msgTicketId === targetId) ||
        (targetWo && msgWo === targetWo) ||
        (targetId && msgWo === targetId.toUpperCase());
      if (!woMatches) return false;

      const senderId = String(m.senderId || '').trim();
      if (!senderId || senderId !== cleanUid) return false;

      return String(m.category || '').trim().toUpperCase() === 'PROGRESS';
    });
  }, [messages, activeTicket.id, activeTicket.woNumber, currentUser?.id]);

  const hasPersistedProgressFromCurrentTechnician = Boolean(persistedProgressMessage);

  const hasValidProgressFromCurrentTechnician =
    currentUser.role === 'installer' &&
    (hasPersistedProgressFromCurrentTechnician ||
      Boolean(serverProgressTriggerByTicket[triggerKey]) ||
      Boolean(activeTicket.checkInAt));

  const requiresProgressCheckIn =
    currentUser.role === 'installer' && !hasValidProgressFromCurrentTechnician;

  const validatedCheckInTime = useMemo(() => {
    const iso = persistedProgressMessage?.timestamp || activeTicket.checkInAt;
    if (!iso) return '-';
    return formatJakartaTimeOnly(iso);
  }, [persistedProgressMessage?.timestamp, activeTicket.checkInAt]);

  // Validate assignment & installer login before triggering Check-In camera modal
  const handleTriggerCheckIn = useCallback(() => {
    if (ticketClosed) return;
    if (!currentUser?.id) {
      toast.error('Sesi login teknisi tidak valid. Silakan login kembali.', 'Login Diperlukan');
      return;
    }
    if (currentUser.role === 'installer') {
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const myName = (currentUser.name || '').toLowerCase().trim();
      const tInst = (activeTicket.installerName || '').toLowerCase().trim();
      const isAssignedToMe =
        (myId && (activeTicket.assignedTo === myId || activeTicket.installerId === myId)) ||
        (myUsername && activeTicket.assignedTo?.toLowerCase() === myUsername) ||
        (myName && tInst && (tInst === myName || tInst.includes(myName) || myName.includes(tInst))) ||
        (myUsername && tInst && (tInst === myUsername || tInst.includes(myUsername)));

      if (!isAssignedToMe) {
        toast.error('WO ini belum di-assign kepada akun Installer Anda.', 'Validasi Assignment');
        return;
      }
    }
    setShowCheckInCameraModal(true);
  }, [ticketClosed, currentUser, activeTicket, toast]);

  const openCameraForSlot = useCallback(
    (slotDef: PhotoSlotDefinition) => {
      if (ticketClosed) return;
      if (
        slotDef.slotKey === 'customer_house' &&
        requiresProgressCheckIn &&
        currentUser.role === 'installer'
      ) {
        handleTriggerCheckIn();
        return;
      }
      setCameraModalSlot(slotDef);
    },
    [ticketClosed, requiresProgressCheckIn, currentUser.role, handleTriggerCheckIn]
  );

  const openCameraForSlotKey = useCallback(
    (slotKey: PhotoSlotKey) => {
      const def = PHOTO_SLOT_DEFINITIONS.find(d => d.slotKey === slotKey);
      if (def) openCameraForSlot(def);
    },
    [openCameraForSlot]
  );

  const computeSlotBadgeText = useCallback(
    (slotDef: PhotoSlotDefinition): string => {
      if (slotDef.slotKey === 'opm') return opmDbm ? `${opmDbm} dBm` : slotDef.defaultTag;
      if (slotDef.slotKey === 'barcode_sn')
        return ontSerialNumber ? ontSerialNumber.slice(0, 14) : slotDef.defaultTag;
      if (slotDef.slotKey === 'fat_pole') return activeTicket.fatCode || slotDef.defaultTag;
      if (slotDef.slotKey === 'fat_port') {
        const cleanPort = (fatPort || activeTicket.fatPort || '').replace(/^#/, '').trim();
        return cleanPort ? `Port #${cleanPort}` : slotDef.defaultTag;
      }
      if (slotDef.slotKey === 'customer_house') return 'Lokasi Rumah';
      if (slotDef.slotKey === 'fat_attenuation')
        return activeTicket.fatCode ? `FAT ${activeTicket.fatCode}` : 'Lokasi FAT';
      return slotDef.defaultTag;
    },
    [opmDbm, ontSerialNumber, activeTicket.fatCode, fatPort, activeTicket.fatPort]
  );

  const executeSlotUpload = useCallback(
    async (slotDef: PhotoSlotDefinition, payload: CapturedPhotoPayload) => {
      const gps = payload.gps;
      const hasValidGps = Boolean(gps && isValidCoordinatePair(gps.latitude, gps.longitude));
      const badgeValue = computeSlotBadgeText(slotDef);
      const localCapturedLabel = formatJakartaTimeOnly(payload.capturedAtIso);

      setPhotoSlots(prev => ({
        ...prev,
        [slotDef.slotKey]: {
          slotKey: slotDef.slotKey,
          title: slotDef.title,
          url: payload.fileData,
          fileName: payload.fileName,
          fileSizeBytes: payload.fileSizeBytes,
          mimeType: payload.mimeType,
          capturedAt: localCapturedLabel,
          capturedAtIso: payload.capturedAtIso,
          badgeText: badgeValue,
          statusTag: hasValidGps ? slotDef.verifiedTag : 'NO GPS',
          latitude: hasValidGps ? gps!.latitude : undefined,
          longitude: hasValidGps ? gps!.longitude : undefined,
          gpsAccuracyMeters: gps?.accuracyMeters,
          altitudeMeters: gps?.altitudeMeters,
          headingDeg: gps?.headingDeg,
          speedMps: gps?.speedMps,
          locationSource: gps?.locationSource,
          permissionStatus: gps?.permissionStatus,
          geotagStatus: gps?.geotagStatus || 'missing',
          captureMethod: payload.captureMethod,
          uploadStatus: 'uploading',
          clientCaptureId: payload.clientCaptureId
        }
      }));

      setSlotUploadState(prev => ({
        ...prev,
        [slotDef.slotKey]: { status: 'uploading', pendingPayload: payload }
      }));

      const res = await uploadWoPhotoEvidence(activeTicket.id, {
        slotKey: slotDef.slotKey,
        title: slotDef.title,
        fileData: payload.fileData,
        fileName: payload.fileName,
        mimeType: payload.mimeType,
        capturedAt: payload.capturedAtIso,
        latitude: hasValidGps ? gps!.latitude : undefined,
        longitude: hasValidGps ? gps!.longitude : undefined,
        gpsAccuracyMeters: gps?.accuracyMeters,
        altitudeMeters: gps?.altitudeMeters,
        headingDeg: gps?.headingDeg,
        speedMps: gps?.speedMps,
        locationSource: gps?.locationSource,
        permissionStatus: gps?.permissionStatus,
        geotagStatus: gps?.geotagStatus || 'missing',
        captureMethod: payload.captureMethod,
        badgeText: badgeValue,
        statusTag: hasValidGps ? slotDef.verifiedTag : 'NO GPS',
        clientCaptureId: payload.clientCaptureId,
        woNumber: activeTicket.woNumber
      });

      if (res.success && res.photoSlot) {
        setPhotoSlots(prev => ({
          ...prev,
          [slotDef.slotKey]: res.photoSlot!
        }));
        setSlotUploadState(prev => {
          const copy = { ...prev };
          delete copy[slotDef.slotKey];
          return copy;
        });

        if (slotDef.slotKey === 'customer_house' && res.houseLocation) {
          toast.success(
            `Foto #01 Rumah tersimpan & Lokasi Rumah WO otomatis diperbarui.`,
            'Lokasi Rumah Diperbarui'
          );
        } else if (slotDef.slotKey === 'fat_attenuation' && res.fatLocation) {
          toast.success(
            `Foto #03 Redaman FAT tersimpan & Lokasi FAT WO otomatis diperbarui.`,
            'Lokasi FAT Diperbarui'
          );
        } else {
          toast.success(`Foto [${slotDef.slotNumber}] "${slotDef.title}" berhasil diunggah.`);
        }
      } else {
        const errText = res.error || 'Gagal mengunggah foto ke server.';
        setPhotoSlots(prev => {
          const curr = prev[slotDef.slotKey];
          if (!curr) return prev;
          return {
            ...prev,
            [slotDef.slotKey]: {
              ...curr,
              uploadStatus: 'failed'
            }
          };
        });
        setSlotUploadState(prev => ({
          ...prev,
          [slotDef.slotKey]: {
            status: 'failed',
            error: errText,
            pendingPayload: payload
          }
        }));
        toast.error(
          `${errText} Tekan "Retry" untuk mengirim ulang tanpa ambil foto ulang.`,
          'Upload Foto Tertunda'
        );
      }
    },
    [activeTicket.id, activeTicket.woNumber, computeSlotBadgeText, toast, uploadWoPhotoEvidence]
  );

  const handleConfirmCameraCapture = useCallback(
    async (payload: CapturedPhotoPayload) => {
      const def = PHOTO_SLOT_DEFINITIONS.find(d => d.slotKey === payload.slotKey);
      if (!def) return;
      setCameraModalSlot(null);
      await executeSlotUpload(def, payload);
    },
    [executeSlotUpload]
  );

  const handleRetrySlotUpload = useCallback(
    async (slotDef: PhotoSlotDefinition) => {
      const pending = slotUploadState[slotDef.slotKey]?.pendingPayload;
      if (!pending) {
        openCameraForSlot(slotDef);
        return;
      }
      await executeSlotUpload(slotDef, pending);
    },
    [executeSlotUpload, openCameraForSlot, slotUploadState]
  );

  // -------------------------------------------------------------
  // CUSTOMER SIGNATURE PAD HANDLERS
  // -------------------------------------------------------------
  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handleSignaturePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ticketClosed) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture(e.pointerId);
    isDrawingSignatureRef.current = true;
    const { x, y } = getCanvasPoint(e);
    ctx.strokeStyle = '#58149c';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const handleSignaturePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingSignatureRef.current || ticketClosed) return;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasPoint(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handleSignaturePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingSignatureRef.current) return;
    isDrawingSignatureRef.current = false;
    const canvas = signatureCanvasRef.current;
    if (!canvas) return;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {}
    try {
      const dataUrl = canvas.toDataURL('image/png');
      setCustomerSignatureUrl(dataUrl);
    } catch {}
  };

  const handleClearSignature = () => {
    if (ticketClosed) return;
    const canvas = signatureCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    setCustomerSignatureUrl('');
  };

  // -------------------------------------------------------------
  // LIVE CHAT ROOM STATE & HANDLERS
  // -------------------------------------------------------------
  const [chatCategory, setChatCategory] = useState<string>(() => {
    const existing = String(activeTicket.chatCategory || '').trim();
    return existing && existing.toUpperCase() !== 'UNCLASSIFIED' ? existing : '';
  });

  const activeChatCategories = useMemo(() => {
    const seen = new Set<string>();
    return chatCategories.filter(c => {
      if (c.active === false || (c as any).isActive === false) return false;
      const upper = String(c.name || '').trim().toUpperCase();
      if (!upper || upper === 'UNCLASSIFIED' || seen.has(upper)) return false;
      seen.add(upper);
      return true;
    });
  }, [chatCategories]);

  const currentChatCategoryObj = useMemo(() => {
    return chatCategories.find(c => c.name === chatCategory || c.id === chatCategory) || null;
  }, [chatCategories, chatCategory]);

  const [chatInputText, setChatInputText] = useState('');
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [isChatActive, setIsChatActive] = useState(false);
  const [showHistorySection, setShowHistorySection] = useState(true);

  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatSectionRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsChatActive(false);
    let cancelled = false;
    const activeKey = `${activeTicket.id}::${currentUser?.id || ''}`;
    refreshMessagesForTicket(activeTicket.id).then(res => {
      if (cancelled) return;
      setServerProgressTriggerByTicket(prev => ({
        ...prev,
        [activeKey]: Boolean(res?.hasProgressTrigger)
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [activeTicket.id, currentUser?.id, refreshMessagesForTicket]);

  useEffect(() => {
    const existing = String(activeTicket.chatCategory || '').trim();
    if (existing && existing.toUpperCase() !== 'UNCLASSIFIED') {
      setChatCategory(existing);
    } else {
      setChatCategory('');
    }
  }, [activeTicket.id, activeTicket.chatCategory]);

  const handleChatCategorySelect = async (newCat: string) => {
    setChatCategory(newCat);
    setChatError(null);
    if (newCat) {
      await setTicketChatCategory(activeTicket.id, newCat);
      toast.success(`Kategori chat disinkronkan ke "${newCat}".`);
    }
  };

  const handleOpenProgressChatForCheckIn = async () => {
    const progressCat =
      activeChatCategories.find(c => String(c.name || '').trim().toUpperCase() === 'PROGRESS')?.name ||
      'PROGRESS';
    setChatCategory(progressCat);
    await setTicketChatCategory(activeTicket.id, progressCat);
    setIsChatActive(true);
    if (reportAccordionRef.current) reportAccordionRef.current.open = true;
    setTimeout(() => {
      chatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      chatInputRef.current?.focus();
    }, 180);
    toast.info('Kategori PROGRESS dipilih. Kirim pesan untuk mencatat Check-In otomatis.', 'Siap Check-In');
  };

  useEffect(() => {
    const tryMarkRead = () => {
      if (!isChatActive) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      markTicketMessagesAsRead(activeTicket.id);
    };
    tryMarkRead();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') tryMarkRead();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [isChatActive, activeTicket.id, messages.length, markTicketMessagesAsRead]);

  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleChatFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      if (!validTypes.includes(file.type)) {
        const msg = 'Format foto harus JPG, JPEG, PNG, atau WebP.';
        setChatError(msg);
        toast.error(msg, 'Format Tidak Didukung');
        setTimeout(() => setChatError(null), 4000);
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        const msg = `Ukuran file "${file.name}" melebihi batas 5MB.`;
        setChatError(msg);
        toast.error(msg, 'File Terlalu Besar');
        setTimeout(() => setChatError(null), 4000);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const attachment: ChatAttachment = {
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          url: dataUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type
        };
        setChatAttachments(prev => [...prev, attachment]);
        toast.info(`Foto "${file.name}" siap dikirim.`, 'Lampiran Ditambahkan');
      };
      reader.readAsDataURL(file);
    });

    if (chatFileInputRef.current) {
      chatFileInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    setChatAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handleSendChatMessage = async (e?: React.FormEvent, directText?: string) => {
    if (e) e.preventDefault();
    if (isSendingChat) return;

    const cleanCat = String(chatCategory || '').trim();
    if (!cleanCat || cleanCat.toUpperCase() === 'UNCLASSIFIED') {
      const msg = 'Pilih kategori chat wajib terlebih dahulu (mis. PROGRESS) sebelum mengirim pesan.';
      setChatError(msg);
      toast.error(msg, 'Kategori Wajib Dipilih');
      return;
    }

    const text = directText !== undefined ? directText : chatInputText;
    if (!text.trim() && chatAttachments.length === 0) {
      return;
    }

    setIsChatActive(true);
    setIsSendingChat(true);
    setChatError(null);

    try {
      const res = await sendTicketMessage(activeTicket.id, text.trim(), chatAttachments, cleanCat);
      if (res.success) {
        setChatInputText('');
        setChatAttachments([]);
        if (currentUser.role === 'installer' && res.hasProgressTrigger) {
          setServerProgressTriggerByTicket(prev => ({
            ...prev,
            [triggerKey]: true
          }));
        }
      } else {
        const err = res.error || 'Gagal mengirim pesan chat.';
        setChatError(err);
        toast.error(err, 'Chat Gagal');
        setTimeout(() => setChatError(null), 4000);
      }
    } finally {
      setIsSendingChat(false);
    }
  };

  // -------------------------------------------------------------
  // PRE-SUBMIT VALIDATION -> QC SHEET -> EXECUTE CHECK-OUT & SAVE
  // -------------------------------------------------------------
  const validateBeforeSubmit = (): boolean => {
    if (ticketClosed) {
      playErrorSound();
      const msg = 'Work Order ini sudah berstatus CLOSED (disetujui Dispatch) dan terkunci read-only.';
      setReportError(msg);
      toast.error(msg, 'WO Sudah Closed');
      return false;
    }

    if (requiresProgressCheckIn) {
      playErrorSound();
      const msg =
        'Check-In belum tercatat! Lakukan Check-In Foto Rumah GPS terlebih dahulu.';
      setReportError(msg);
      toast.error(msg, 'Check-In Wajib (#PROGRESS)');
      handleTriggerCheckIn();
      return false;
    }

    if (!reportStatus) {
      const msg = 'LEVEL 1: Report Status wajib dipilih.';
      setReportError(msg);
      toast.warning(msg, 'Lengkapi Report');
      if (reportAccordionRef.current) reportAccordionRef.current.open = true;
      checkoutFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (!reasonReport) {
      const msg = 'LEVEL 2: Reason Report wajib dipilih.';
      setReportError(msg);
      toast.warning(msg, 'Lengkapi Report');
      if (reportAccordionRef.current) reportAccordionRef.current.open = true;
      checkoutFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (availableRootcauseOptions.length > 0 && !rootCause) {
      const msg = 'LEVEL 3: Rootcause Code wajib dipilih.';
      setReportError(msg);
      toast.warning(msg, 'Lengkapi Report');
      if (reportAccordionRef.current) reportAccordionRef.current.open = true;
      checkoutFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    if (!remarksReport.trim()) {
      const msg = 'Work Description / Catatan Teknisi wajib diisi.';
      setReportError(msg);
      toast.warning(msg, 'Lengkapi Report');
      if (reportAccordionRef.current) reportAccordionRef.current.open = true;
      checkoutFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    setReportError(null);
    return true;
  };

  const handleOpenQcSheet = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSubmittingReport) return;
    if (!validateBeforeSubmit()) return;
    setShowQcConfirmSheet(true);
  };

  const handleSaveReport = async () => {
    if (isSubmittingReport) return;
    if (!validateBeforeSubmit()) return;

    setShowQcConfirmSheet(false);
    setReportError(null);
    setIsSubmittingReport(true);
    startLoading({
      title: 'MENYIMPAN REPORT & CHECK-OUT...',
      subtitle: 'Menyimpan laporan 3-tingkat, telemetri teknis, 7 bukti foto & Check-Out ke database'
    });

    try {
      const normalizedOpm = opmDbm.trim()
        ? opmDbm.trim().toLowerCase().includes('dbm')
          ? opmDbm.trim()
          : `${opmDbm.trim()} dBm`
        : '';

      const res = await saveProgressReport(activeTicket.id, {
        reportStatus,
        reportStatusId,
        reasonReport,
        reasonReportId,
        rootCause,
        rootcauseId,
        remarksReport: remarksReport.trim(),
        technicalTelemetry: {
          opticalPowerDbm: normalizedOpm || undefined,
          fatRedamanDbm: activeTicket.fatRedamanDbm ? String(activeTicket.fatRedamanDbm) : undefined,
          ontSerialNumber: ontSerialNumber.trim() || undefined,
          dropcoreLength: dropcoreLength.trim() || undefined,
          fatPort: fatPort.trim() || undefined,
          usedMaterials: usedMaterials.trim() || undefined,
          photoSlots: uploadedPhotoSlotsList,
          photos: uploadedPhotoSlotsList.map(s => s.url),
          customerSignatureUrl: customerSignatureUrl || undefined,
          customerConsentConfirmed
        }
      });

      if (res.success) {
        try {
          localStorage.removeItem(draftStorageKey);
          setDraftSavedAt(null);
        } catch {}
        playReportSavedSound();
        setSavedReportSnapshot({
          status: reportStatus,
          reason: reasonReport,
          rootCause,
          remarks: remarksReport.trim()
        });
        setShowSuccessAlert(true);
        toast.success(
          `Report "${reportStatus}" & Check-Out berhasil dikirim ke Dispatch (BUTUH APPROVAL).`,
          'CHECK-OUT BERHASIL',
          { withSound: true }
        );
      } else {
        playErrorSound();
        const errMsg = res.error || 'Gagal menyimpan laporan ke database.';
        setReportError(errMsg);
        if ((res as any).code === 'CHECK_IN_REQUIRED') {
          toast.error(errMsg, 'Check-In PROGRESS Diperlukan');
        } else {
          showGlobalError({
            errorCode: 'MJ-DB-002',
            module: 'Database',
            operation: 'Save Progress Report',
            description: 'Gagal menyimpan data laporan checkout.',
            message: errMsg,
            technicalDetails: errMsg,
            severity: 'HIGH',
            onRetry: () => handleSaveReport()
          });
        }
      }
    } catch (err: any) {
      playErrorSound();
      const errMsg = err?.message || 'Terjadi kesalahan sistem saat menyimpan laporan.';
      setReportError(errMsg);
      showGlobalError({
        errorCode: 'MJ-DB-002',
        module: 'Database',
        operation: 'Save Progress Report Exception',
        description: 'Terjadi kegagalan komunikasi dengan server database.',
        message: errMsg,
        technicalDetails: errMsg,
        severity: 'HIGH',
        onRetry: () => handleSaveReport()
      });
    } finally {
      setIsSubmittingReport(false);
      stopLoading();
    }
  };

  const handleConfirmKendalaFromFullview = async ({
    selectedReason,
    notes
  }: {
    selectedReason?: EscalationReasonOption;
    notes: string;
  }) => {
    if (!selectedReason) return;
    setIsSubmittingKendala(true);
    try {
      const targetStatus = selectedReason.targetInstallerStatus || 'Pending Technical';
      const prefix = selectedReason.isReschedule ? 'RESCHEDULE' : 'KENDALA LAPANGAN';
      updateTicketStatus(
        activeTicket.id,
        targetStatus === 'Failed / Cancelled' ? 'Cancelled' : undefined,
        targetStatus,
        `[${prefix}: ${selectedReason.label}] ${notes}`
      );
      await sendTicketMessage(
        activeTicket.id,
        `${prefix} — ${selectedReason.label}. Catatan: ${notes}`,
        [],
        'ISSUE'
      );
      toast.warning(
        `Kendala WO ${activeTicket.woNumber} dilaporkan ke Dispatch (#ISSUE).`,
        'Kendala Dilaporkan',
        { withSound: true }
      );
      setShowKendalaModal(false);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal melaporkan kendala.', 'Gagal');
    } finally {
      setIsSubmittingKendala(false);
    }
  };

  const handleConfirmRedirect = () => {
    if (isRedirecting) return;
    setIsRedirecting(true);
    setShowSuccessAlert(false);
    onBack();
  };

  // -------------------------------------------------------------
  // HISTORY PROGRESS REPORTS LIST
  // -------------------------------------------------------------
  const progressHistory: ProgressReportEntry[] = useMemo(() => {
    const list = [...(activeTicket.progressReports || [])];

    if (activeTicket.technicalReport && !list.some(r => r.id === activeTicket.technicalReport?.id)) {
      list.push({
        id: activeTicket.technicalReport.id || 'rep-legacy',
        ticketId: activeTicket.id,
        timestamp: activeTicket.technicalReport.submittedAt || activeTicket.updatedAt || activeTicket.createdAt,
        submittedBy: activeTicket.technicalReport.submittedBy || activeTicket.installerName || 'Teknisi Lapangan',
        userRole: 'installer',
        reportStatus: activeTicket.statusWOInstaller || 'Completed',
        reasonReport: activeTicket.technicalReport.workResult || 'Laporan Teknis Awal',
        rootCause: activeTicket.technicalReport.rootCause || '-',
        remarksReport:
          activeTicket.technicalReport.technicalDescription ||
          activeTicket.remarksWOInstaller ||
          activeTicket.technicalReport.correctiveAction ||
          'Pengerjaan telah dilaksanakan sesuai prosedur teknis.',
        installerName: activeTicket.installerName,
        appointmentDate: activeTicket.appointmentDate || '',
        slotTime: activeTicket.slotTime
      });
    }

    return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [activeTicket]);

  const waUrlObj = buildWhatsAppClickToChatUrl(
    activeTicket.customerPhone,
    `Halo ${activeTicket.customerName}, saya teknisi ${currentUser.name || 'MoraJaws'} terkait penanganan tiket WO ${activeTicket.woNumber} hari ini.`
  );

  const handleCopyAddress = () => {
    const fullAddr = [
      activeTicket.streetName || activeTicket.address,
      activeTicket.clusterName,
      activeTicket.area
    ]
      .filter(Boolean)
      .join(', ');
    if (navigator.clipboard && fullAddr) {
      navigator.clipboard.writeText(fullAddr);
      setCopiedAddress(true);
      toast.success('Alamat lengkap berhasil disalin ke clipboard.', 'Disalin');
      setTimeout(() => setCopiedAddress(false), 2000);
    }
  };

  const handleOpenMaps = () => {
    openCustomerAddressInGoogleMaps(activeTicket, () => {
      toast.warning('Alamat pelanggan belum tersedia untuk Google Maps.', 'Google Maps');
    });
  };

  const handleOtwLokasi = () => {
    updateTicketStatus(
      activeTicket.id,
      undefined,
      'En Route',
      `Teknisi ${currentUser.name} sedang berangkat menuju lokasi.`
    );
    toast.success('Status diubah menjadi En Route (Otw Lokasi).', 'Otw Lokasi');
    handleOpenMaps();
  };

  const woBadgeLabel = activeTicket.appointmentType || activeTicket.ticketCategory || 'Instalasi FTTH';
  const serviceLabel =
    activeTicket.installationType ||
    activeTicket.plan ||
    activeTicket.serviceType ||
    'FTTH Broadband';
  const appointmentDateRaw = getTicketAppointmentDate(activeTicket) || activeTicket.appointmentDate || '-';
  const appointmentDateDisplay = formatAppointmentDateDisplay(appointmentDateRaw) || appointmentDateRaw;

  const isSignatureReady = Boolean(customerSignatureUrl) && customerConsentConfirmed;
  const totalPhotoSlots = PHOTO_SLOT_DEFINITIONS.length;
  const uploadedPhotoCount = uploadedPhotoSlotsList.length;

  const isCheckInStepDone = !requiresProgressCheckIn || Boolean(activeTicket.checkInAt);
  const isInstallationStepDone =
    isCheckInStepDone && (Boolean(opmDbm.trim()) || Boolean(ontSerialNumber.trim()) || Boolean(fatPort.trim()));
  const isPhotosStepDone = uploadedPhotoCount >= totalPhotoSlots;
  const isReportStepDone = Boolean(
    (reportStatus &&
      reasonReport &&
      (availableRootcauseOptions.length === 0 || rootCause) &&
      remarksReport.trim()) ||
      (activeTicket.progressReports && activeTicket.progressReports.length > 0 && canonicalApproval !== 'REVISION')
  );
  const isCheckOutDone = Boolean(activeTicket.checkOutAt) || ticketClosed;

  const isCheckoutFormReady = Boolean(
    reportStatus && reasonReport && (availableRootcauseOptions.length === 0 || rootCause) && remarksReport.trim()
  );

  const relatedActivities = useMemo(() => {
    return (ticketActivities || [])
      .filter(a => a.ticketId === activeTicket.id || a.woNumber === activeTicket.woNumber)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [ticketActivities, activeTicket.id, activeTicket.woNumber]);

  const rawCustomerPhone = String(activeTicket.customerPhone || '').trim();
  const telCustomerHref = rawCustomerPhone ? `tel:${rawCustomerPhone.replace(/[^\d+]/g, '')}` : '';

  const lightboxMatchedSlot = useMemo(() => {
    if (!lightboxState) return undefined;
    if (lightboxState.slotDef) {
      return photoSlots[lightboxState.slotDef.slotKey] || undefined;
    }
    return uploadedPhotoSlotsList.find(
      s =>
        s.url === lightboxState.url ||
        getSafePreviewUrl(s.url) === getSafePreviewUrl(lightboxState.url)
    );
  }, [lightboxState, photoSlots, uploadedPhotoSlotsList]);

  const lightboxMatchedSlotDef = useMemo(() => {
    if (!lightboxState) return undefined;
    if (lightboxState.slotDef) return lightboxState.slotDef;
    if (lightboxMatchedSlot) {
      return PHOTO_SLOT_DEFINITIONS.find(d => d.slotKey === lightboxMatchedSlot.slotKey);
    }
    return undefined;
  }, [lightboxState, lightboxMatchedSlot]);

  const userInitials = useMemo(() => {
    const name = currentUser?.name || 'TK';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(s => s[0].toUpperCase())
      .join('');
  }, [currentUser?.name]);

  const houseCoordsValid = isValidCoordinatePair(
    activeTicket.houseLocation?.latitude,
    activeTicket.houseLocation?.longitude
  );

  return (
    <div className="fixed inset-0 z-45 bg-[#fcf8ff] text-[#1f1638] flex flex-col overflow-hidden">
      {/* ============================================================== */}
      {/* MORAJAWS LIGHT ENTERPRISE STICKY HEADER                        */}
      {/* ============================================================== */}
      <header className="bg-white pt-safe border-b border-[#e8ddff] shadow-xs shrink-0 z-20">
        <div className="max-w-6xl mx-auto h-15 px-3 sm:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onBack}
              aria-label="Kembali ke Daftar WO"
              className="w-9 h-9 flex items-center justify-center rounded-xl mj-btn-secondary text-[#1f1638] cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] font-bold text-[#58149c] truncate">
                  {activeTicket.woNumber}
                </span>
                <span className="font-mono text-[10px] text-[#7d7484] tabular-nums hidden sm:inline">
                  • Durasi {elapsedClockLabel}
                </span>
              </div>
              <h1 className="font-display text-[15px] sm:text-base font-bold truncate text-[#1f1638] leading-tight">
                Detail Work Order
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsOfflineModalOpen(true)}
              aria-label="Status Koneksi & Sinkronisasi"
              className={`relative h-9 px-2.5 flex items-center gap-1.5 rounded-xl border text-[11px] font-bold cursor-pointer transition-colors ${
                !isOnline || pendingCount > 0
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : 'bg-[#f8f1ff] text-[#58149c] border-[#e8ddff] hover:bg-[#f3eaff]'
              }`}
            >
              {isOnline ? <Radio className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{!isOnline ? 'Offline' : isSyncing ? 'Sync' : 'Online'}</span>
              {pendingCount > 0 && (
                <span className="min-w-[16px] h-4 px-1 rounded-full bg-amber-600 text-white font-mono text-[9.5px] font-bold flex items-center justify-center tabular-nums">
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              )}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowProfilePopover(prev => !prev)}
                aria-label="Info Teknisi"
                className="w-9 h-9 rounded-full bg-[#7135b5] text-white font-display font-bold text-xs flex items-center justify-center shadow-xs cursor-pointer relative"
              >
                <span>{userInitials}</span>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${
                    isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
              </button>

              {showProfilePopover && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowProfilePopover(false)} />
                  <div className="absolute right-0 mt-2 w-64 rounded-xl bg-white border border-[#e8ddff] shadow-lg p-3.5 z-30 text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e8ddff]">
                      <div className="min-w-0">
                        <div className="font-bold text-[#1f1638] truncate">{currentUser.name}</div>
                        <div className="font-mono text-[10.5px] text-[#58149c]">
                          @{currentUser.username}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-[#f3eaff] text-[#58149c] font-mono text-[10px] font-bold uppercase shrink-0">
                        {currentUser.role}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#4b4452] space-y-1">
                      <div>
                        Mitra: <strong className="text-[#1f1638]">{activeTicket.contractorName || currentUser.contractor || '-'}</strong>
                      </div>
                      <div>
                        Area: <strong className="text-[#1f1638]">{activeTicket.area || currentUser.area || '-'}</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowProfilePopover(false);
                        setIsOfflineModalOpen(true);
                      }}
                      className="w-full py-2 px-2.5 rounded-lg mj-btn-secondary text-[11px] flex items-center justify-between cursor-pointer"
                    >
                      <span>Sinkronisasi Offline</span>
                      <span className="font-mono font-bold text-[#58149c]">{pendingCount} antre</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ============================================================== */}
      {/* SCROLLABLE MAIN WORKSPACE — 9 STRUCTURED SECTIONS              */}
      {/* ============================================================== */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 pb-10 space-y-3.5">

          {/* TOP GRID: 1. WO Information | 2. Customer Information | 3. Appointment */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* ---------------------------------------------------------- */}
            {/* SECTION 1: WO INFORMATION                                  */}
            {/* ---------------------------------------------------------- */}
            <section className="mj-enterprise-card rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e8ddff]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                    1
                  </span>
                  <h2 className="font-display font-bold text-sm text-[#1f1638] truncate">
                    WO Information
                  </h2>
                </div>
                <StatusInstallerBadge status={activeTicket.statusWOInstaller} />
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7d7484]">No. WO</span>
                  <span className="font-mono font-bold text-[#58149c]">{activeTicket.woNumber}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7d7484]">Kategori / Work Type</span>
                  <span className="font-semibold text-[#1f1638] truncate">{woBadgeLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7d7484]">Layanan</span>
                  <span className="font-semibold text-[#1f1638] truncate">{serviceLabel}</span>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
                  <span className="text-[#7d7484]">Status Approval</span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {canonicalReport !== 'NONE' && (
                      <StatusBadge status={canonicalReport} variant="report" />
                    )}
                    {activeTicket.approvalStatus && activeTicket.approvalStatus !== 'NONE' ? (
                      <StatusApprovalBadge status={activeTicket.approvalStatus} />
                    ) : (
                      <span className="font-mono text-[10.5px] text-[#7d7484]">Belum Submit</span>
                    )}
                  </div>
                </div>
              </div>

              {(activeTicket.remarksAgent || activeTicket.remarks) && (
                <div className="bg-[#f8f1ff] rounded-xl p-2.5 border border-[#e8ddff] text-[11px] text-[#4b4452] leading-snug">
                  <span className="font-bold text-[#58149c] block mb-0.5">Catatan Dispatch:</span>
                  <p className="line-clamp-3">{activeTicket.remarksAgent || activeTicket.remarks}</p>
                </div>
              )}
            </section>

            {/* ---------------------------------------------------------- */}
            {/* SECTION 2: CUSTOMER INFORMATION                            */}
            {/* ---------------------------------------------------------- */}
            <section className="mj-enterprise-card rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e8ddff]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                    2
                  </span>
                  <h2 className="font-display font-bold text-sm text-[#1f1638] truncate">
                    Customer Information
                  </h2>
                </div>
                <span className="font-mono text-[10.5px] font-semibold text-[#7d7484] shrink-0">
                  {activeTicket.idCustomer || activeTicket.customerId || '-'}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div>
                  <div className="font-display font-bold text-[15px] text-[#1f1638] truncate">
                    {activeTicket.customerName || activeTicket.endUserName || 'Pelanggan'}
                  </div>
                  <div className="font-mono text-[11.5px] text-[#4b4452] mt-0.5">
                    {rawCustomerPhone || 'No. HP belum tersedia'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="w-full text-left flex items-start gap-1.5 p-2 rounded-xl bg-[#f8f1ff] border border-[#e8ddff] text-[11.5px] text-[#4b4452] hover:text-[#1f1638] cursor-pointer"
                  title="Ketuk untuk menyalin alamat"
                >
                  {copiedAddress ? (
                    <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[#58149c] shrink-0 mt-0.5" />
                  )}
                  <span className="line-clamp-2 leading-snug">
                    {[activeTicket.streetName || activeTicket.address, activeTicket.clusterName, activeTicket.area]
                      .filter(Boolean)
                      .join(', ') || 'Alamat belum tercatat'}
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={handleOpenMaps}
                  className="px-2.5 py-1.5 rounded-lg mj-btn-secondary text-[11px] inline-flex items-center gap-1 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#58149c]" />
                  <span>Maps</span>
                </button>

                {telCustomerHref && (
                  <a
                    href={telCustomerHref}
                    className="px-2.5 py-1.5 rounded-lg mj-btn-secondary text-[11px] inline-flex items-center gap-1"
                  >
                    <Phone className="w-3.5 h-3.5 text-[#58149c]" />
                    <span>Telepon</span>
                  </a>
                )}

                {activeTicket.customerPhone &&
                  (waUrlObj.url ? (
                    <a
                      href={waUrlObj.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenWhatsApp(activeTicket)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>WhatsApp</span>
                    </button>
                  ))}

                {!ticketClosed && (
                  <button
                    type="button"
                    onClick={handleOtwLokasi}
                    className="px-2.5 py-1.5 rounded-lg mj-btn-secondary text-[11px] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Navigation className="w-3.5 h-3.5 text-[#58149c]" />
                    <span>Otw</span>
                  </button>
                )}
              </div>
            </section>

            {/* ---------------------------------------------------------- */}
            {/* SECTION 3: APPOINTMENT                                     */}
            {/* ---------------------------------------------------------- */}
            <section className="mj-enterprise-card rounded-2xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e8ddff]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                    3
                  </span>
                  <h2 className="font-display font-bold text-sm text-[#1f1638] truncate">
                    Appointment
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1 font-mono text-[10.5px] font-bold text-[#58149c] bg-[#f8f1ff] px-2 py-0.5 rounded-full border border-[#e8ddff]">
                  <Calendar className="w-3 h-3" />
                  <span>{activeTicket.slotTime || 'Fleksibel'}</span>
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7d7484]">Tanggal Jadwal</span>
                  <span className="font-bold text-[#1f1638]">{appointmentDateDisplay}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7d7484]">Slot Waktu</span>
                  <span className="font-mono font-semibold text-[#1f1638]">
                    {activeTicket.slotTime || '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#7d7484]">Area</span>
                  <span className="font-semibold text-[#1f1638] truncate">
                    {activeTicket.area || '-'}
                  </span>
                </div>
              </div>

              <div className="bg-[#f8f1ff] rounded-xl p-2.5 border border-[#e8ddff] flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#7135b5] text-white font-display font-bold text-xs flex items-center justify-center shrink-0">
                  {(activeTicket.installerName || 'T').slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[#1f1638] truncate">
                    {activeTicket.installerName || 'Belum Ditugaskan'}
                  </div>
                  <div className="text-[10.5px] text-[#4b4452] truncate">
                    Mitra: {activeTicket.contactorName || activeTicket.contractorName || '-'} · Korlap:{' '}
                    {activeTicket.leaderName || '-'}
                  </div>
                </div>
                <Building2 className="w-4 h-4 text-[#7d7484] shrink-0" />
              </div>
            </section>
          </div>

          {/* ------------------------------------------------------------ */}
          {/* SECTION 4: WORK PROGRESS                                     */}
          {/* ------------------------------------------------------------ */}
          <section className="mj-enterprise-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                  4
                </span>
                <h2 className="font-display font-bold text-sm text-[#1f1638]">
                  Work Progress
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#f8f1ff] border border-[#e8ddff] font-mono text-[11px] font-bold text-[#58149c] tabular-nums">
                  <Timer className="w-3.5 h-3.5" />
                  <span>{elapsedClockLabel}</span>
                </span>
                {!ticketClosed && (
                  <button
                    type="button"
                    onClick={() => setShowKendalaModal(true)}
                    className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-[#ba1a1a] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Kendala</span>
                  </button>
                )}
              </div>
            </div>

            {/* 5-Stage Progress Stepper */}
            <div className="bg-[#f8f1ff] rounded-xl p-2.5 border border-[#e8ddff] grid grid-cols-5 gap-1.5 text-center">
              {[
                {
                  label: 'Check-In',
                  done: isCheckInStepDone,
                  active: !isCheckInStepDone,
                  sub: isCheckInStepDone ? 'OK' : 'Wajib',
                  onClick: () => {
                    if (requiresProgressCheckIn) handleTriggerCheckIn();
                    else {
                      if (checkInSectionRef.current) checkInSectionRef.current.open = true;
                      checkInSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                  }
                },
                {
                  label: 'Instalasi',
                  done: isInstallationStepDone,
                  active: isCheckInStepDone && !isInstallationStepDone,
                  sub: opmDbm ? `${opmDbm} dBm` : 'Teknis',
                  onClick: () => {
                    if (technicalAccordionRef.current) technicalAccordionRef.current.open = true;
                    technicalAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                },
                {
                  label: 'Foto',
                  done: isPhotosStepDone,
                  active: isInstallationStepDone && !isPhotosStepDone,
                  sub: `${uploadedPhotoCount}/${totalPhotoSlots}`,
                  onClick: () => {
                    if (photoAccordionRef.current) photoAccordionRef.current.open = true;
                    photoAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                },
                {
                  label: 'Report',
                  done: isReportStepDone,
                  active: isCheckInStepDone && !isReportStepDone,
                  sub: isReportStepDone ? 'Siap' : '3-Tier',
                  onClick: () => {
                    if (reportAccordionRef.current) reportAccordionRef.current.open = true;
                    reportAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                },
                {
                  label: 'Check-Out',
                  done: isCheckOutDone,
                  active: isReportStepDone && !isCheckOutDone,
                  sub: isCheckOutDone ? 'Selesai' : isSignatureReady ? 'TTD OK' : 'Final',
                  onClick: () => {
                    if (signatureSectionRef.current) signatureSectionRef.current.open = true;
                    signatureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }
              ].map((step, i) => (
                <button
                  key={step.label}
                  type="button"
                  onClick={step.onClick}
                  className="flex flex-col items-center p-1.5 rounded-lg hover:bg-white/80 transition-colors cursor-pointer"
                >
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10.5px] font-bold mb-1 ${
                      step.done
                        ? 'bg-emerald-600 text-white'
                        : step.active
                        ? 'bg-[#7135b5] text-white ring-2 ring-[#dab9ff]'
                        : 'bg-[#e8ddff] text-[#4b4452]'
                    }`}
                  >
                    {step.done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                  </div>
                  <span className="text-[10.5px] font-bold text-[#1f1638] leading-tight truncate max-w-full">
                    {step.label}
                  </span>
                  <span className="font-mono text-[9px] text-[#7d7484] truncate max-w-full">
                    {step.sub}
                  </span>
                </button>
              ))}
            </div>

            {ticketClosed && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                <div className="space-y-0.5 min-w-0">
                  <div className="font-bold text-emerald-900 flex items-center gap-2 flex-wrap">
                    <span>Work Order CLOSED (Read-Only)</span>
                    <StatusBadge status="APPROVED" variant="approval" />
                  </div>
                  <p className="text-[11px] text-emerald-800">
                    Laporan akhir ({canonicalReport !== 'NONE' ? canonicalReport : activeTicket.statusWOInstaller}) telah disetujui Dispatch{' '}
                    {activeTicket.approvedBy ? `(${activeTicket.approvedBy})` : ''}.
                  </p>
                </div>
              </div>
            )}

            {!ticketClosed && canonicalApproval === 'REVISION' && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-[#93000a] text-xs space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wide">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Revisi Laporan Diminta Dispatch</span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#ba1a1a] text-white font-mono text-[10px] font-bold">
                    Revisi v{(activeTicket.progressReports?.length || 0) + 1}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Alasan ({latestReport?.rejectedBy || activeTicket.rejectedBy || 'Dispatch'}): &ldquo;
                  {latestRevisionReason || 'Silakan perbaiki laporan dan kirim ulang.'}&rdquo;
                </p>
              </div>
            )}
          </section>

          {/* ------------------------------------------------------------ */}
          {/* SECTION 5: CHECK-IN INFORMATION                              */}
          {/* ------------------------------------------------------------ */}
          <details
            ref={checkInSectionRef}
            open={requiresProgressCheckIn || initialFocusSection === 'checkin'}
            className="group mj-enterprise-card rounded-2xl overflow-hidden"
          >
            <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                  5
                </span>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-sm text-[#1f1638] truncate">
                    Check-In Information
                  </h2>
                  <span className="text-[11px] text-[#7d7484] block truncate">
                    {isCheckInStepDone
                      ? `Tercatat pukul ${validatedCheckInTime} WIB • Valid #PROGRESS`
                      : 'Belum Check-In — Foto Rumah GPS wajib diambil di lokasi'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    isCheckInStepDone
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-amber-50 text-amber-800 border-amber-200'
                  }`}
                >
                  {isCheckInStepDone ? 'Sudah Check-In' : 'Belum Check-In'}
                </span>
                <ChevronDown className="w-4 h-4 text-[#7d7484] transition-transform duration-200 group-open:rotate-180" />
              </div>
            </summary>

            <div className="px-4 pb-4 pt-1 border-t border-[#e8ddff] space-y-3">
              {requiresProgressCheckIn ? (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Camera className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900">
                      <div className="font-bold">Siap Memulai Pekerjaan? Lakukan Check-In GPS</div>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        Menekan tombol CHECK-IN akan mengaktifkan kamera, validasi koordinat GPS, mengambil Foto Rumah (#01), dan mencatat timestamp Check-In serta #PROGRESS.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {!ticketClosed && (
                      <button
                        type="button"
                        onClick={handleTriggerCheckIn}
                        className="px-4 py-2.5 rounded-xl mj-tactile-btn-primary text-xs inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Camera className="w-4 h-4" />
                        <span>CHECK-IN</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleOpenProgressChatForCheckIn}
                      className="px-3 py-2.5 rounded-xl mj-btn-secondary text-xs cursor-pointer"
                    >
                      LiveChat #PROGRESS
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-[#f8f1ff] rounded-xl p-3 border border-[#e8ddff] text-xs">
                  <div>
                    <span className="text-[10.5px] text-[#7d7484] block">Waktu Check-In</span>
                    <span className="font-mono font-bold text-[#1f1638] inline-flex items-center gap-1 mt-0.5">
                      <LockOpen className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{validatedCheckInTime} WIB</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-[#7d7484] block">Validasi SOP</span>
                    <span className="font-bold text-emerald-700 block mt-0.5">
                      #PROGRESS Tervalidasi
                    </span>
                  </div>
                  <div>
                    <span className="text-[10.5px] text-[#7d7484] block">Koordinat GPS Rumah</span>
                    {houseCoordsValid ? (
                      <a
                        href={buildGoogleMapsCoordinateUrl(
                          activeTicket.houseLocation!.latitude,
                          activeTicket.houseLocation!.longitude
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono font-bold text-[#58149c] hover:underline inline-flex items-center gap-1 mt-0.5 truncate"
                      >
                        <span>
                          {formatCoordinates(
                            activeTicket.houseLocation!.latitude,
                            activeTicket.houseLocation!.longitude
                          )}
                        </span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    ) : (
                      <span className="font-mono text-[#7d7484] block mt-0.5">
                        Menunggu Foto #01 Rumah
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>

          {/* ------------------------------------------------------------ */}
          {/* SECTION 6: BUKTI FOTO FISIK (ORDERED 1-7)                    */}
          {/* ------------------------------------------------------------ */}
          <details
            ref={photoAccordionRef}
            open
            className="group mj-enterprise-card rounded-2xl overflow-hidden"
          >
            <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                  6
                </span>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-sm text-[#1f1638] truncate">
                    Bukti Foto Fisik
                  </h2>
                  <span className="text-[11px] text-[#7d7484] block truncate">
                    7 Foto SOP wajib berurutan (Rumah, FAT, Redaman FAT, Port FAT, Instalasi, SN ONT, OPM)
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-0.5 rounded-full bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold tabular-nums border border-[#d8ccf3]">
                  {uploadedPhotoCount}/{totalPhotoSlots}
                </span>
                <ChevronDown className="w-4 h-4 text-[#7d7484] transition-transform duration-200 group-open:rotate-180" />
              </div>
            </summary>

            <div className="px-4 pb-4 pt-1 border-t border-[#e8ddff]">
              <PhotoEvidenceMatrixSection
                sectionRef={photoSectionRef}
                activeTicket={activeTicket}
                photoSlots={photoSlots}
                uploadedCount={uploadedPhotoCount}
                slotUploadState={slotUploadState}
                expandedMapSlot={expandedMapSlot}
                onToggleMapSlot={setExpandedMapSlot}
                ticketClosed={ticketClosed}
                opmDbm={opmDbm}
                fatPort={fatPort}
                ontSerialNumber={ontSerialNumber}
                onOpenCamera={openCameraForSlot}
                onOpenCameraByKey={openCameraForSlotKey}
                onRetryUpload={handleRetrySlotUpload}
                onViewPhoto={(url, slotDef) => setLightboxState({ url, slotDef })}
              />
            </div>
          </details>

          {/* ------------------------------------------------------------ */}
          {/* SECTION 7: TECHNICAL INFORMATION                             */}
          {/* ------------------------------------------------------------ */}
          <details
            ref={technicalAccordionRef}
            open
            className="group mj-enterprise-card rounded-2xl overflow-hidden"
          >
            <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                  7
                </span>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-sm text-[#1f1638] truncate">
                    Technical Information
                  </h2>
                  <span className="font-mono text-[11px] text-[#7d7484] block truncate">
                    {activeTicket.fatCode || activeTicket.fdtCode || '-'} •{' '}
                    {fatPort.trim() ? `Port ${fatPort}` : 'Port belum diisi'}
                    {opmDbm.trim() ? ` • ${opmDbm} dBm` : ''}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border ${opmStatus.badgeCls}`}>
                  {opmStatus.label}
                </span>
                <ChevronDown className="w-4 h-4 text-[#7d7484] transition-transform duration-200 group-open:rotate-180" />
              </div>
            </summary>

            <div className="px-4 pb-4 pt-2 border-t border-[#e8ddff] space-y-3">
              {/* Allocation Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-[#f8f1ff] p-3 rounded-xl border border-[#e8ddff]">
                <div>
                  <span className="text-[10.5px] text-[#7d7484] block">FAT / OLT</span>
                  <span className="font-mono text-xs text-[#1f1638] font-bold truncate block">
                    {activeTicket.fatCode || activeTicket.oltCode || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[10.5px] text-[#7d7484] block">Port Assignment</span>
                  <span className="font-mono text-xs text-[#58149c] font-bold truncate block">
                    {fatPort.trim() ? `Port ${fatPort.replace(/^#/, '')}` : 'Menunggu Input'}
                  </span>
                </div>
                <div>
                  <span className="text-[10.5px] text-[#7d7484] block">Redaman Roset / FAT</span>
                  <span className={`font-mono text-xs font-bold truncate block ${opmStatus.isOutOfSpec ? 'text-[#ba1a1a]' : 'text-emerald-700'}`}>
                    {opmDbm.trim()
                      ? `${opmDbm.trim()} dBm`
                      : activeTicket.fatRedamanDbm
                      ? `${activeTicket.fatRedamanDbm} dBm`
                      : 'Belum Diukur'}
                  </span>
                </div>
                <div>
                  <span className="text-[10.5px] text-[#7d7484] block">Standar SOP</span>
                  <span className="font-mono text-xs text-[#4b4452] font-semibold">
                    -15 s/d -24 dBm
                  </span>
                </div>
              </div>

              {/* ONT Info Pill */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#f8f1ff] border border-[#e8ddff] gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Router className="w-4 h-4 text-[#58149c] shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs text-[#1f1638] block font-bold truncate">
                      {activeTicket.ontBrand || 'GPON ONT'} {activeTicket.ontModel || ''}
                    </span>
                    <span className={`font-mono text-[10.5px] block truncate ${ontSerialNumber.trim() ? 'text-emerald-700 font-semibold' : 'text-[#7d7484]'}`}>
                      {ontSerialNumber.trim()
                        ? `SN Terinput: ${ontSerialNumber.trim()}`
                        : 'SN belum diinput / tunggu Foto #06'}
                    </span>
                  </div>
                </div>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white border border-[#e8ddff] text-[#58149c] font-bold shrink-0">
                  ONT
                </span>
              </div>

              {/* Calibration Form Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label htmlFor="opm-input" className="text-xs font-bold text-[#1f1638]">
                      Redaman OPM Roset (dBm)
                    </label>
                    <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold border ${opmStatus.badgeCls}`}>
                      {opmStatus.label}
                    </span>
                  </div>
                  <div className="relative flex items-center">
                    <input
                      id="opm-input"
                      type="text"
                      inputMode="decimal"
                      value={opmDbm}
                      disabled={ticketClosed || isSubmittingReport}
                      onChange={e => setOpmDbm(e.target.value)}
                      placeholder="-18.50"
                      className={`w-full bg-[#f8f1ff] border border-[#e8ddff] font-mono font-bold text-base rounded-xl py-2 pl-3 pr-14 focus:outline-none focus:ring-2 focus:ring-[#7135b5] tabular-nums disabled:opacity-60 ${
                        opmStatus.isOutOfSpec ? 'text-[#ba1a1a]' : 'text-[#1f1638]'
                      }`}
                    />
                    <span className="absolute right-3 font-mono text-xs font-semibold text-[#7d7484]">
                      dBm
                    </span>
                  </div>
                </div>

                <div>
                  <label htmlFor="ont-sn-input" className="block text-xs font-bold text-[#1f1638] mb-1">
                    Nomor Seri (SN) ONT / Modem
                  </label>
                  <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                      <input
                        id="ont-sn-input"
                        ref={snInputRef}
                        type="text"
                        value={ontSerialNumber}
                        disabled={ticketClosed || isSubmittingReport}
                        onChange={e => setOntSerialNumber(e.target.value.toUpperCase())}
                        placeholder="Masukkan SN ONT (mis. ZTEG-XXXX)"
                        className="w-full bg-[#f8f1ff] border border-[#e8ddff] text-[#1f1638] font-mono font-bold text-xs rounded-xl py-2.5 pl-3 pr-9 focus:outline-none focus:ring-2 focus:ring-[#7135b5] uppercase tracking-wider disabled:opacity-60"
                      />
                      {ontSerialNumber.trim().length >= 6 && (
                        <CheckCircle2 className="w-4 h-4 absolute right-3 top-2.5 text-emerald-600" />
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={ticketClosed}
                      onClick={() => {
                        setShowSnScannerTip(prev => !prev);
                        snInputRef.current?.focus();
                      }}
                      className="w-10 h-10 shrink-0 rounded-xl mj-tactile-btn-primary flex items-center justify-center cursor-pointer disabled:opacity-50"
                      title="Fokus SN ONT & Foto Barcode"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>
                  </div>
                  {showSnScannerTip && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#f8f1ff] border border-[#d8ccf3] text-[11px] text-[#4b4452]">
                      <span>Ketik SN manual atau foto stiker barcode pada Slot #06.</span>
                      <button
                        type="button"
                        onClick={() => openCameraForSlotKey('barcode_sn')}
                        className="font-mono font-bold text-[#58149c] underline shrink-0 cursor-pointer"
                      >
                        Foto #06 SN
                      </button>
                    </div>
                  )}
                </div>

                <div>
                  <label htmlFor="dropcore-input" className="block text-xs font-bold text-[#1f1638] mb-1">
                    Panjang Dropcore
                  </label>
                  <div className="relative">
                    <input
                      id="dropcore-input"
                      type="number"
                      min={0}
                      value={dropcoreLength}
                      disabled={ticketClosed || isSubmittingReport}
                      onChange={e => setDropcoreLength(e.target.value)}
                      placeholder="0"
                      className="w-full bg-[#f8f1ff] border border-[#e8ddff] text-[#1f1638] font-mono font-bold text-xs rounded-xl py-2.5 pl-3 pr-14 focus:outline-none focus:ring-2 focus:ring-[#7135b5] tabular-nums disabled:opacity-60"
                    />
                    <span className="absolute right-3 top-2.5 font-mono text-[11px] text-[#7d7484]">
                      Meter
                    </span>
                  </div>
                </div>

                <div>
                  <label htmlFor="fat-port-input" className="block text-xs font-bold text-[#1f1638] mb-1">
                    Port FAT Aktif
                  </label>
                  <div className="relative">
                    <input
                      id="fat-port-input"
                      type="text"
                      value={fatPort}
                      disabled={ticketClosed || isSubmittingReport}
                      onChange={e => setFatPort(e.target.value)}
                      placeholder="Port 06"
                      className="w-full bg-[#f8f1ff] border border-[#e8ddff] text-[#1f1638] font-mono font-bold text-xs rounded-xl py-2.5 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-[#7135b5] disabled:opacity-60"
                    />
                    <Cable className="w-4 h-4 absolute right-2.5 top-2.5 text-[#58149c] pointer-events-none" />
                  </div>
                </div>
              </div>

              {/* Used Materials */}
              <div>
                <label htmlFor="materials-input" className="flex items-center gap-1.5 text-xs font-bold text-[#1f1638] mb-1">
                  <Package className="w-3.5 h-3.5 text-[#58149c]" />
                  <span>Material Terpakai di Lapangan</span>
                </label>
                <input
                  id="materials-input"
                  ref={materialInputRef}
                  type="text"
                  value={usedMaterials}
                  disabled={ticketClosed || isSubmittingReport}
                  onChange={e => setUsedMaterials(e.target.value)}
                  placeholder="Contoh: Dropcore 85m, 1x ONT, 2x Fast Connector, 1x Roset"
                  className="w-full bg-[#f8f1ff] border border-[#e8ddff] text-[#1f1638] text-xs rounded-xl py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-[#7135b5] disabled:opacity-60"
                />
                {!ticketClosed && (
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {['Fast Connector (2x)', 'Roset 1 Port', 'Patchcord SC-UPC', 'Clamp S (2x)'].map(
                      chip => (
                        <button
                          key={chip}
                          type="button"
                          onClick={() => {
                            setUsedMaterials(prev => {
                              const clean = prev.trim();
                              if (!clean) return chip;
                              if (clean.toLowerCase().includes(chip.toLowerCase())) return clean;
                              return `${clean}, ${chip}`;
                            });
                          }}
                          className="tactile-chip px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#58149c] cursor-pointer"
                        >
                          + {chip}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            </div>
          </details>

          {/* ------------------------------------------------------------ */}
          {/* SECTION 8: REPORT (3-TIER REPORT, HISTORY & LIVECHAT)        */}
          {/* ------------------------------------------------------------ */}
          <details
            ref={reportAccordionRef}
            open
            className="group mj-enterprise-card rounded-2xl overflow-hidden"
          >
            <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                  8
                </span>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-sm text-[#1f1638] truncate">
                    Report &amp; Koordinasi Lapangan
                  </h2>
                  <span className="text-[11px] text-[#7d7484] block truncate">
                    Laporan 3-Tingkat (L1/L2/L3), Catatan Commissioning, Riwayat &amp; LiveChat
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {unreadChatCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-50 text-[#ba1a1a] border border-rose-200">
                    {unreadChatCount} Chat Baru
                  </span>
                )}
                <ChevronDown className="w-4 h-4 text-[#7d7484] transition-transform duration-200 group-open:rotate-180" />
              </div>
            </summary>

            <div className="px-4 pb-4 pt-2 border-t border-[#e8ddff] space-y-4">
              {reportError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-[#ba1a1a] text-xs flex items-center gap-2 font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{reportError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Left: 3-Tier Cascade Report + Work Description */}
                <form
                  ref={checkoutFormRef}
                  onSubmit={handleOpenQcSheet}
                  className="lg:col-span-6 space-y-3"
                >
                  <div className="bg-[#f8f1ff] rounded-xl p-3.5 border border-[#e8ddff] space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <GitBranch className="w-4 h-4 text-[#58149c]" />
                        <h3 className="font-display font-bold text-[13.5px] text-[#1f1638]">
                          Laporan Teknis 3-Tingkat
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-white text-[#58149c] border border-[#d8ccf3] font-mono text-[10px] font-bold">
                        Wajib SOP
                      </span>
                    </div>

                    {/* Flow Tracker */}
                    <div className="flex items-center justify-between px-3 py-1.5 bg-white rounded-lg text-[10.5px] font-mono border border-[#e8ddff]">
                      <span className={reportStatus ? 'text-emerald-700 font-bold' : 'text-[#7d7484]'}>
                        L1: Status
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#7d7484]" />
                      <span className={reasonReport ? 'text-emerald-700 font-bold' : 'text-[#7d7484]'}>
                        L2: Reason
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#7d7484]" />
                      <span className={rootCause ? 'text-emerald-700 font-bold' : 'text-[#7d7484]'}>
                        L3: Rootcause
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-xs font-bold text-[#1f1638] mb-1">
                          Level 1: Report Status <span className="text-[#ba1a1a]">*</span>
                        </label>
                        <div className="relative">
                          <select
                            value={reportStatus}
                            disabled={ticketClosed || isSubmittingReport}
                            onChange={e => handleReportStatusChange(e.target.value)}
                            className="w-full bg-white border border-[#e8ddff] text-[#1f1638] font-semibold text-xs rounded-xl py-2.5 pl-3 pr-9 appearance-none focus:outline-none focus:ring-2 focus:ring-[#7135b5] cursor-pointer disabled:opacity-55"
                          >
                            <option value="">-- Pilih Report Status (Level 1) --</option>
                            {availableStatusOptions.map(st => (
                              <option key={st.id} value={st.name}>
                                {st.name}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="w-4 h-4 absolute right-3 top-2.5 text-[#58149c] pointer-events-none" />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-[#1f1638] mb-1">
                          Level 2: Reason Report <span className="text-[#ba1a1a]">*</span>
                        </label>
                        <div className="relative">
                          <select
                            value={reasonReport}
                            disabled={
                              ticketClosed ||
                              isSubmittingReport ||
                              !reportStatus ||
                              availableReasonOptions.length === 0
                            }
                            onChange={e => handleReasonReportChange(e.target.value)}
                            className="w-full bg-white border border-[#e8ddff] text-[#1f1638] font-semibold text-xs rounded-xl py-2.5 pl-3 pr-9 appearance-none focus:outline-none focus:ring-2 focus:ring-[#7135b5] cursor-pointer disabled:opacity-50"
                          >
                            {!reportStatus ? (
                              <option value="">-- Pilih Report Status Terlebih Dahulu --</option>
                            ) : availableReasonOptions.length === 0 ? (
                              <option value="">-- Tidak ada pilihan tersedia --</option>
                            ) : (
                              <>
                                <option value="">-- Pilih Reason Report (Level 2) --</option>
                                {availableReasonOptions.map(rs => (
                                  <option key={rs.id} value={rs.name}>
                                    {rs.name}
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                          <ChevronDown className="w-4 h-4 absolute right-3 top-2.5 text-[#58149c] pointer-events-none" />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-[#1f1638] mb-1">
                          Level 3: Rootcause Code <span className="text-[#ba1a1a]">*</span>
                        </label>
                        <div className="relative">
                          <select
                            value={rootCause}
                            disabled={
                              ticketClosed ||
                              isSubmittingReport ||
                              !reasonReport ||
                              availableRootcauseOptions.length === 0
                            }
                            onChange={e => handleRootcauseChange(e.target.value)}
                            className="w-full bg-white border border-[#e8ddff] text-[#1f1638] font-semibold text-xs rounded-xl py-2.5 pl-3 pr-9 appearance-none focus:outline-none focus:ring-2 focus:ring-[#7135b5] cursor-pointer disabled:opacity-50"
                          >
                            {!reasonReport ? (
                              <option value="">-- Pilih Reason Report Terlebih Dahulu --</option>
                            ) : availableRootcauseOptions.length === 0 ? (
                              <option value="">-- Tidak ada pilihan tersedia --</option>
                            ) : (
                              <>
                                <option value="">-- Pilih Rootcause Code (Level 3) --</option>
                                {availableRootcauseOptions.map(rm => (
                                  <option key={rm.id} value={rm.text || rm.name}>
                                    {rm.text || rm.name}
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                          <ChevronDown className="w-4 h-4 absolute right-3 top-2.5 text-[#58149c] pointer-events-none" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Work Description / Catatan Teknisi */}
                  <div className="bg-[#f8f1ff] rounded-xl p-3.5 border border-[#e8ddff] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor="remarks-commissioning" className="text-xs font-bold text-[#1f1638]">
                        Work Description &amp; Catatan Commissioning <span className="text-[#ba1a1a]">*</span>
                      </label>
                      <span className="text-[10.5px] font-mono text-[#58149c]">
                        {remarksReport.length} Karakter
                      </span>
                    </div>

                    {!ticketClosed && availableRemarksTemplates.length > 0 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                        <span className="text-[#7d7484] text-[10px] font-mono shrink-0">Template:</span>
                        {availableRemarksTemplates.map((tpl, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setRemarksReport(tpl)}
                            className="tactile-chip px-2 py-0.5 rounded-md text-[#58149c] whitespace-nowrap text-[10.5px] font-medium cursor-pointer"
                          >
                            {tpl.length > 34 ? tpl.slice(0, 34) + '...' : tpl}
                          </button>
                        ))}
                      </div>
                    )}

                    <textarea
                      id="remarks-commissioning"
                      rows={3}
                      value={remarksReport}
                      disabled={ticketClosed || isSubmittingReport}
                      onChange={e => setRemarksReport(e.target.value)}
                      placeholder="Tuliskan hasil pekerjaan, panjang dropcore, redaman OPM akhir, dan catatan teknis..."
                      className="w-full bg-white border border-[#e8ddff] text-[#1f1638] text-xs rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-[#7135b5] leading-relaxed resize-none disabled:opacity-60"
                    />
                  </div>
                </form>

                {/* Right: LiveChat & Report History */}
                <div className="lg:col-span-6 space-y-3">
                  <FullviewLiveChatSection
                    chatSectionRef={chatSectionRef}
                    chatMessagesEndRef={chatMessagesEndRef}
                    chatInputRef={chatInputRef}
                    chatFileInputRef={chatFileInputRef}
                    activeTicket={activeTicket}
                    currentUser={currentUser}
                    messages={messages}
                    unreadChatCount={unreadChatCount}
                    chatCategory={chatCategory}
                    activeChatCategories={activeChatCategories}
                    currentChatCategoryObj={currentChatCategoryObj}
                    chatInputText={chatInputText}
                    onChatInputChange={setChatInputText}
                    chatAttachments={chatAttachments}
                    isSendingChat={isSendingChat}
                    chatError={chatError}
                    isChatActive={isChatActive}
                    onActivateChat={() => setIsChatActive(true)}
                    onSelectCategory={handleChatCategorySelect}
                    onFileSelect={handleChatFileSelect}
                    onRemoveAttachment={handleRemoveAttachment}
                    onSendMessage={handleSendChatMessage}
                    onZoomImage={url => setLightboxState({ url })}
                  />

                  {/* Report History & Timeline */}
                  <div className="bg-white rounded-xl p-3.5 border border-[#e8ddff] space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setShowHistorySection(prev => !prev)}
                      className="w-full flex items-center justify-between pb-2 border-b border-[#e8ddff] cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-[#58149c] shrink-0" />
                        <h3 className="font-display font-bold text-[13px] text-[#1f1638]">
                          Riwayat Report ({progressHistory.length} Versi)
                        </h3>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-[#7d7484] transition-transform ${
                          showHistorySection ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {showHistorySection && (
                      <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                        {progressHistory.length === 0 ? (
                          <div className="py-3 text-center text-[#7d7484] text-xs">
                            Belum ada riwayat laporan untuk WO ini.
                          </div>
                        ) : (
                          progressHistory.map((item, idx) => {
                            const formattedDate = new Date(item.timestamp).toLocaleString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit'
                            });

                            return (
                              <div
                                key={item.id || idx}
                                className="p-2.5 rounded-lg border border-[#e8ddff] bg-[#f8f1ff] space-y-1 text-xs"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1 pb-1 border-b border-[#e8ddff]">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-[#eedbff] text-[#58149c]">
                                      v{item.versionNumber || progressHistory.length - idx}
                                    </span>
                                    <span className="font-mono text-[10px] text-[#7d7484]">
                                      {formattedDate} WIB
                                    </span>
                                    <span className="font-semibold text-[#1f1638] inline-flex items-center gap-1">
                                      <User className="w-3 h-3 text-[#58149c]" />
                                      {item.submittedBy}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <StatusBadge status={item.reportStatus} variant="report" />
                                    {(item.approvalStatus ||
                                      (idx === 0 &&
                                        activeTicket.approvalStatus &&
                                        activeTicket.approvalStatus !== 'NONE')) && (
                                      <StatusBadge
                                        status={item.approvalStatus || activeTicket.approvalStatus}
                                        variant="approval"
                                      />
                                    )}
                                  </div>
                                </div>

                                <div className="text-[11px] text-[#4b4452]">
                                  <span>Reason: <strong className="text-[#1f1638]">{item.reasonReport}</strong></span>
                                  {' · '}
                                  <span>Rootcause: <strong className="text-[#58149c]">{item.rootCause}</strong></span>
                                </div>

                                {item.remarksReport && (
                                  <p className="text-[11px] text-[#4b4452] italic bg-white p-2 rounded border border-[#e8ddff]">
                                    &ldquo;{item.remarksReport}&rdquo;
                                  </p>
                                )}

                                {(item.revisionReason || (item as any).rejectionReason) && (
                                  <div className="p-2 rounded bg-rose-50 border border-rose-200 text-[#ba1a1a] text-[10.5px] font-semibold">
                                    Catatan Revisi Dispatch: &ldquo;
                                    {item.revisionReason || (item as any).rejectionReason}&rdquo;
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}

                        {relatedActivities.length > 0 && (
                          <div className="pt-2 border-t border-[#e8ddff] space-y-1.5">
                            <div className="font-mono text-[10px] uppercase tracking-wider text-[#7d7484] font-semibold flex items-center justify-between">
                              <span>Log Aktivitas Terbaru</span>
                              <Wrench className="w-3.5 h-3.5 text-[#58149c]" />
                            </div>
                            {relatedActivities.slice(0, 4).map(act => (
                              <div
                                key={act.id}
                                className="p-2 rounded bg-[#f8f1ff] text-[11px] border-l-2 border-[#7135b5]"
                              >
                                <div className="flex items-center justify-between gap-2 text-[#1f1638] font-semibold">
                                  <span className="truncate">{act.performedBy || 'Sistem'}</span>
                                  <span className="font-mono text-[9.5px] text-[#7d7484] shrink-0">
                                    {formatJakartaTimeOnly(act.timestamp)}
                                  </span>
                                </div>
                                <p className="text-[#4b4452] leading-snug mt-0.5">{act.description}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </details>

          {/* ------------------------------------------------------------ */}
          {/* SECTION 9: CHECK-OUT (TANDA TANGAN & FINALISASI CHECK-OUT)   */}
          {/* ------------------------------------------------------------ */}
          <details
            ref={signatureSectionRef}
            open
            className="group mj-enterprise-card rounded-2xl overflow-hidden"
          >
            <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-[#f3eaff] text-[#58149c] font-mono text-[11px] font-bold flex items-center justify-center shrink-0">
                  9
                </span>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-sm text-[#1f1638] truncate">
                    Check-Out &amp; Tanda Tangan Pelanggan
                  </h2>
                  <span className="text-[11px] text-[#7d7484] block truncate">
                    {activeTicket.checkOutAt
                      ? `Check-Out tercatat ${formatJakartaTimeOnly(activeTicket.checkOutAt)} WIB`
                      : 'Konfirmasi Berita Acara Pelanggan & Simpan Check-Out Akhir'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`font-mono text-[10px] font-bold flex items-center gap-1 px-2.5 py-0.5 rounded-full border ${
                    isSignatureReady
                      ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      : 'text-[#4b4452] bg-[#f8f1ff] border-[#e8ddff]'
                  }`}
                >
                  <PenTool className="w-3 h-3" />
                  <span>{isSignatureReady ? 'TTD Siap' : 'Belum TTD'}</span>
                </span>
                <ChevronDown className="w-4 h-4 text-[#7d7484] transition-transform duration-200 group-open:rotate-180" />
              </div>
            </summary>

            <div className="px-4 pb-4 pt-2 border-t border-[#e8ddff] space-y-3">
              {/* Signature Pad */}
              <div className="relative bg-[#f8f1ff] rounded-xl p-3 border border-[#e8ddff]">
                <div className="relative w-full h-28 bg-white rounded-lg border border-[#e8ddff]">
                  <canvas
                    ref={signatureCanvasRef}
                    onPointerDown={handleSignaturePointerDown}
                    onPointerMove={handleSignaturePointerMove}
                    onPointerUp={handleSignaturePointerUp}
                    onPointerLeave={handleSignaturePointerUp}
                    className={`w-full h-full touch-none ${
                      ticketClosed ? 'cursor-not-allowed' : 'cursor-crosshair'
                    }`}
                  />
                  {!customerSignatureUrl && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-mono text-[#7d7484]">
                      Tanda tangan pelanggan di area ini...
                    </div>
                  )}
                </div>

                <div className="w-full flex items-center justify-between pt-2 mt-1">
                  <span className="text-xs font-semibold text-[#1f1638] truncate">
                    {activeTicket.customerName || 'Pelanggan'} (Pelanggan)
                  </span>
                  {!ticketClosed && (
                    <button
                      type="button"
                      onClick={handleClearSignature}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg mj-btn-secondary text-[11px] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3 text-[#ba1a1a]" />
                      <span>Ulangi TTD</span>
                    </button>
                  )}
                </div>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={customerConsentConfirmed}
                  disabled={ticketClosed || isSubmittingReport}
                  onChange={e => setCustomerConsentConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-[#7135b5] cursor-pointer"
                />
                <span className="text-xs text-[#4b4452] leading-snug">
                  Pelanggan telah menguji koneksi, menerima perangkat dalam kondisi baik, dan menyetujui Berita Acara Digital.
                </span>
              </label>

              {!ticketClosed && (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-3 bg-[#f8f1ff] rounded-xl border border-[#e8ddff]">
                  <div className="flex items-center gap-2 min-w-0">
                    <HardDriveDownload className="w-4 h-4 text-[#58149c] shrink-0" />
                    <span className="text-xs text-[#4b4452] truncate">
                      Draft lokal (<strong className="font-mono text-[#58149c]">{activeTicket.woNumber}</strong>)
                      {draftSavedAt ? ` · ${formatJakartaTimeOnly(draftSavedAt)} WIB` : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={isSubmittingReport}
                    onClick={() => persistDraftToDevice(true)}
                    className="px-3 py-1.5 rounded-lg mj-btn-secondary text-xs cursor-pointer shrink-0"
                  >
                    Simpan Draft Lokal
                  </button>
                </div>
              )}
            </div>
          </details>
        </div>
      </main>

      {/* ============================================================== */}
      {/* MORAJAWS LIGHT STICKY FOOTER ACTION BAR                        */}
      {/* ============================================================== */}
      {currentUser.role !== 'leader' && (
        <footer className="bg-white px-3.5 sm:px-6 pt-2.5 pb-safe border-t border-[#e8ddff] shadow-[0_-4px_16px_rgba(31,22,56,0.06)] shrink-0 z-20">
          <div className="max-w-5xl mx-auto space-y-2">
            {/* Progress Meta Row */}
            <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] font-mono">
              <span className="text-[#4b4452] tabular-nums">
                Foto SOP: <strong className="text-[#1f1638]">{uploadedPhotoCount}/{totalPhotoSlots}</strong>
              </span>

              {ticketClosed ? (
                <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" />
                  <span>WO Closed</span>
                </span>
              ) : requiresProgressCheckIn ? (
                <span className="text-amber-700 font-bold inline-flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5" />
                  <span>Lakukan CHECK-IN Dahulu</span>
                </span>
              ) : !isCheckoutFormReady ? (
                <span className="text-[#58149c] font-bold inline-flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Lengkapi Form Report</span>
                </span>
              ) : (
                <span className="text-emerald-700 font-bold inline-flex items-center gap-1">
                  <BadgeCheck className="w-3.5 h-3.5" />
                  <span>Siap Check-Out &amp; Kirim Dispatch</span>
                </span>
              )}
            </div>

            {/* Action Buttons Row */}
            <div className="flex items-center gap-2 relative">
              <button
                type="button"
                disabled={ticketClosed}
                onClick={() => {
                  if (technicalAccordionRef.current) technicalAccordionRef.current.open = true;
                  setShowSnScannerTip(true);
                  snInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  setTimeout(() => snInputRef.current?.focus(), 200);
                }}
                aria-label="Fokus Scan SN ONT"
                title="Fokus & Foto Barcode SN ONT"
                className="h-11 w-11 rounded-xl mj-btn-secondary flex items-center justify-center shrink-0 cursor-pointer disabled:opacity-45"
              >
                <QrCode className="w-4 h-4 text-[#58149c]" />
              </button>

              {!ticketClosed && (
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowEscalationMenu(prev => !prev)}
                    aria-label="Menu Update Status & Kendala"
                    title="Update Status & Kendala"
                    className="h-11 w-11 rounded-xl mj-btn-secondary flex items-center justify-center cursor-pointer"
                  >
                    <MoreVertical className="w-4 h-4 text-[#4b4452]" />
                  </button>

                  {showEscalationMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowEscalationMenu(false)}
                      />
                      <div className="absolute bottom-13 left-0 z-30 w-64 rounded-xl bg-white border border-[#e8ddff] shadow-xl p-1.5 space-y-1 text-xs">
                        <button
                          type="button"
                          onClick={() => {
                            setShowEscalationMenu(false);
                            setShowQuickUpdateSheet(true);
                          }}
                          className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-[#f8f1ff] font-semibold text-[#1f1638] flex items-center gap-2 cursor-pointer"
                        >
                          <Zap className="w-4 h-4 text-[#58149c]" />
                          <span>Update Status / Log Lapangan</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowEscalationMenu(false);
                            setShowKendalaModal(true);
                          }}
                          className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-rose-50 font-bold text-[#ba1a1a] flex items-center gap-2 cursor-pointer"
                        >
                          <ShieldAlert className="w-4 h-4" />
                          <span>Laporkan Kendala / Reschedule (#ISSUE)</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Primary CTA: CHECK-IN if not yet checked-in, otherwise CHECK-OUT / KIRIM VERIFIKASI */}
              {!ticketClosed && requiresProgressCheckIn ? (
                <button
                  type="button"
                  onClick={handleTriggerCheckIn}
                  className="flex-1 h-11 rounded-xl mj-tactile-btn-primary text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  <span>CHECK-IN</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={ticketClosed || isSubmittingReport}
                  onClick={handleOpenQcSheet}
                  className="flex-1 h-11 rounded-xl mj-tactile-btn-primary text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <BadgeCheck className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {ticketClosed
                      ? 'WO Selesai (Terkunci)'
                      : isSubmittingReport
                      ? 'Menyimpan...'
                      : canonicalApproval === 'REVISION'
                      ? `Kirim Revisi v${(activeTicket.progressReports?.length || 0) + 1}`
                      : 'Check-Out & Kirim Report'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </footer>
      )}

      {/* ============================================================== */}
      {/* QC CONFIRMATION BOTTOM SHEET MODAL (LIGHT)                     */}
      {/* ============================================================== */}
      {showQcConfirmSheet && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qc-confirm-sheet-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 animate-in fade-in duration-150"
        >
          <div className="absolute inset-0" onClick={() => setShowQcConfirmSheet(false)} />

          <div className="mj-sheet-enter relative z-10 w-full sm:max-w-lg bg-white text-[#1f1638] rounded-t-[1.5rem] sm:rounded-2xl border border-[#e8ddff] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex justify-center pt-2.5 pb-1 sm:hidden shrink-0">
              <div className="w-10 h-1.5 rounded-full bg-[#cec3d4]" />
            </div>

            <div className="px-5 pt-3 pb-3.5 border-b border-[#e8ddff] bg-[#fdf7ff] flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[#f3eaff] border border-[#d8ccf3] text-[#58149c] flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#7135b5]">
                      VALIDASI AKHIR QC &amp; CHECK-OUT
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#f3eaff] font-mono text-[10px] font-bold text-[#58149c]">
                      #{activeTicket.woNumber}
                    </span>
                  </div>
                  <h3
                    id="qc-confirm-sheet-title"
                    className="font-display font-bold text-base text-[#1f1638] leading-snug mt-0.5 truncate"
                  >
                    Konfirmasi Penyelesaian WO
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQcConfirmSheet(false)}
                className="p-2 rounded-full mj-btn-secondary text-[#4b4452] cursor-pointer shrink-0"
                aria-label="Tutup Konfirmasi QC"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Telemetry Summary */}
              <div className="rounded-xl bg-[#f8f1ff] border border-[#e8ddff] p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-mono font-bold uppercase tracking-wider text-[#58149c]">
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Ringkasan Teknis</span>
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold border ${opmStatus.badgeCls}`}>
                    {opmStatus.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-lg bg-white border border-[#e8ddff] p-3">
                    <div className="text-[11px] text-[#7d7484]">Rx Optical Power</div>
                    <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
                      <span
                        className={`text-lg font-bold leading-none ${
                          opmStatus.isOutOfSpec ? 'text-[#ba1a1a]' : 'text-[#1f1638]'
                        }`}
                      >
                        {opmDbm.trim() || '—'}
                      </span>
                      {opmDbm.trim() && <span className="text-xs text-[#7d7484]">dBm</span>}
                    </div>
                  </div>

                  <div className="rounded-lg bg-white border border-[#e8ddff] p-3">
                    <div className="text-[11px] text-[#7d7484]">Dropcore &amp; FAT</div>
                    <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
                      <span className="text-lg font-bold text-[#1f1638] leading-none">
                        {dropcoreLength.trim() || '—'}
                      </span>
                      {dropcoreLength.trim() && <span className="text-xs text-[#7d7484]">m</span>}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-[#58149c] truncate">
                      FAT {activeTicket.fatCode || '-'}{fatPort ? ` • #${fatPort}` : ''}
                    </div>
                  </div>
                </div>
              </div>

              {/* Uploaded Photo Proof Thumbnails */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-bold text-sm text-[#1f1638]">
                    Bukti Foto Fisik
                  </h4>
                  <span className="font-mono text-[11px] font-bold text-[#58149c]">
                    {uploadedPhotoCount}/{totalPhotoSlots} Terlampir
                  </span>
                </div>

                {uploadedPhotoCount > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {uploadedPhotoSlotsList.map(slot => (
                      <button
                        key={slot.slotKey}
                        type="button"
                        onClick={() => setLightboxState({ url: slot.url })}
                        className="relative h-24 rounded-lg overflow-hidden border border-[#e8ddff] bg-[#f8f1ff] cursor-pointer text-left"
                      >
                        <img
                          src={getSafePreviewUrl(slot.url)}
                          alt={slot.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-white/95 border-t border-[#e8ddff] px-2 py-1 flex items-center gap-1 text-[#1f1638] text-[10px] font-mono font-semibold">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="truncate">{slot.title}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-dashed border-[#cec3d4] bg-[#f8f1ff] text-center space-y-2">
                    <p className="text-xs text-[#4b4452]">
                      Belum ada foto bukti SOP yang diunggah. Disarankan melampirkan bukti foto fisik sebelum Check-Out.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowQcConfirmSheet(false)}
                      className="px-3 py-1.5 rounded-lg mj-tactile-btn-primary text-[11px] cursor-pointer"
                    >
                      Unggah Foto Bukti Sekarang
                    </button>
                  </div>
                )}
              </div>

              {/* SOP Verification Checklist */}
              <div className="rounded-xl bg-[#f8f1ff] border border-[#e8ddff] p-3.5 space-y-2">
                <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#58149c]">
                  Lembar Verifikasi Kualitas (SOP)
                </div>
                {[
                  { key: 'dropcoreNeat' as const, label: 'Kabel dropcore terpasang rapi, aman & klem kencang' },
                  { key: 'opmClean' as const, label: 'Konektor bersih & redaman OPM sesuai standar SOP' },
                  { key: 'customerTested' as const, label: 'Pelanggan telah uji koneksi & menyetujui Berita Acara' }
                ].map(item => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 text-xs text-[#1f1638] cursor-pointer select-none py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={sopChecks[item.key]}
                      onChange={e =>
                        setSopChecks(prev => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 rounded accent-[#7135b5] cursor-pointer"
                    />
                    <span className="leading-snug">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 bg-[#fdf7ff] border-t border-[#e8ddff] space-y-2 shrink-0">
              <button
                type="button"
                disabled={
                  isSubmittingReport ||
                  !sopChecks.dropcoreNeat ||
                  !sopChecks.opmClean ||
                  !sopChecks.customerTested
                }
                onClick={handleSaveReport}
                className="w-full py-3 px-4 rounded-xl mj-tactile-btn-primary text-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {isSubmittingReport ? 'Menyimpan ke Server...' : 'Konfirmasi Check-Out & Kirim Report'}
                </span>
              </button>
              <button
                type="button"
                disabled={isSubmittingReport}
                onClick={() => setShowQcConfirmSheet(false)}
                className="w-full py-2.5 px-4 rounded-xl mj-tactile-btn-secondary text-xs cursor-pointer"
              >
                Periksa Ulang / Kembali
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* KENDALA / RESCHEDULE ESCALATION MODAL                          */}
      {/* ============================================================== */}
      <TactileConfirmModal
        isOpen={showKendalaModal}
        onClose={() => setShowKendalaModal(false)}
        variant="danger"
        badge={`ESKALASI KENDALA • ${activeTicket.woNumber}`}
        title={`Laporkan Kendala / Tunda WO ${activeTicket.woNumber}`}
        subtitle={`Pelanggan: ${activeTicket.customerName}. Laporan akan memperbarui status teknis dan mengirim pesan #ISSUE ke LiveChat Dispatch.`}
        reasonOptions={[
          {
            id: 'port_odp_full',
            label: 'Port FAT / ODP Penuh atau Tidak Ada Signal',
            description: 'Memerlukan relokasi FAT atau tindakan tim jaringan.',
            targetInstallerStatus: 'Pending Technical'
          },
          {
            id: 'customer_reschedule',
            label: 'Pelanggan Tidak di Tempat / Minta Reschedule',
            description: 'Jadwal pemasangan ditunda atas permintaan pelanggan.',
            targetInstallerStatus: 'Pending Technical',
            isReschedule: true
          },
          {
            id: 'route_permit',
            label: 'Hambatan Izin Jalur / Lokasi Tidak Memungkinkan',
            description: 'Kendala akses cluster, tiang, atau perizinan jalur.',
            targetInstallerStatus: 'Pending Technical'
          },
          {
            id: 'cancelled_on_site',
            label: 'Pelanggan Membatalkan / Gagal Instalasi',
            description: 'Pekerjaan dibatalkan di lokasi.',
            targetInstallerStatus: 'Failed / Cancelled'
          }
        ]}
        requireNotes={true}
        confirmLabel="Kirim Laporan Kendala"
        cancelLabel="Batal"
        isSubmitting={isSubmittingKendala}
        onConfirm={handleConfirmKendalaFromFullview}
      />

      {/* ============================================================== */}
      {/* SUCCESS ALERT MODAL (MORAJAWS LIGHT)                           */}
      {/* ============================================================== */}
      {showSuccessAlert && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-900/50 animate-in fade-in duration-200"
        >
          <div className="w-full max-w-md bg-white rounded-2xl border border-[#e8ddff] p-6 shadow-2xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-600" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-[#1f1638] uppercase tracking-tight">
                Report &amp; Check-Out Tersimpan
              </h3>
              <p className="text-xs text-[#4b4452] mt-1 leading-relaxed">
                Laporan berhasil dikirim ke Dispatch dengan status{' '}
                <strong className="text-[#58149c]">BUTUH APPROVAL</strong>.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-[#f8f1ff] border border-[#e8ddff] text-left text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#7d7484]">No. Work Order:</span>
                <span className="font-mono font-bold text-[#58149c]">{activeTicket.woNumber}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#7d7484]">Report Status:</span>
                <span className="font-semibold text-[#1f1638]">
                  {savedReportSnapshot?.status || reportStatus}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#7d7484]">Reason Report:</span>
                <span className="font-semibold text-[#1f1638] truncate max-w-[190px]">
                  {savedReportSnapshot?.reason || reasonReport}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-[#e8ddff]">
                <span className="text-[#7d7484]">Bukti Foto SOP:</span>
                <span className="font-mono font-bold text-emerald-700">
                  {uploadedPhotoCount}/{totalPhotoSlots} Terlampir
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={isRedirecting}
              onClick={handleConfirmRedirect}
              className="w-full py-3 px-5 mj-tactile-btn-primary text-xs sm:text-sm rounded-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              <ArrowRight className="w-4 h-4" />
              <span>
                {isRedirecting ? 'Mengalihkan...' : 'Kembali ke Daftar WO'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Quick Update Sheet */}
      <WorkOrderQuickUpdateSheet
        ticket={activeTicket}
        isOpen={showQuickUpdateSheet}
        onClose={() => setShowQuickUpdateSheet(false)}
        onOpenFullReport={() => {
          setShowQuickUpdateSheet(false);
          if (reportAccordionRef.current) reportAccordionRef.current.open = true;
          checkoutFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />

      {/* Geo-Tag Camera Modal */}
      {cameraModalSlot && (
        <GeoTagCameraModal
          isOpen={Boolean(cameraModalSlot)}
          onClose={() => setCameraModalSlot(null)}
          slotKey={cameraModalSlot.slotKey}
          slotTitle={`${cameraModalSlot.slotNumber} | ${cameraModalSlot.title}`}
          slotHint={cameraModalSlot.emptyHint}
          woNumber={activeTicket.woNumber}
          technicianName={currentUser.name || activeTicket.installerName || 'Teknisi'}
          customerName={activeTicket.customerName}
          onConfirmPhoto={handleConfirmCameraCapture}
        />
      )}

      {/* Geo-Tag Check-In Camera Modal */}
      {showCheckInCameraModal && (
        <GeoTagCameraCheckInModal
          isOpen={showCheckInCameraModal}
          onClose={() => setShowCheckInCameraModal(false)}
          ticket={activeTicket}
          onCheckInSuccess={() => {
            setShowCheckInCameraModal(false);
            setServerProgressTriggerByTicket(prev => ({
              ...prev,
              [triggerKey]: true
            }));
            refreshMessagesForTicket(activeTicket.id).catch(() => {});
          }}
        />
      )}

      {/* Photo Lightbox Modal */}
      <PhotoLightboxModal
        imageUrl={lightboxState?.url || null}
        matchedSlot={lightboxMatchedSlot}
        matchedSlotDef={lightboxMatchedSlotDef}
        ticketClosed={ticketClosed}
        onClose={() => setLightboxState(null)}
        onRetake={slotDef => openCameraForSlot(slotDef)}
      />
    </div>
  );
};
