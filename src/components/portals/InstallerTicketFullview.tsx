import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
import {
  buildGoogleMapsCoordinateUrl,
  formatCoordinates,
  isValidCoordinatePair,
  openCustomerAddressInGoogleMaps
} from '../../services/mapsService';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import { supabaseDb } from '../../services/supabaseDb';
import {
  putMasterCacheValue,
  getMasterCacheValue,
  deleteMasterCacheValue
} from '../../services/offlineDb';
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
  safeLocalStorageRemove,
  sanitizeCheckoutDraftForLocalStorage,
  isDataUri
} from '../../utils/safeStorage';
import { formatAppointmentDateDisplay, getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import { acquireCurrentDeviceGps } from '../../services/geolocationService';
import { GeoTagCameraModal, CapturedPhotoPayload } from '../camera/GeoTagCameraModal';
import { GeoTagCameraCheckInModal } from '../camera/GeoTagCameraCheckInModal';
import { BarcodeScannerModal, ParsedBarcodePayload } from '../camera/BarcodeScannerModal';
import { WorkOrderAddressBlock } from './WorkOrderAddressBlock';
import { formatWorkOrderAddress } from '../../utils/addressFormatter';
import {
  ArrowLeft,
  ArrowRight,
  Phone,
  MessageSquare,
  MapPin,
  CheckCircle2,
  Clock,
  Radio,
  Copy,
  Check,
  Camera,
  FileText,
  History,
  AlertCircle,
  X,
  XCircle,
  ChevronDown,
  Lock,
  LockOpen,
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
  SlidersHorizontal,
  Building2,
  Calendar,
  Router,
  WifiOff,
  BadgeCheck,
  ExternalLink,
  Gauge
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAnimation } from '../../context/AnimationContext';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useVisualViewportModal } from '../../hooks/useVisualViewportModal';
import { useModalLayer } from '../../hooks/useModalLayer';
import { KendalaReportModal } from '../tickets/KendalaReportModal';
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
import { CompletedStatusModal } from './fullview/CompletedStatusModal';
import { UnsuccessStatusModal } from './fullview/UnsuccessStatusModal';
import { FloatingLiveChatModal } from './fullview/FloatingLiveChatModal';
import {
  extractCustomerContacts,
  extractLocationExtraMeta,
  formatFullviewTimeValue
} from '../../utils/fullviewWorkflow';
import {
  evaluatePhotoEvidenceCompleteness,
  isVerifiedPersistedPhotoSlot,
  isPersistedStoragePhotoUrl,
  buildPhotoEvidenceIncompleteErrorMessage
} from '../../utils/photoEvidenceValidation';

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
      const isPersisted = isPersistedStoragePhotoUrl(item.url);
      map[item.slotKey] = {
        slotKey: item.slotKey,
        title: def?.title || item.slotKey,
        url: item.url,
        capturedAt: ticket.technicalReport?.submittedAt
          ? formatJakartaTimeOnly(ticket.technicalReport.submittedAt)
          : undefined,
        uploadedAt: isPersisted ? ticket.technicalReport?.submittedAt : undefined,
        uploadStatus: isPersisted ? 'uploaded' : undefined,
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
    saveProgressReport,
    uploadWoPhotoEvidence,
    deleteWoPhotoEvidence,
    currentUser,
    getMessagesForTicket,
    refreshMessagesForTicket,
    sendTicketMessage,
    sendTypingIndicator,
    uploadChatAttachment,
    markTicketMessagesAsRead,
    getTicketUnreadCount,
    hierarchicalStatuses,
    chatCategories,
    setTicketChatCategory,
    ticketActivities,
    markTicketEditing,
    loadTicketDetailOnDemand
  } = useApp();
  const { isOnline, isSyncing, pendingCount, setIsOfflineModalOpen } = useOfflineSync();
  const { toast } = useToast();
  const { showGlobalError, startLoading, stopLoading } = useAnimation();
  const { playReportSavedSound, playErrorSound } = useMoraJawsSound();

  const activeTicket = useMemo(() => {
    return tickets.find(t => t.id === initialTicket.id) || initialTicket;
  }, [tickets, initialTicket]);

  const hydratedTicketIdsRef = useRef<Set<string>>(new Set());
  const submitReportInFlightRef = useRef(false);
  const activeIdempotencyKeyRef = useRef<string | null>(null);

  // Hydrate full ticket detail (photoSlots, wo_photo_evidence, technicalReport, workSessions) when opened or reloaded
  useEffect(() => {
    if (!activeTicket?.id) return;
    const isPartial = Boolean((activeTicket as any)?._isCriticalPartial);
    if (isPartial || !hydratedTicketIdsRef.current.has(activeTicket.id)) {
      hydratedTicketIdsRef.current.add(activeTicket.id);
      void loadTicketDetailOnDemand(activeTicket.id);
    }
  }, [activeTicket?.id, (activeTicket as any)?._isCriticalPartial, loadTicketDetailOnDemand]);

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
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const [showUnsuccessModal, setShowUnsuccessModal] = useState(false);
  const [showLiveChatModal, setShowLiveChatModal] = useState(false);

  const checkInSectionRef = useRef<HTMLDivElement>(null);
  const photoAccordionRef = useRef<HTMLDetailsElement>(null);
  const photoSectionRef = useRef<HTMLElement>(null);
  const technicalAccordionRef = useRef<HTMLDetailsElement>(null);
  const reportAccordionRef = useRef<HTMLDetailsElement>(null);
  const signatureSectionRef = useRef<HTMLDetailsElement>(null);
  const uploadingSlotKeysRef = useRef<Set<PhotoSlotKey>>(new Set());

  const [showSuccessAlert, setShowSuccessAlert] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  const [savedReportSnapshot, setSavedReportSnapshot] = useState<{
    status: string;
    reason: string;
    remarks: string;
  } | null>(null);
  const fullviewRef = useRef<HTMLDivElement>(null);
  const qcSheetRef = useRef<HTMLDivElement>(null);
  const fullviewLayerZ = useModalLayer(true, { tier: 'modal' });
  const fullviewViewport = useVisualViewportModal(true, fullviewRef);
  const qcViewport = useVisualViewportModal(showQcConfirmSheet, qcSheetRef);
  const qcLayerZ = useModalLayer(showQcConfirmSheet, { tier: 'nested' });
  const successAlertLayerZ = useModalLayer(showSuccessAlert, { tier: 'confirm' });

  useEffect(() => {
    if (!showQcConfirmSheet) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowQcConfirmSheet(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showQcConfirmSheet]);

  // -------------------------------------------------------------
  // 2-TIER CASCADE REPORT STATE (Status WO -> Reason WO)
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
  const [deletingSlotKey, setDeletingSlotKey] = useState<PhotoSlotKey | null>(null);

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
  const [showBarcodeScannerModal, setShowBarcodeScannerModal] = useState(false);
  const [barcodeScannerSlot, setBarcodeScannerSlot] = useState<PhotoSlotDefinition | null>(null);
  const snInputRef = useRef<HTMLInputElement>(null);

  // Restore local draft when switching tickets (lightweight text from localStorage, heavy assets from IndexedDB)
  useEffect(() => {
    if (ticketClosed) return;
    let cancelled = false;
    try {
      const raw = safeLocalStorageGet(draftStorageKey);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft && typeof draft === 'object') {
          if (draft.reportStatus) setReportStatus(draft.reportStatus);
          if (draft.reportStatusId) setReportStatusId(draft.reportStatusId);
          if (draft.reasonReport) setReasonReport(draft.reasonReport);
          if (draft.reasonReportId) setReasonReportId(draft.reasonReportId);
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
                const draftStatus = (draftSlot as Partial<TechnicalPhotoSlot>).uploadStatus;
                const canUseDraft =
                  draftStatus === 'failed' ||
                  draftStatus === 'pending_offline' ||
                  isVerifiedPersistedPhotoSlot(draftSlot);
                if (canUseDraft && (!existing || !isVerifiedPersistedPhotoSlot(existing))) {
                  next[key] = draftSlot;
                }
              });
              return next;
            });
          }
          if (typeof draft.customerSignatureUrl === 'string' && draft.customerSignatureUrl && !isDataUri(draft.customerSignatureUrl)) {
            setCustomerSignatureUrl(draft.customerSignatureUrl);
          }
          if (typeof draft.customerConsentConfirmed === 'boolean') {
            setCustomerConsentConfirmed(draft.customerConsentConfirmed);
          }
          if (draft.savedAt) {
            setDraftSavedAt(draft.savedAt);
          }
        }
      }
    } catch {
      // Ignore malformed draft
    }

    // Restore any offline un-uploaded signature draft from IndexedDB (never stored in localStorage)
    void getMasterCacheValue<string>(`draft_sig_${activeTicket.id}`).then(sig => {
      if (!cancelled && sig && !customerSignatureUrl) {
        setCustomerSignatureUrl(sig);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [draftStorageKey, activeTicket.id, ticketClosed]);

  // Auto-focus exact next stage section when requested via Continue Work
  useEffect(() => {
    if (!initialFocusSection) return;
    const timer = setTimeout(() => {
      if (initialFocusSection === 'checkin') {
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
        const sanitizedPayload = sanitizeCheckoutDraftForLocalStorage({
          reportStatus,
          reportStatusId,
          reasonReport,
          reasonReportId,
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
        });
        // Persist inline signature data URI only in IndexedDB, never in localStorage
        if (isDataUri(customerSignatureUrl)) {
          void putMasterCacheValue(`draft_sig_${activeTicket.id}`, customerSignatureUrl).catch(() => {});
        }
        const writeRes = safeLocalStorageSet(draftStorageKey, JSON.stringify(sanitizedPayload));
        if (writeRes.ok) {
          setDraftSavedAt(nowIso);
          if (notify) {
            toast.success(
              `Draft checkout WO ${activeTicket.woNumber} tersimpan aman di perangkat lokal.`,
              'Draft Tersimpan'
            );
          }
        } else if (notify) {
          toast.warning(
            'Penyimpanan lokal penuh. Kirim laporan langsung saat online.',
            'Draft Penuh'
          );
        }
      } catch {
        if (notify) {
          toast.warning(
            'Penyimpanan lokal penuh. Kirim laporan langsung saat online.',
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

  // Active-edit protection so background delta/SSE sync never overwrites unsaved field inputs
  useEffect(() => {
    if (ticketClosed || !activeTicket?.id) return;
    const hasUnsavedInputs =
      Boolean(
        reportStatus ||
          reasonReport ||
          remarksReport.trim() ||
          opmDbm ||
          ontSerialNumber ||
          dropcoreLength ||
          fatPort ||
          customerSignatureUrl ||
          showQcConfirmSheet ||
          showKendalaModal ||
          showCompletedModal ||
          showUnsuccessModal ||
          showLiveChatModal
      ) || Object.values(photoSlots).some(Boolean);

    markTicketEditing(activeTicket.id, hasUnsavedInputs);
    return () => {
      markTicketEditing(activeTicket.id, false);
    };
  }, [
    ticketClosed,
    activeTicket.id,
    reportStatus,
    reasonReport,
    remarksReport,
    opmDbm,
    ontSerialNumber,
    dropcoreLength,
    fatPort,
    customerSignatureUrl,
    showQcConfirmSheet,
    showKendalaModal,
    showCompletedModal,
    showUnsuccessModal,
    showLiveChatModal,
    photoSlots,
    markTicketEditing
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
  // 2-TIER HIERARCHICAL SELECTION CALLBACK (Status WO -> Reason WO)
  // -------------------------------------------------------------
  const handleSelectCompletedStatusAndReason = useCallback(
    (payload: {
      reportStatus: string;
      reportStatusId: string;
      reasonReport: string;
      reasonReportId: string;
    }) => {
      setReportStatus(payload.reportStatus);
      setReportStatusId(payload.reportStatusId);
      setReasonReport(payload.reasonReport);
      setReasonReportId(payload.reasonReportId);
      setReportError(null);
    },
    []
  );

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
        badgeCls: 'bg-[#EAE8FF] dark:bg-[#f3eaff] text-[#5145A6] dark:text-[#58149c] border-[#DCE3F2] dark:border-[#d8ccf3]',
        isOutOfSpec: false
      };
    }
    if (opmNumeric <= -15 && opmNumeric >= -22) {
      return {
        label: 'PASS (Optimal)',
        badgeCls: 'bg-[#E4F5EC] dark:bg-emerald-50 text-[#218A63] dark:text-emerald-700 border-[#B7E4CC] dark:border-emerald-200',
        isOutOfSpec: false
      };
    }
    if (opmNumeric > -24 && opmNumeric < -8) {
      return {
        label: 'PASS (SOP OK)',
        badgeCls: 'bg-[#E4F5EC] dark:bg-emerald-50 text-[#218A63] dark:text-emerald-700 border-[#B7E4CC] dark:border-emerald-200',
        isOutOfSpec: false
      };
    }
    return {
      label: 'Out of Spec (SOP)',
      badgeCls: 'bg-[#FCE9EB] dark:bg-rose-50 text-[#9B2C37] dark:text-[#ba1a1a] border-[#F3C5CA] dark:border-rose-200',
      isOutOfSpec: true
    };
  }, [opmNumeric]);

  // -------------------------------------------------------------
  // 7-POINT SOP GEOTAG CAMERA & PHOTO UPLOAD HANDLERS
  // -------------------------------------------------------------
  useEffect(() => {
    const serverSlots = activeTicket.technicalReport?.photoSlots;
    const isPartial = Boolean((activeTicket as any)?._isCriticalPartial);
    if (!Array.isArray(serverSlots) || (serverSlots.length === 0 && isPartial)) return;
    setPhotoSlots(prev => {
      const next = { ...prev };
      let changed = false;
      const serverByKey = new Map<PhotoSlotKey, TechnicalPhotoSlot>();
      serverSlots.forEach(s => {
        if (s && s.url && s.slotKey in next) {
          serverByKey.set(s.slotKey, s);
        }
      });

      serverByKey.forEach((s, slotKey) => {
        const current = next[slotKey];
        if (
          !current ||
          (current.uploadStatus !== 'uploading' &&
            current.uploadStatus !== 'pending_offline' &&
            current.uploadStatus !== 'failed') ||
          (s.clientCaptureId && current.clientCaptureId === s.clientCaptureId)
        ) {
          if (
            !current ||
            current.url !== s.url ||
            current.storagePath !== s.storagePath ||
            current.uploadedAt !== s.uploadedAt ||
            current.capturedAtIso !== s.capturedAtIso ||
            current.latitude !== s.latitude ||
            current.longitude !== s.longitude ||
            current.uploadStatus !== s.uploadStatus
          ) {
            next[slotKey] = s;
            changed = true;
          }
        }
      });

      return changed ? next : prev;
    });
  }, [activeTicket.technicalReport?.photoSlots, (activeTicket as any)?._isCriticalPartial]);

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
      if (slotDef.slotKey === 'barcode_sn') {
        setBarcodeScannerSlot(slotDef);
        setShowBarcodeScannerModal(true);
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

  const photoEvidenceEval = useMemo(
    () => evaluatePhotoEvidenceCompleteness(photoSlots, slotUploadState),
    [photoSlots, slotUploadState]
  );

  const verifiedUploadedSlotsList = photoEvidenceEval.verifiedSlots;
  const mandatoryPhotoCount = photoEvidenceEval.mandatoryCount;
  const verifiedUploadedPhotoCount = photoEvidenceEval.verifiedTotalCount;
  const isMandatoryEvidenceReady = photoEvidenceEval.isMandatoryComplete;

  const isAnySlotUploading = useMemo(() => {
    return Object.values(slotUploadState).some(m => m?.status === 'uploading') || deletingSlotKey !== null;
  }, [slotUploadState, deletingSlotKey]);

  const executeSlotUpload = useCallback(
    async (slotDef: PhotoSlotDefinition, payload: CapturedPhotoPayload) => {
      if (uploadingSlotKeysRef.current.has(slotDef.slotKey)) {
        return;
      }
      uploadingSlotKeysRef.current.add(slotDef.slotKey);

      try {
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
      } finally {
        uploadingSlotKeysRef.current.delete(slotDef.slotKey);
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

  const handleDeletePhotoSlot = useCallback(
    async (slotDef: PhotoSlotDefinition) => {
      if (ticketClosed || deletingSlotKey || uploadingSlotKeysRef.current.has(slotDef.slotKey)) return;
      const existing = photoSlots[slotDef.slotKey];
      if (!existing) return;

      // Local-only unuploaded/failed draft photo
      const isLocalOnly =
        String(existing.url || '').startsWith('data:') ||
        (!existing.storagePath && !existing.uploadedAt);
      if (isLocalOnly) {
        setPhotoSlots(prev => ({ ...prev, [slotDef.slotKey]: null }));
        setSlotUploadState(prev => {
          const next = { ...prev };
          delete next[slotDef.slotKey];
          return next;
        });
        toast.info(`Draft foto "${slotDef.title}" dihapus.`);
        return;
      }

      setDeletingSlotKey(slotDef.slotKey);
      try {
        const res = await deleteWoPhotoEvidence(activeTicket.id, slotDef.slotKey);
        if (res.success) {
          setPhotoSlots(prev => ({ ...prev, [slotDef.slotKey]: null }));
          setSlotUploadState(prev => {
            const next = { ...prev };
            delete next[slotDef.slotKey];
            return next;
          });
          toast.info(`Foto "${slotDef.title}" berhasil dihapus dari slot.`);
        } else {
          toast.error(res.error || 'Gagal menghapus foto bukti.', 'Hapus Foto Gagal');
        }
      } finally {
        setDeletingSlotKey(null);
      }
    },
    [ticketClosed, deletingSlotKey, photoSlots, deleteWoPhotoEvidence, activeTicket.id, toast]
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
    ctx.strokeStyle = '#5145A6';
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
    setShowLiveChatModal(true);
    setIsChatActive(true);
    setTimeout(() => {
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

  const fullviewTypingThrottleRef = useRef<number>(0);
  const fullviewTypingIdleTimerRef = useRef<number | null>(null);

  const handleChatInputChange = (val: string) => {
    setChatInputText(val);
    if (currentUser.role === 'leader') return;
    const now = Date.now();
    if (val.trim()) {
      if (now - fullviewTypingThrottleRef.current > 2000) {
        fullviewTypingThrottleRef.current = now;
        sendTypingIndicator(activeTicket.id, true).catch(() => {});
      }
      if (fullviewTypingIdleTimerRef.current) window.clearTimeout(fullviewTypingIdleTimerRef.current);
      fullviewTypingIdleTimerRef.current = window.setTimeout(() => {
        sendTypingIndicator(activeTicket.id, false).catch(() => {});
      }, 3200);
    } else {
      if (fullviewTypingIdleTimerRef.current) window.clearTimeout(fullviewTypingIdleTimerRef.current);
      sendTypingIndicator(activeTicket.id, false).catch(() => {});
    }
  };

  useEffect(() => {
    return () => {
      if (fullviewTypingIdleTimerRef.current) window.clearTimeout(fullviewTypingIdleTimerRef.current);
      sendTypingIndicator(activeTicket.id, false).catch(() => {});
    };
  }, [activeTicket.id, sendTypingIndicator]);

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

      const tempId = 'att-up-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const localPreviewUrl = URL.createObjectURL(file);
      setChatAttachments(prev => [
        ...prev,
        {
          id: tempId,
          type: 'image',
          url: localPreviewUrl,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          uploadStatus: 'uploading'
        }
      ]);

      uploadChatAttachment(activeTicket.id, file)
        .then(res => {
          if (res.success && res.attachment) {
            setChatAttachments(prev =>
              prev.map(a => (a.id === tempId ? { ...res.attachment!, uploadStatus: 'uploaded' } : a))
            );
            toast.info(`Foto "${file.name}" terunggah & siap dikirim.`, 'Lampiran Ditambahkan');
          } else {
            setChatAttachments(prev =>
              prev.map(a => (a.id === tempId ? { ...a, uploadStatus: 'failed', error: res.error } : a))
            );
            toast.error(res.error || `Gagal mengunggah "${file.name}".`, 'Upload Gagal');
          }
        })
        .catch(() => {
          setChatAttachments(prev =>
            prev.map(a => (a.id === tempId ? { ...a, uploadStatus: 'failed', error: 'Upload gagal' } : a))
          );
          toast.error(`Gagal mengunggah "${file.name}".`, 'Upload Gagal');
        });
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
    if (isSendingChat || chatAttachments.some(a => a.uploadStatus === 'uploading')) return;

    const cleanCat = String(chatCategory || '').trim();
    if (!cleanCat || cleanCat.toUpperCase() === 'UNCLASSIFIED') {
      const msg = 'Pilih kategori chat wajib terlebih dahulu (mis. PROGRESS) sebelum mengirim pesan.';
      setChatError(msg);
      toast.error(msg, 'Kategori Wajib Dipilih');
      return;
    }

    const readyAttachments = chatAttachments.filter(a => a.uploadStatus !== 'failed');
    const text = directText !== undefined ? directText : chatInputText;
    if (!text.trim() && readyAttachments.length === 0) {
      return;
    }

    if (fullviewTypingIdleTimerRef.current) window.clearTimeout(fullviewTypingIdleTimerRef.current);
    sendTypingIndicator(activeTicket.id, false).catch(() => {});

    setIsChatActive(true);
    setIsSendingChat(true);
    setChatError(null);

    try {
      const res = await sendTicketMessage(activeTicket.id, text.trim(), readyAttachments, cleanCat);
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
  const validateBeforeSubmit = (overrides?: {
    status?: string;
    reason?: string;
    remarks?: string;
  }): boolean => {
    const targetStatus = overrides?.status ?? reportStatus;
    const targetReason = overrides?.reason ?? reasonReport;
    const targetRemarks = overrides?.remarks ?? remarksReport;

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

    if (isAnySlotUploading) {
      playErrorSound();
      const msg = 'Masih ada foto bukti fisik yang sedang diunggah/dihapus. Tunggu hingga selesai sebelum Check-Out.';
      setReportError(msg);
      toast.warning(msg, 'Proses Foto Berjalan');
      return false;
    }

    if (!isMandatoryEvidenceReady) {
      playErrorSound();
      const msg = buildPhotoEvidenceIncompleteErrorMessage(photoEvidenceEval);
      setReportError(msg);
      toast.error(msg, 'Foto Bukti Wajib Kurang (Min. 3)');
      if (photoAccordionRef.current) photoAccordionRef.current.open = true;
      photoAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return false;
    }

    if (!targetStatus) {
      const msg = 'LEVEL 1: Status WO wajib dipilih.';
      setReportError(msg);
      toast.warning(msg, 'Lengkapi Report');
      return false;
    }
    if (!targetReason) {
      const msg = 'LEVEL 2: Reason WO wajib dipilih.';
      setReportError(msg);
      toast.warning(msg, 'Lengkapi Report');
      return false;
    }
    if (!targetRemarks.trim()) {
      const msg = 'Remarks / Catatan Teknisi wajib diisi.';
      setReportError(msg);
      toast.warning(msg, 'Lengkapi Report');
      return false;
    }
    setReportError(null);
    return true;
  };

  const handleOpenQcSheet = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (submitReportInFlightRef.current || isSubmittingReport || isAnySlotUploading) return;
    if (!validateBeforeSubmit()) return;
    setShowQcConfirmSheet(true);
  };

  const executeProgressReportSubmission = async (payload: {
    targetReportStatus: string;
    targetReportStatusId: string;
    targetReasonReport: string;
    targetReasonReportId: string;
    targetRemarksReport: string;
    closeUnsuccessOnSuccess?: boolean;
  }): Promise<boolean> => {
    if (submitReportInFlightRef.current || isSubmittingReport || isAnySlotUploading) return false;
    if (
      !validateBeforeSubmit({
        status: payload.targetReportStatus,
        reason: payload.targetReasonReport,
        remarks: payload.targetRemarksReport
      })
    ) {
      return false;
    }

    submitReportInFlightRef.current = true;
    const submitIdempotencyKey =
      activeIdempotencyKeyRef.current ||
      `checkout_${activeTicket.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeIdempotencyKeyRef.current = submitIdempotencyKey;

    setShowQcConfirmSheet(false);
    setReportError(null);
    setIsSubmittingReport(true);
    startLoading({
      title: 'MENYIMPAN REPORT & CHECK-OUT...',
      subtitle: 'Menyimpan laporan Status WO → Reason WO, telemetri teknis, bukti foto & Check-Out ke database'
    });

    try {
      const normalizedOpm = opmDbm.trim()
        ? opmDbm.trim().toLowerCase().includes('dbm')
          ? opmDbm.trim()
          : `${opmDbm.trim()} dBm`
        : '';

      let resolvedSignatureUrl = customerSignatureUrl || undefined;
      if (resolvedSignatureUrl && isDataUri(resolvedSignatureUrl)) {
        const sigUpload = await supabaseDb.uploadAssetToStorage({
          fileName: `signature_${activeTicket.woNumber || activeTicket.id}_${Date.now()}.png`,
          fileData: resolvedSignatureUrl,
          mimeType: 'image/png',
          fileCategory: 'wo_document',
          relatedWoNumber: activeTicket.woNumber,
          ticketId: activeTicket.id
        });
        if (!sigUpload.success || !sigUpload.downloadUrl) {
          playErrorSound();
          const sigErr = sigUpload.error || 'Gagal mengunggah tanda tangan pelanggan ke Supabase Storage.';
          setReportError(sigErr);
          toast.error(sigErr, 'Upload Tanda Tangan Gagal');
          return false;
        }
        resolvedSignatureUrl = sigUpload.downloadUrl;
        setCustomerSignatureUrl(sigUpload.downloadUrl);
      }

      const cleanRemarks = payload.targetRemarksReport.trim();
      const res = await saveProgressReport(activeTicket.id, {
        reportStatus: payload.targetReportStatus,
        reportStatusId: payload.targetReportStatusId,
        reasonReport: payload.targetReasonReport,
        reasonReportId: payload.targetReasonReportId,
        remarksReport: cleanRemarks,
        idempotencyKey: submitIdempotencyKey,
        technicalTelemetry: {
          opticalPowerDbm: normalizedOpm || undefined,
          fatRedamanDbm: activeTicket.fatRedamanDbm ? String(activeTicket.fatRedamanDbm) : undefined,
          ontSerialNumber: ontSerialNumber.trim() || undefined,
          dropcoreLength: dropcoreLength.trim() || undefined,
          fatPort: fatPort.trim() || undefined,
          usedMaterials: usedMaterials.trim() || undefined,
          photoSlots: verifiedUploadedSlotsList,
          photos: verifiedUploadedSlotsList.map(s => s.url),
          customerSignatureUrl: resolvedSignatureUrl,
          customerConsentConfirmed
        }
      });

      if (res.success) {
        activeIdempotencyKeyRef.current = null;
        if (payload.closeUnsuccessOnSuccess) {
          setShowUnsuccessModal(false);
        }
        setReportStatus(payload.targetReportStatus);
        setReportStatusId(payload.targetReportStatusId);
        setReasonReport(payload.targetReasonReport);
        setReasonReportId(payload.targetReasonReportId);
        setRemarksReport(cleanRemarks);
        safeLocalStorageRemove(draftStorageKey);
        void deleteMasterCacheValue(`draft_sig_${activeTicket.id}`).catch(() => {});
        setDraftSavedAt(null);
        playReportSavedSound();
        setSavedReportSnapshot({
          status: payload.targetReportStatus,
          reason: payload.targetReasonReport,
          remarks: cleanRemarks
        });
        setShowSuccessAlert(true);
        toast.success(
          `Report "${payload.targetReportStatus}" & Check-Out berhasil dikirim ke Dispatch (BUTUH APPROVAL).`,
          'CHECK-OUT BERHASIL',
          { withSound: true }
        );
        return true;
      } else {
        playErrorSound();
        const errMsg = res.error || 'Gagal menyimpan laporan ke database.';
        setReportError(errMsg);
        if ((res as any).code === 'CHECK_IN_REQUIRED') {
          toast.error(errMsg, 'Check-In PROGRESS Diperlukan');
        } else if ((res as any).code === 'PHOTO_EVIDENCE_INCOMPLETE') {
          toast.error(errMsg, 'Foto Bukti Wajib Kurang');
          if (photoAccordionRef.current) photoAccordionRef.current.open = true;
        } else {
          showGlobalError({
            errorCode: 'MJ-DB-002',
            module: 'Database',
            operation: 'Save Progress Report',
            description: 'Gagal menyimpan data laporan checkout.',
            message: errMsg,
            technicalDetails: errMsg,
            severity: 'HIGH',
            onRetry: () => void executeProgressReportSubmission(payload)
          });
        }
        return false;
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
        onRetry: () => void executeProgressReportSubmission(payload)
      });
      return false;
    } finally {
      submitReportInFlightRef.current = false;
      setIsSubmittingReport(false);
      stopLoading();
    }
  };

  const handleSaveReport = async () => {
    await executeProgressReportSubmission({
      targetReportStatus: reportStatus,
      targetReportStatusId: reportStatusId,
      targetReasonReport: reasonReport,
      targetReasonReportId: reasonReportId,
      targetRemarksReport: remarksReport.trim()
    });
  };

  const handleSaveUnsuccessReport = async (payload: {
    reportStatus: string;
    reportStatusId: string;
    reasonReport: string;
    reasonReportId: string;
    remarksReport: string;
  }) => {
    setReportStatus(payload.reportStatus);
    setReportStatusId(payload.reportStatusId);
    setReasonReport(payload.reasonReport);
    setReasonReportId(payload.reasonReportId);
    setRemarksReport(payload.remarksReport);
    await executeProgressReportSubmission({
      targetReportStatus: payload.reportStatus,
      targetReportStatusId: payload.reportStatusId,
      targetReasonReport: payload.reasonReport,
      targetReasonReportId: payload.reasonReportId,
      targetRemarksReport: payload.remarksReport,
      closeUnsuccessOnSuccess: true
    });
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

  const customerContacts = useMemo(() => extractCustomerContacts(activeTicket), [activeTicket]);
  const locationExtraMeta = useMemo(() => extractLocationExtraMeta(activeTicket), [activeTicket]);
  const startTimeDisplay = useMemo(
    () => formatFullviewTimeValue(activeTicket.checkInAt || activeTicket.workStartedAt),
    [activeTicket.checkInAt, activeTicket.workStartedAt]
  );
  const endTimeDisplay = useMemo(
    () => formatFullviewTimeValue(activeTicket.checkOutAt),
    [activeTicket.checkOutAt]
  );

  const handleCopyAddress = () => {
    const fullAddr = formatWorkOrderAddress(activeTicket).copyText;
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

  const handleConfirmBarcodeSn = async (scannedSn: string, meta?: ParsedBarcodePayload) => {
    const cleanSn = scannedSn.trim().toUpperCase();
    if (!cleanSn) return;
    const triggeredFromPhotoSlot = barcodeScannerSlot;
    setOntSerialNumber(cleanSn);
    setShowBarcodeScannerModal(false);
    setBarcodeScannerSlot(null);

    const barcodeSlotDef =
      triggeredFromPhotoSlot || PHOTO_SLOT_DEFINITIONS.find(d => d.slotKey === 'barcode_sn');
    const shouldUploadPhoto =
      Boolean(meta?.capturedImageDataUrl && barcodeSlotDef) &&
      (Boolean(triggeredFromPhotoSlot) || !photoSlots.barcode_sn?.url);

    if (shouldUploadPhoto && meta?.capturedImageDataUrl && barcodeSlotDef) {
      const base64Body = meta.capturedImageDataUrl.split(',')[1] || '';
      const approxBytes = Math.round((base64Body.length * 3) / 4);
      const gpsRes = await acquireCurrentDeviceGps({ timeoutMs: 2000, maximumAgeMs: 60000 }).catch(
        () => ({ snapshot: undefined })
      );
      const payload: CapturedPhotoPayload = {
        slotKey: 'barcode_sn',
        title: barcodeSlotDef.title,
        fileData: meta.capturedImageDataUrl,
        fileName: `${activeTicket.woNumber || activeTicket.id}_barcode_sn_${Date.now()}.jpg`,
        fileSizeBytes: approxBytes,
        mimeType: 'image/jpeg',
        capturedAtIso: new Date().toISOString(),
        captureMethod: meta.captureMethod || 'camera',
        gps: gpsRes.snapshot || null,
        clientCaptureId: `barcode_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      };
      await executeSlotUpload(barcodeSlotDef, payload);
    }

    if (!triggeredFromPhotoSlot) {
      if (technicalAccordionRef.current) technicalAccordionRef.current.open = true;
      setTimeout(() => {
        snInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        snInputRef.current?.focus();
      }, 120);
    }

    const macNote = meta?.macAddress ? ` · MAC: ${meta.macAddress}` : '';
    const photoNote = shouldUploadPhoto ? ' & foto Slot 06 tersimpan' : '';
    toast.success(
      `SN perangkat ${cleanSn}${macNote} berhasil dipindai${photoNote}.`,
      'Scan Barcode SN'
    );
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
  const uploadedPhotoCount = verifiedUploadedPhotoCount;

  const isCheckInStepDone = !requiresProgressCheckIn || Boolean(activeTicket.checkInAt);
  const isInstallationStepDone =
    isCheckInStepDone && (Boolean(opmDbm.trim()) || Boolean(ontSerialNumber.trim()) || Boolean(fatPort.trim()));
  const isPhotosStepDone = isMandatoryEvidenceReady;
  const isReportStepDone = Boolean(
    (reportStatus && reasonReport && remarksReport.trim()) ||
      (activeTicket.progressReports && activeTicket.progressReports.length > 0 && canonicalApproval !== 'REVISION')
  );
  const isCheckOutDone = Boolean(activeTicket.checkOutAt) || ticketClosed;

  const isCheckoutFormReady = Boolean(
    reportStatus && reasonReport && remarksReport.trim() && isMandatoryEvidenceReady && !isAnySlotUploading
  );

  const relatedActivities = useMemo(() => {
    return (ticketActivities || [])
      .filter(a => a.ticketId === activeTicket.id || a.woNumber === activeTicket.woNumber)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [ticketActivities, activeTicket.id, activeTicket.woNumber]);

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

  const opmNumericForLcd = useMemo(() => {
    const match = String(opmDbm || '').replace(',', '.').match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const val = parseFloat(match[0]);
    return Number.isNaN(val) ? null : val;
  }, [opmDbm]);

  const opmRangePct = useMemo(() => {
    if (opmNumericForLcd === null) return 0;
    // Map -30 dBm (0%) to -10 dBm (100%) across gauge
    const clamped = Math.max(-30, Math.min(-10, opmNumericForLcd));
    return Math.round(((clamped + 30) / 20) * 100);
  }, [opmNumericForLcd]);

  const fullviewContent = (
    <div
      ref={fullviewRef}
      style={{
        zIndex: fullviewLayerZ,
        ...(fullviewViewport.keyboardInset > 0
          ? { paddingBottom: `${fullviewViewport.keyboardInset}px` }
          : {})
      }}
      className="fixed inset-0 bg-[#F8FAFD] dark:bg-[#140827] text-[#26364A] dark:text-[#f5eeff] flex flex-col overflow-hidden"
    >
      {/* ============================================================== */}
      {/* MORAJAWS ENTERPRISE STICKY HEADER                              */}
      {/* ============================================================== */}
      <header className="bg-white/95 dark:bg-[#1E1238] backdrop-blur-md pt-safe border-b border-[#DDE6F0] dark:border-[#35105E] shadow-xs shrink-0 z-20">
        <div className="max-w-6xl mx-auto h-15 px-3 sm:px-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onBack}
              aria-label="Kembali ke Daftar WO"
              className="mj-btn-icon-3d-installer w-9 h-9 cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] truncate">
                  {activeTicket.woNumber}
                </span>
                <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#A79BC0] tabular-nums hidden sm:inline">
                  • Durasi {elapsedClockLabel}
                </span>
              </div>
              <h1 className="font-display text-[15px] sm:text-base font-bold truncate text-[#26364A] dark:text-[#f5eeff] leading-tight">
                Detail Work Order
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsOfflineModalOpen(true)}
              aria-label="Status Koneksi & Sinkronisasi"
              className={`relative mj-btn-xs px-2.5 gap-1.5 text-[11px] font-bold cursor-pointer ${
                !isOnline || pendingCount > 0
                  ? 'mj-btn-installer-warning'
                  : 'mj-btn-installer-neutral'
              }`}
            >
              {isOnline ? <Radio className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{!isOnline ? 'Offline' : isSyncing ? 'Sync' : 'Online'}</span>
              {pendingCount > 0 && (
                <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#D4933E] dark:bg-amber-600 text-white font-mono text-[9.5px] font-bold flex items-center justify-center tabular-nums">
                  {pendingCount > 9 ? '9+' : pendingCount}
                </span>
              )}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowProfilePopover(prev => !prev)}
                aria-label="Info Teknisi"
                className="w-9 h-9 rounded-full bg-gradient-to-br from-[#5145A6] to-[#2E7D8B] dark:bg-none dark:bg-[#7135b5] text-white font-display font-bold text-xs flex items-center justify-center shadow-xs cursor-pointer relative"
              >
                <span>{userInitials}</span>
                <span
                  className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#1E1238] ${
                    isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                />
              </button>

              {showProfilePopover && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setShowProfilePopover(false)} />
                  <div className="absolute right-0 mt-2 w-64 rounded-xl bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] shadow-lg p-3.5 z-30 text-xs space-y-2">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DDE6F0] dark:border-[#35105E]">
                      <div className="min-w-0">
                        <div className="font-bold text-[#26364A] dark:text-[#f5eeff] truncate">{currentUser.name}</div>
                        <div className="font-mono text-[10.5px] text-[#5145A6] dark:text-[#DAB9FF]">
                          @{currentUser.username}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] font-mono text-[10px] font-bold uppercase shrink-0">
                        {currentUser.role}
                      </span>
                    </div>
                    <div className="text-[11px] text-[#52647A] dark:text-[#C4B5D6] space-y-1">
                      <div>
                        Mitra: <strong className="text-[#26364A] dark:text-[#f5eeff]">{activeTicket.contractorName || currentUser.contractor || '-'}</strong>
                      </div>
                      <div>
                        Area: <strong className="text-[#26364A] dark:text-[#f5eeff]">{activeTicket.area || currentUser.area || '-'}</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setShowProfilePopover(false);
                        setIsOfflineModalOpen(true);
                      }}
                      className="mj-btn-installer-neutral mj-btn-xs w-full py-2 px-2.5 text-[11px] justify-between cursor-pointer"
                    >
                      <span>Sinkronisasi Offline</span>
                      <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF]">{pendingCount} antre</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ============================================================== */}
      {/* SCROLLABLE MAIN WORKSPACE                                      */}
      {/* ============================================================== */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 pb-28 sm:pb-24 space-y-3.5">

          {/* TOP NAVIGATION & CHECK-IN STATUS STRIP */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button
              type="button"
              onClick={onBack}
              className="mj-btn-installer-neutral mj-btn-compact px-3 py-1.5 text-xs font-bold gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Kembali ke Tugas Saya</span>
            </button>

            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-[10.5px] font-extrabold border ${
                isCheckInStepDone
                  ? 'bg-[#E4F5EC] dark:bg-emerald-950/50 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-700/60'
                  : 'bg-[#FFF2D9] dark:bg-amber-950/50 text-[#9D661F] dark:text-amber-300 border-[#F2CF95] dark:border-amber-700/60'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isCheckInStepDone ? 'bg-[#218A63] dark:bg-emerald-500 animate-pulse' : 'bg-[#D4933E] dark:bg-amber-500'
                }`}
              />
              <span>{isCheckInStepDone ? 'CHECK-IN (AKTIF)' : 'BELUM CHECK-IN'}</span>
            </span>
          </div>

          {/* ============================================================ */}
          {/* SECTION 1: WORK ORDER SUMMARY (MORAJAWS DETAIL WORK ORDER)   */}
          {/* ============================================================ */}
          <section className="card-3d-lavender rounded-2xl p-4 space-y-3.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#DDE6F0] dark:border-[#35105E]">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                    Work Order
                  </span>
                  <StatusInstallerBadge status={activeTicket.statusWOInstaller} displayRole="installer" />
                  {canonicalReport !== 'NONE' && (
                    <StatusBadge status={canonicalReport} variant="report" />
                  )}
                  {activeTicket.approvalStatus && activeTicket.approvalStatus !== 'NONE' && (
                    <StatusApprovalBadge status={activeTicket.approvalStatus} />
                  )}
                </div>
                <div className="font-mono text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-[#f5eeff] truncate">
                  {activeTicket.woNumber}
                </div>
                <div className="text-xs text-[#52647A] dark:text-[#C4B5D6] truncate">
                  {activeTicket.contactorName || activeTicket.contractorName || currentUser.contractor || 'Mitra Lapangan'} · {activeTicket.area || currentUser.area || '-'}
                </div>
              </div>

              {/* Crystal Aqua-Violet / Dark Inset Digital SLA Timer */}
              <div className="rounded-xl bg-gradient-to-br from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:bg-none dark:bg-[#160D29] border border-[#BDE4E8] dark:border-[#35105E] px-4 py-2.5 text-[#26364A] dark:text-white shrink-0 shadow-inner min-w-[165px]">
                <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-[#2E7D8B] dark:text-[#DAB9FF]">
                  <Timer className="w-3 h-3" />
                  <span>DURASI KERJA</span>
                </div>
                <div className="font-mono text-xl sm:text-2xl font-extrabold text-[#26364A] dark:text-white tabular-nums leading-tight mt-0.5">
                  {elapsedClockLabel}
                </div>
                <div className="font-mono text-[10px] text-[#5145A6] dark:text-[#A380FE]">
                  Target SLA 90m
                </div>
              </div>
            </div>

            {/* Structured WO Fields Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
              <div className="rounded-xl bg-[#FFFFFF]/80 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2">
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Tanggal Janji Temu</span>
                <span className="font-bold text-[#26364A] dark:text-[#f5eeff] block truncate mt-0.5">
                  {appointmentDateDisplay}
                </span>
              </div>
              <div className="rounded-xl bg-[#FFFFFF]/80 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2">
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Slot Time</span>
                <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF] block truncate mt-0.5">
                  {activeTicket.slotTime || '-'}
                </span>
              </div>
              <div className="rounded-xl bg-[#FFFFFF]/80 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2 col-span-2 sm:col-span-1">
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Kategori WO</span>
                <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] block truncate mt-0.5">
                  {woBadgeLabel}{serviceLabel ? ` · ${serviceLabel}` : ''}
                </span>
              </div>
              <div className="rounded-xl bg-[#FFFFFF]/80 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2">
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Waktu Mulai</span>
                <span className="font-mono font-bold text-[#26364A] dark:text-[#f5eeff] block mt-0.5 tabular-nums">
                  {startTimeDisplay}
                </span>
              </div>
              <div className="rounded-xl bg-[#FFFFFF]/80 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2">
                <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Waktu Berakhir</span>
                <span className="font-mono font-bold text-[#26364A] dark:text-[#f5eeff] block mt-0.5 tabular-nums">
                  {endTimeDisplay}
                </span>
              </div>
              <div className="rounded-xl bg-[#FFFFFF]/80 dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2 col-span-2 sm:col-span-1 flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Teknisi / Korlap</span>
                  <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] block truncate">
                    {activeTicket.installerName || '-'} · {activeTicket.leaderName || '-'}
                  </span>
                </div>
              </div>
            </div>

            {(activeTicket.remarksAgent || activeTicket.remarks) && (
              <div className="bg-[#FFFFFF]/85 dark:bg-[#160D29] rounded-xl p-2.5 border border-[#DDE6F0] dark:border-[#35105E] text-[11px] text-[#52647A] dark:text-[#C4B5D6] leading-snug">
                <span className="font-bold text-[#5145A6] dark:text-[#DAB9FF] block mb-0.5">Catatan Dispatch:</span>
                <p className="line-clamp-3">{activeTicket.remarksAgent || activeTicket.remarks}</p>
              </div>
            )}

            {ticketClosed && (
              <div className="p-3 rounded-xl bg-[#E4F5EC] dark:bg-emerald-950/40 border border-[#B7E4CC] dark:border-emerald-800/60 text-xs flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-[#218A63] dark:text-emerald-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 min-w-0">
                  <div className="font-bold text-[#1B6B4D] dark:text-emerald-200 flex items-center gap-2 flex-wrap">
                    <span>Work Order Terverifikasi Dispatch (Read-Only)</span>
                    <StatusBadge status="APPROVED" variant="approval" />
                  </div>
                  <p className="text-[11px] text-[#218A63] dark:text-emerald-300/90">
                    Laporan akhir ({canonicalReport !== 'NONE' ? canonicalReport : activeTicket.statusWOInstaller}) telah disetujui Dispatch{' '}
                    {activeTicket.approvedBy ? `(${activeTicket.approvedBy})` : ''}.
                  </p>
                </div>
              </div>
            )}

            {!ticketClosed && canonicalApproval === 'REVISION' && (
              <div className="p-3 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/40 border border-[#F3C5CA] dark:border-rose-800/60 text-[#9B2C37] dark:text-rose-200 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 font-bold uppercase tracking-wide">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>Revisi Laporan Diminta Dispatch</span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#D45B66] dark:bg-[#ba1a1a] text-white font-mono text-[10px] font-bold">
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

          {/* ============================================================ */}
          {/* TOP 2-COLUMN CARDS: DATA PELANGGAN & LOKASI PEKERJAAN        */}
          {/* ============================================================ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {/* SECTION 2: DATA PELANGGAN */}
            <section className="mj-enterprise-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DDE6F0] dark:border-[#35105E]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-[#DDF4F4] dark:bg-[#2A194B] text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                    <User className="w-3.5 h-3.5" />
                  </span>
                  <h2 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff] truncate">
                    Data Pelanggan
                  </h2>
                </div>
                <span className="font-mono text-[10.5px] font-bold px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
                  ID: {activeTicket.idCustomer || activeTicket.customerId || '-'}
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-3 space-y-2">
                  <div>
                    <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Nama Pelanggan</span>
                    <div className="font-display font-bold text-[15px] text-[#26364A] dark:text-[#f5eeff] mt-0.5 break-words">
                      {activeTicket.customerName || activeTicket.endUserName || 'Pelanggan'}
                    </div>
                  </div>

                  {/* Contact placed directly below Customer Name */}
                  <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-2">
                    <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Contact</span>
                    {customerContacts.length === 0 ? (
                      <div className="font-mono text-[11px] text-[#8492A5] dark:text-[#A79BC0]">
                        Nomor kontak pelanggan belum tersedia
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {customerContacts.map((contact, idx) => (
                          <div
                            key={`${contact.raw}-${idx}`}
                            className="flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] rounded-lg px-2.5 py-2"
                          >
                            <div className="min-w-0">
                              {customerContacts.length > 1 && (
                                <span className="font-mono text-[9.5px] uppercase text-[#8492A5] dark:text-[#A79BC0] block">
                                  {contact.label}
                                </span>
                              )}
                              <span className="font-mono text-xs font-bold text-[#26364A] dark:text-[#f5eeff]">
                                {contact.raw}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {contact.telHref && (
                                <a
                                  href={contact.telHref}
                                  className="mj-btn-installer-neutral mj-btn-xs px-2.5 py-1 text-[11px] font-bold gap-1"
                                >
                                  <Phone className="w-3 h-3 text-[#5145A6] dark:text-[#DAB9FF]" />
                                  <span>Telepon</span>
                                </a>
                              )}
                              {contact.waUrl ? (
                                <a
                                  href={contact.waUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mj-btn-installer-success mj-btn-xs px-2.5 py-1 text-[11px] font-bold gap-1"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  <span>WhatsApp</span>
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onOpenWhatsApp(activeTicket)}
                                  className="mj-btn-installer-success mj-btn-xs px-2.5 py-1 text-[11px] font-bold gap-1 cursor-pointer"
                                >
                                  <MessageSquare className="w-3 h-3" />
                                  <span>WhatsApp</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* SECTION 3: LOKASI PEKERJAAN */}
            <section className="mj-enterprise-card rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DDE6F0] dark:border-[#35105E]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-6 h-6 rounded-lg bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                    <MapPin className="w-3.5 h-3.5" />
                  </span>
                  <h2 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff] truncate">
                    Lokasi
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1 font-mono text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF] bg-[#EAE8FF] dark:bg-[#160D29] px-2 py-0.5 rounded-full border border-[#DCE3F2] dark:border-[#35105E] truncate max-w-[160px]">
                  <Calendar className="w-3 h-3 shrink-0" />
                  <span className="truncate">{activeTicket.area || '-'}</span>
                </span>
              </div>

              <button
                type="button"
                onClick={handleCopyAddress}
                className="w-full text-left flex items-start gap-2 p-3 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[11.5px] text-[#52647A] dark:text-[#C4B5D6] hover:text-[#26364A] dark:hover:text-[#f5eeff] cursor-pointer"
                title="Ketuk untuk menyalin alamat"
              >
                {copiedAddress ? (
                  <Check className="w-3.5 h-3.5 text-[#218A63] dark:text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <WorkOrderAddressBlock
                    ticket={activeTicket}
                    variant="detail"
                    showIcon={false}
                    fallbackText="Alamat belum tercatat"
                  />
                </div>
              </button>

              {(locationExtraMeta.cluster ||
                locationExtraMeta.homepass ||
                locationExtraMeta.fatCode ||
                locationExtraMeta.fdtCode ||
                locationExtraMeta.blokNomor ||
                locationExtraMeta.rtRw) && (
                <div className="flex flex-wrap gap-1.5 text-[10.5px]">
                  {locationExtraMeta.cluster && (
                    <span className="px-2 py-1 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#C4B5D6]">
                      Cluster: <strong className="text-[#26364A] dark:text-[#f5eeff]">{locationExtraMeta.cluster}</strong>
                    </span>
                  )}
                  {locationExtraMeta.blokNomor && (
                    <span className="px-2 py-1 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#C4B5D6]">
                      <strong className="text-[#26364A] dark:text-[#f5eeff]">{locationExtraMeta.blokNomor}</strong>
                    </span>
                  )}
                  {locationExtraMeta.rtRw && (
                    <span className="px-2 py-1 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#C4B5D6]">
                      <strong className="text-[#26364A] dark:text-[#f5eeff]">{locationExtraMeta.rtRw}</strong>
                    </span>
                  )}
                  {locationExtraMeta.homepass && (
                    <span className="px-2 py-1 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#C4B5D6] font-mono">
                      HP: <strong className="text-[#26364A] dark:text-[#f5eeff]">{locationExtraMeta.homepass}</strong>
                    </span>
                  )}
                  {locationExtraMeta.fatCode && (
                    <span className="px-2 py-1 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#C4B5D6] font-mono">
                      FAT: <strong className="text-[#5145A6] dark:text-[#DAB9FF]">{locationExtraMeta.fatCode}</strong>
                    </span>
                  )}
                  {locationExtraMeta.fdtCode && (
                    <span className="px-2 py-1 rounded-lg bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#52647A] dark:text-[#C4B5D6] font-mono">
                      FDT: <strong className="text-[#5145A6] dark:text-[#DAB9FF]">{locationExtraMeta.fdtCode}</strong>
                    </span>
                  )}
                </div>
              )}

              {houseCoordsValid && (
                <a
                  href={buildGoogleMapsCoordinateUrl(
                    activeTicket.houseLocation!.latitude,
                    activeTicket.houseLocation!.longitude
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline"
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    GPS Rumah: {formatCoordinates(activeTicket.houseLocation!.latitude, activeTicket.houseLocation!.longitude)}
                  </span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={handleOpenMaps}
                  className="mj-btn-installer-neutral mj-btn-compact px-3 py-1.5 text-[11px] font-bold gap-1.5 cursor-pointer"
                >
                  <MapPin className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#DAB9FF]" />
                  <span>Buka Google Maps</span>
                </button>
                <button
                  type="button"
                  onClick={handleCopyAddress}
                  className="mj-btn-installer-neutral mj-btn-compact px-3 py-1.5 text-[11px] font-bold gap-1.5 cursor-pointer"
                >
                  {copiedAddress ? (
                    <Check className="w-3.5 h-3.5 text-[#218A63] dark:text-emerald-400" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                  )}
                  <span>{copiedAddress ? 'Alamat Disalin' : 'Salin Alamat'}</span>
                </button>
              </div>
            </section>
          </div>

          {/* ============================================================ */}
          {/* PRE-CHECK-IN VS POST-CHECK-IN WORKFLOW                       */}
          {/* ============================================================ */}
          {!ticketClosed && requiresProgressCheckIn ? (
            <>
              <section
                ref={checkInSectionRef}
                className="mj-enterprise-card rounded-2xl p-4 sm:p-5 space-y-3.5"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-[#DDE6F0] dark:border-[#35105E]">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/60 border border-[#F2CF95] dark:border-amber-800/60 text-[#9D661F] dark:text-amber-300 flex items-center justify-center shrink-0">
                      <Camera className="w-4 h-4" />
                    </span>
                    <div>
                      <h2 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff]">
                        Check-In Lokasi Pelanggan
                      </h2>
                      <p className="text-[11px] text-[#8492A5] dark:text-[#A79BC0]">
                        Tahap wajib sebelum membuka form teknis &amp; pelaporan
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#FFF2D9] dark:bg-amber-950/50 text-[#9D661F] dark:text-amber-300 border border-[#F2CF95] dark:border-amber-700/60">
                    Menunggu Check-In
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-[#FFF2D9]/75 dark:bg-amber-950/35 border border-[#F2CF95] dark:border-amber-800/60 space-y-3">
                  <div className="text-xs text-[#7D4F15] dark:text-amber-200 leading-relaxed">
                    <strong>Siap Memulai Pekerjaan?</strong> Tekan tombol <strong>CHECK IN</strong> di bawah untuk membuka kamera GPS, mengambil <strong>Foto Rumah (#01)</strong>, dan mencatat timestamp Check-In beserta status <strong>#PROGRESS</strong>.
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleTriggerCheckIn}
                      data-testid="fullview-inline-checkin-btn"
                      className="mj-btn-installer-primary min-h-[44px] px-4 py-2 text-xs font-bold gap-1.5 cursor-pointer"
                    >
                      <Camera className="w-4 h-4" />
                      <span>CHECK IN Sekarang</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenProgressChatForCheckIn}
                      className="mj-btn-installer-neutral mj-btn-compact min-h-[44px] px-3 py-2 text-xs font-bold gap-1.5 cursor-pointer"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                      <span>LiveChat #PROGRESS</span>
                    </button>
                  </div>
                </div>
              </section>

              {progressHistory.length > 0 && (
                <details className="group mj-enterprise-card rounded-2xl overflow-hidden">
                  <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF]" />
                      <h3 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff]">
                        Riwayat Report ({progressHistory.length} Versi)
                      </h3>
                    </div>
                    <ChevronDown className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <div className="px-4 pb-4 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-2 max-h-[240px] overflow-y-auto">
                    {progressHistory.map((item, idx) => (
                      <div
                        key={item.id || idx}
                        className="p-2.5 rounded-lg border border-[#DDE6F0] dark:border-[#35105E] bg-[#F8FAFD] dark:bg-[#160D29] space-y-1 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <span className="font-semibold text-[#26364A] dark:text-[#f5eeff]">
                            {item.reportStatus} · {item.reasonReport}
                          </span>
                          <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#A79BC0]">
                            {formatJakartaTimeOnly(item.timestamp)} WIB
                          </span>
                        </div>
                        {item.remarksReport && (
                          <p className="text-[11px] text-[#52647A] dark:text-[#C4B5D6] italic">&ldquo;{item.remarksReport}&rdquo;</p>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          ) : (
            <>
              {/* SECTION 4: WORK PROGRESS & CHECK-IN STATUS (NO STANDALONE KENDALA BUTTON) */}
              <section
                ref={checkInSectionRef}
                className="mj-enterprise-card rounded-2xl p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-[#DDF4F4] dark:bg-[#2A194B] text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff]">
                        Work Progress &amp; Check-In
                      </h2>
                      <span className="text-[11px] text-[#8492A5] dark:text-[#A79BC0] block truncate">
                        {isCheckInStepDone
                          ? `Check-In tercatat pukul ${validatedCheckInTime} WIB • Valid #PROGRESS`
                          : 'Detail progres pengerjaan Work Order'}
                      </span>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#E4F5EC] dark:bg-emerald-950/50 border border-[#B7E4CC] dark:border-emerald-700/60 font-mono text-[10.5px] font-bold text-[#218A63] dark:text-emerald-300 tabular-nums">
                    <LockOpen className="w-3 h-3" />
                    <span>{validatedCheckInTime !== '-' ? `${validatedCheckInTime} WIB` : 'Aktif'}</span>
                  </span>
                </div>

                {/* 5-Stage Progress Stepper */}
                <div className="bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl p-2.5 border border-[#DDE6F0] dark:border-[#35105E] grid grid-cols-5 gap-1.5 text-center">
                  {[
                    {
                      label: 'Check-In',
                      done: isCheckInStepDone,
                      active: !isCheckInStepDone,
                      sub: isCheckInStepDone ? 'OK' : 'Wajib',
                      onClick: () => {
                        checkInSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    },
                    {
                      label: 'Foto',
                      done: isPhotosStepDone,
                      active: isCheckInStepDone && !isPhotosStepDone,
                      sub: `Wajib ${mandatoryPhotoCount}/3`,
                      onClick: () => {
                        if (photoAccordionRef.current) photoAccordionRef.current.open = true;
                        photoAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
                      label: 'Report',
                      done: isReportStepDone,
                      active: isCheckInStepDone && !isReportStepDone,
                      sub: isReportStepDone ? 'Siap' : 'Status WO',
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
                      className="flex flex-col items-center p-1.5 rounded-lg hover:bg-white dark:hover:bg-[#2A194B] transition-colors cursor-pointer"
                    >
                      <div
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10.5px] font-bold mb-1 ${
                          step.done
                            ? 'bg-[#218A63] dark:bg-emerald-600 text-white'
                            : step.active
                            ? 'bg-[#6657C8] dark:bg-[#7135b5] text-white ring-2 ring-[#BDE4E8] dark:ring-[#58149C]'
                            : 'bg-[#EDF3F8] dark:bg-[#2A194B] text-[#52647A] dark:text-[#C4B5D6]'
                        }`}
                      >
                        {step.done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                      </div>
                      <span className="text-[10.5px] font-bold text-[#26364A] dark:text-[#f5eeff] leading-tight truncate max-w-full">
                        {step.label}
                      </span>
                      <span className="font-mono text-[9px] text-[#8492A5] dark:text-[#A79BC0] truncate max-w-full">
                        {step.sub}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* SECTION 5: BUKTI FOTO FISIK (ORDERED 1-7) */}
              <details
                ref={photoAccordionRef}
                open
                className="group mj-enterprise-card rounded-2xl overflow-hidden"
              >
                <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-[#DDF4F4] dark:bg-[#2A194B] text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                      <Camera className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff] truncate">
                        Bukti Foto Fisik
                      </h2>
                      <span className="text-[11px] text-[#8492A5] dark:text-[#A79BC0] block truncate">
                        7 Foto SOP berurutan (Wajib min. 3: Rumah, FAT, Redaman FAT)
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] font-mono text-[11px] font-bold tabular-nums border border-[#DCE3F2] dark:border-[#d8ccf3]">
                      Wajib {mandatoryPhotoCount}/3 · {verifiedUploadedPhotoCount}/{totalPhotoSlots}
                    </span>
                    <ChevronDown className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] transition-transform duration-200 group-open:rotate-180" />
                  </div>
                </summary>

                <div className="px-4 pb-4 pt-1 border-t border-[#DDE6F0] dark:border-[#35105E]">
                  <PhotoEvidenceMatrixSection
                    sectionRef={photoSectionRef}
                    activeTicket={activeTicket}
                    photoSlots={photoSlots}
                    uploadedCount={uploadedPhotoCount}
                    verifiedUploadedCount={verifiedUploadedPhotoCount}
                    slotUploadState={slotUploadState}
                    deletingSlotKey={deletingSlotKey}
                    expandedMapSlot={expandedMapSlot}
                    onToggleMapSlot={setExpandedMapSlot}
                    ticketClosed={ticketClosed}
                    opmDbm={opmDbm}
                    fatPort={fatPort}
                    ontSerialNumber={ontSerialNumber}
                    onOpenCamera={openCameraForSlot}
                    onRetryUpload={handleRetrySlotUpload}
                    onViewPhoto={(url, slotDef) => setLightboxState({ url, slotDef })}
                    onDeletePhoto={handleDeletePhotoSlot}
                  />
                </div>
              </details>

              {/* SECTION 6: TECHNICAL INFORMATION */}
              <details
                ref={technicalAccordionRef}
                open
                className="group mj-enterprise-card rounded-2xl overflow-hidden"
              >
                <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff] truncate">
                        Technical Information
                      </h2>
                      <span className="font-mono text-[11px] text-[#8492A5] dark:text-[#A79BC0] block truncate">
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
                    <ChevronDown className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] transition-transform duration-200 group-open:rotate-180" />
                  </div>
                </summary>

                <div className="px-4 pb-4 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-3.5">
                  {/* Crystal Aqua-Violet / Dark Inset OPM READING (1490 nm RX) LCD Card */}
                  <div className="rounded-2xl bg-gradient-to-br from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:bg-none dark:bg-[#160D29] border border-[#BDE4E8] dark:border-[#35105E] p-4 text-[#26364A] dark:text-white space-y-3 shadow-inner">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#2E7D8B] dark:text-[#DAB9FF]">
                        <Gauge className="w-3.5 h-3.5" />
                        <span>OPM READING (1490 nm RX)</span>
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold border ${opmStatus.badgeCls}`}>
                        {opmStatus.label}
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-3 flex-wrap">
                      <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
                        <span
                          className={`text-3xl sm:text-4xl font-extrabold leading-none ${
                            opmStatus.isOutOfSpec ? 'text-[#9B2C37] dark:text-rose-300' : 'text-[#26364A] dark:text-white'
                          }`}
                        >
                          {opmDbm.trim() || '—'}
                        </span>
                        <span className="text-sm font-bold text-[#5145A6] dark:text-[#DAB9FF]">dBm</span>
                      </div>

                      {!ticketClosed && (
                        <button
                          type="button"
                          onClick={() => document.getElementById('opm-input')?.focus()}
                          className="mj-btn-installer-secondary mj-btn-xs px-3 py-1.5 text-[11px] font-bold cursor-pointer"
                        >
                          Ukur / Input OPM
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="w-full h-2 rounded-full bg-[#DDE6F0] dark:bg-white/10 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            opmNumericForLcd === null
                              ? 'w-0'
                              : opmStatus.isOutOfSpec
                              ? 'bg-[#D45B66] dark:bg-[#BA1A1A]'
                              : 'bg-gradient-to-r from-[#218A63] to-[#65B8C4] dark:from-emerald-400 dark:to-[#A380FE]'
                          }`}
                          style={{ width: `${opmNumericForLcd !== null ? Math.max(8, opmRangePct) : 0}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[10px] font-mono text-[#52647A] dark:text-white/70">
                        <span>Standar Redaman SOP: -15.0 s/d -24.0 dBm</span>
                        <span>{opmNumericForLcd !== null ? 'Tercatat' : 'Belum diukur'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Allocation Summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 bg-[#F8FAFD] dark:bg-[#160D29] p-3 rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
                    <div>
                      <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">FAT / OLT</span>
                      <span className="font-mono text-xs text-[#26364A] dark:text-[#f5eeff] font-bold truncate block">
                        {activeTicket.fatCode || activeTicket.oltCode || '-'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Port Assignment</span>
                      <span className="font-mono text-xs text-[#5145A6] dark:text-[#DAB9FF] font-bold truncate block">
                        {fatPort.trim() ? `Port ${fatPort.replace(/^#/, '')}` : 'Menunggu Input'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Redaman Roset / FAT</span>
                      <span className={`font-mono text-xs font-bold truncate block ${opmStatus.isOutOfSpec ? 'text-[#9B2C37] dark:text-rose-300' : 'text-[#218A63] dark:text-emerald-400'}`}>
                        {opmDbm.trim()
                          ? `${opmDbm.trim()} dBm`
                          : activeTicket.fatRedamanDbm
                          ? `${activeTicket.fatRedamanDbm} dBm`
                          : 'Belum Diukur'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Standar SOP</span>
                      <span className="font-mono text-xs text-[#52647A] dark:text-[#C4B5D6] font-semibold">
                        -15 s/d -24 dBm
                      </span>
                    </div>
                  </div>

                  {/* ONT Info Pill */}
                  <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Router className="w-4 h-4 text-[#2E7D8B] dark:text-[#DAB9FF] shrink-0" />
                      <div className="min-w-0">
                        <span className="text-xs text-[#26364A] dark:text-[#f5eeff] block font-bold truncate">
                          {activeTicket.ontBrand || 'GPON ONT'} {activeTicket.ontModel || ''}
                        </span>
                        <span className={`font-mono text-[10.5px] block truncate ${ontSerialNumber.trim() ? 'text-[#218A63] dark:text-emerald-400 font-semibold' : 'text-[#8492A5] dark:text-[#A79BC0]'}`}>
                          {ontSerialNumber.trim()
                            ? `SN Terinput: ${ontSerialNumber.trim()}`
                            : 'SN belum diinput — ketuk Scan SN atau Foto #06'}
                        </span>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-white dark:bg-[#2A194B] border border-[#DCE3F2] dark:border-[#4B386B] text-[#5145A6] dark:text-[#DAB9FF] font-bold shrink-0">
                      ONT
                    </span>
                  </div>

                  {/* Calibration Form Inputs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label htmlFor="opm-input" className="text-xs font-bold text-[#26364A] dark:text-[#f5eeff]">
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
                          className={`tactile-debossed-input w-full bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] font-mono font-bold text-base rounded-xl py-2 pl-3 pr-14 focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5] tabular-nums disabled:opacity-60 ${
                            opmStatus.isOutOfSpec ? 'text-[#9B2C37] dark:text-rose-300' : 'text-[#26364A] dark:text-[#f5eeff]'
                          }`}
                        />
                        <span className="absolute right-3 font-mono text-xs font-semibold text-[#8492A5] dark:text-[#A79BC0]">
                          dBm
                        </span>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label htmlFor="ont-sn-input" className="block text-xs font-bold text-[#26364A] dark:text-[#f5eeff]">
                          Nomor Seri (SN) ONT / Perangkat Wi-Fi
                        </label>
                        {!ticketClosed && (
                          <button
                            type="button"
                            onClick={() => openCameraForSlotKey('barcode_sn')}
                            className="font-mono text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline shrink-0 cursor-pointer"
                          >
                            Foto #06 SN
                          </button>
                        )}
                      </div>
                      <div className="flex gap-2 items-center">
                        <div className="relative flex-1">
                          <input
                            id="ont-sn-input"
                            ref={snInputRef}
                            type="text"
                            value={ontSerialNumber}
                            disabled={ticketClosed || isSubmittingReport}
                            onChange={e => setOntSerialNumber(e.target.value.toUpperCase())}
                            placeholder="Scan barcode atau ketik SN ONT / Wi-Fi"
                            className="w-full min-h-[44px] bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#f5eeff] font-mono font-bold text-xs rounded-xl py-2.5 pl-3 pr-9 focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5] uppercase tracking-wider disabled:opacity-60"
                          />
                          {ontSerialNumber.trim().length >= 6 && (
                            <CheckCircle2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-[#218A63] dark:text-emerald-600" />
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={ticketClosed || isSubmittingReport}
                          onClick={() => setShowBarcodeScannerModal(true)}
                          className="mj-btn-installer-secondary mj-btn-compact min-h-[44px] px-3 text-xs font-bold gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                          title="Buka Kamera Scanner Barcode / QR SN ONT & Perangkat Wi-Fi"
                        >
                          <QrCode className="w-4 h-4 shrink-0" />
                          <span>Scan SN</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="dropcore-input" className="block text-xs font-bold text-[#26364A] dark:text-[#f5eeff] mb-1">
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
                          className="w-full bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#f5eeff] font-mono font-bold text-xs rounded-xl py-2.5 pl-3 pr-14 focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5] tabular-nums disabled:opacity-60"
                        />
                        <span className="absolute right-3 top-2.5 font-mono text-[11px] text-[#8492A5] dark:text-[#A79BC0]">
                          Meter
                        </span>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="fat-port-input" className="block text-xs font-bold text-[#26364A] dark:text-[#f5eeff] mb-1">
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
                          className="w-full bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#f5eeff] font-mono font-bold text-xs rounded-xl py-2.5 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5] disabled:opacity-60"
                        />
                        <Cable className="w-4 h-4 absolute right-2.5 top-2.5 text-[#2E7D8B] dark:text-[#DAB9FF] pointer-events-none" />
                      </div>
                    </div>
                  </div>

                  {/* Used Materials */}
                  <div>
                    <label htmlFor="materials-input" className="flex items-center gap-1.5 text-xs font-bold text-[#26364A] dark:text-[#f5eeff] mb-1">
                      <Package className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#DAB9FF]" />
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
                      className="w-full bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-[#26364A] dark:text-[#f5eeff] text-xs rounded-xl py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5] disabled:opacity-60"
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
                              className="mj-btn-installer-neutral mj-btn-xs px-2.5 py-1 text-[11px] font-semibold cursor-pointer"
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

              {/* SECTION 7: STATUS LAPORAN & RIWAYAT REPORT */}
              <details
                ref={reportAccordionRef}
                open
                className="group mj-enterprise-card rounded-2xl overflow-hidden"
              >
                <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-[#DDF4F4] dark:bg-[#2A194B] text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                      <FileText className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff] truncate">
                        Ringkasan Laporan &amp; Riwayat Report
                      </h2>
                      <span className="text-[11px] text-[#8492A5] dark:text-[#A79BC0] block truncate">
                        {reportStatus && reasonReport
                          ? `${reportStatus} · ${reasonReport}`
                          : 'Gunakan tombol COMPLETED (hijau) atau UNSUCCESS (merah) di bawah'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DCE3F2] dark:border-[#4B386B]">
                      {progressHistory.length} Versi
                    </span>
                    <ChevronDown className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] transition-transform duration-200 group-open:rotate-180" />
                  </div>
                </summary>

                <div className="px-4 pb-4 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-3">
                  {reportError && (
                    <div className="p-3 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/50 border border-[#F3C5CA] dark:border-rose-800/60 text-[#9B2C37] dark:text-rose-300 text-xs flex items-center gap-2 font-semibold">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{reportError}</span>
                    </div>
                  )}

                  {/* Compact Current Report Draft / Snapshot */}
                  <div className="bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl p-3.5 border border-[#DDE6F0] dark:border-[#35105E] space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                        Status Laporan Terkini
                      </span>
                      {!ticketClosed && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowCompletedModal(true)}
                            className="mj-btn-installer-success mj-btn-xs px-2.5 py-1 text-[10.5px] font-bold cursor-pointer"
                          >
                            Form Completed
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowUnsuccessModal(true)}
                            className="mj-btn-installer-danger mj-btn-xs px-2.5 py-1 text-[10.5px] font-bold cursor-pointer"
                          >
                            Form Unsuccess
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Status WO</span>
                        <span className="font-bold text-[#26364A] dark:text-[#f5eeff]">
                          {reportStatus || 'Belum dipilih'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Reason WO</span>
                        <span className="font-bold text-[#26364A] dark:text-[#f5eeff]">
                          {reasonReport || 'Belum dipilih'}
                        </span>
                      </div>
                    </div>
                    {remarksReport.trim() && (
                      <div className="pt-1 border-t border-[#DDE6F0] dark:border-[#35105E]">
                        <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] block">Remarks</span>
                        <p className="text-[11px] text-[#52647A] dark:text-[#C4B5D6] italic mt-0.5">
                          &ldquo;{remarksReport.trim()}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Report History & Timeline */}
                  <div className="bg-[#FFFFFF] dark:bg-[#1E1238] rounded-xl p-3.5 border border-[#DDE6F0] dark:border-[#35105E] space-y-2.5">
                    <button
                      type="button"
                      onClick={() => setShowHistorySection(prev => !prev)}
                      className="w-full flex items-center justify-between pb-2 border-b border-[#DDE6F0] dark:border-[#35105E] cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <History className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                        <h3 className="font-display font-bold text-[13px] text-[#26364A] dark:text-[#f5eeff]">
                          Riwayat Report ({progressHistory.length} Versi)
                        </h3>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] transition-transform ${
                          showHistorySection ? 'rotate-180' : ''
                        }`}
                      />
                    </button>

                    {showHistorySection && (
                      <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
                        {progressHistory.length === 0 ? (
                          <div className="py-3 text-center text-[#8492A5] dark:text-[#A79BC0] text-xs">
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
                                className="p-2.5 rounded-lg border border-[#DDE6F0] dark:border-[#35105E] bg-[#F8FAFD] dark:bg-[#160D29] space-y-1 text-xs"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1 pb-1 border-b border-[#DDE6F0] dark:border-[#35105E]">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF]">
                                      v{item.versionNumber || progressHistory.length - idx}
                                    </span>
                                    <span className="font-mono text-[10px] text-[#8492A5] dark:text-[#A79BC0]">
                                      {formattedDate} WIB
                                    </span>
                                    <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] inline-flex items-center gap-1">
                                      <User className="w-3 h-3 text-[#5145A6] dark:text-[#DAB9FF]" />
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

                                <div className="text-[11px] text-[#52647A] dark:text-[#C4B5D6]">
                                  <span>Reason WO: <strong className="text-[#26364A] dark:text-[#f5eeff]">{item.reasonReport}</strong></span>
                                </div>

                                {item.remarksReport && (
                                  <p className="text-[11px] text-[#52647A] dark:text-[#C4B5D6] italic bg-[#FFFFFF] dark:bg-[#1E1238] p-2 rounded border border-[#DDE6F0] dark:border-[#35105E]">
                                    &ldquo;{item.remarksReport}&rdquo;
                                  </p>
                                )}

                                {(item.revisionReason || (item as any).rejectionReason) && (
                                  <div className="p-2 rounded bg-[#FCE9EB] dark:bg-rose-950/40 border border-[#F3C5CA] dark:border-rose-800/60 text-[#9B2C37] dark:text-rose-300 text-[10.5px] font-semibold">
                                    Catatan Revisi Dispatch: &ldquo;
                                    {item.revisionReason || (item as any).rejectionReason}&rdquo;
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}

                        {relatedActivities.length > 0 && (
                          <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-1.5">
                            <div className="font-mono text-[10px] uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0] font-semibold flex items-center justify-between">
                              <span>Log Aktivitas Terbaru</span>
                              <Wrench className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                            </div>
                            {relatedActivities.slice(0, 4).map(act => (
                              <div
                                key={act.id}
                                className="p-2 rounded bg-[#F8FAFD] dark:bg-[#160D29] text-[11px] border-l-2 border-[#6657C8] dark:border-[#7135b5]"
                              >
                                <div className="flex items-center justify-between gap-2 text-[#26364A] dark:text-[#f5eeff] font-semibold">
                                  <span className="truncate">{act.performedBy || 'Sistem'}</span>
                                  <span className="font-mono text-[9.5px] text-[#8492A5] dark:text-[#A79BC0] shrink-0">
                                    {formatJakartaTimeOnly(act.timestamp)}
                                  </span>
                                </div>
                                <p className="text-[#52647A] dark:text-[#C4B5D6] leading-snug mt-0.5">{act.description}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </details>

              {/* SECTION 8: TANDA TANGAN PELANGGAN & DRAFT LOKAL */}
              <details
                ref={signatureSectionRef}
                open
                className="group mj-enterprise-card rounded-2xl overflow-hidden"
              >
                <summary className="p-4 flex items-center justify-between cursor-pointer select-none">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                      <PenTool className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff] truncate">
                        Check-Out &amp; Tanda Tangan Pelanggan
                      </h2>
                      <span className="text-[11px] text-[#8492A5] dark:text-[#A79BC0] block truncate">
                        {activeTicket.checkOutAt
                          ? `Check-Out tercatat ${formatJakartaTimeOnly(activeTicket.checkOutAt)} WIB`
                          : 'Konfirmasi Berita Acara Pelanggan & Simpan Draft Lokal'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-mono text-[10px] font-bold flex items-center gap-1 px-2.5 py-0.5 rounded-full border ${
                        isSignatureReady
                          ? 'text-[#218A63] dark:text-emerald-300 bg-[#E4F5EC] dark:bg-emerald-950/50 border-[#B7E4CC] dark:border-emerald-700/60'
                          : 'text-[#52647A] dark:text-[#C4B5D6] bg-[#EDF3F8] dark:bg-[#160D29] border-[#DDE6F0] dark:border-[#35105E]'
                      }`}
                    >
                      <PenTool className="w-3 h-3" />
                      <span>{isSignatureReady ? 'TTD Siap' : 'Belum TTD'}</span>
                    </span>
                    <ChevronDown className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] transition-transform duration-200 group-open:rotate-180" />
                  </div>
                </summary>

                <div className="px-4 pb-4 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-3">
                  <div className="relative bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl p-3 border border-[#DDE6F0] dark:border-[#35105E]">
                    <div className="relative w-full h-28 bg-white rounded-lg border border-[#DDE6F0] dark:border-[#35105E]">
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
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-mono text-[#8492A5]">
                          Tanda tangan pelanggan di area ini...
                        </div>
                      )}
                    </div>

                    <div className="w-full flex items-center justify-between pt-2 mt-1">
                      <span className="text-xs font-semibold text-[#26364A] dark:text-[#f5eeff] truncate">
                        {activeTicket.customerName || 'Pelanggan'} (Pelanggan)
                      </span>
                      {!ticketClosed && (
                        <button
                          type="button"
                          onClick={handleClearSignature}
                          className="mj-btn-installer-neutral mj-btn-xs gap-1 px-2.5 py-1 text-[11px] cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3 text-[#9B2C37] dark:text-[#ba1a1a]" />
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
                      className="mt-0.5 w-4 h-4 rounded accent-[#6657C8] dark:accent-[#7135b5] cursor-pointer"
                    />
                    <span className="text-xs text-[#52647A] dark:text-[#C4B5D6] leading-snug">
                      Pelanggan telah menguji koneksi, menerima perangkat dalam kondisi baik, dan menyetujui Berita Acara Digital.
                    </span>
                  </label>

                  {!ticketClosed && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 p-3 bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
                      <div className="flex items-center gap-2 min-w-0">
                        <HardDriveDownload className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                        <span className="text-xs text-[#52647A] dark:text-[#C4B5D6] truncate">
                          Draft lokal (<strong className="font-mono text-[#5145A6] dark:text-[#DAB9FF]">{activeTicket.woNumber}</strong>)
                          {draftSavedAt ? ` · ${formatJakartaTimeOnly(draftSavedAt)} WIB` : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={isSubmittingReport}
                        onClick={() => persistDraftToDevice(true)}
                        className="mj-btn-installer-neutral mj-btn-compact px-3 py-1.5 text-xs cursor-pointer shrink-0"
                      >
                        Simpan Draft Lokal
                      </button>
                    </div>
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </main>

      {/* ============================================================== */}
      {/* FLOATING LIVECHAT BUTTON (ABOVE STICKY FOOTER)                 */}
      {/* ============================================================== */}
      <div className="absolute right-4 sm:right-6 bottom-[112px] sm:bottom-[116px] z-30 pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            setShowLiveChatModal(true);
            setIsChatActive(true);
          }}
          data-testid="floating-livechat-btn"
          aria-label="Buka LiveChat WO"
          className="mj-btn-installer-secondary min-h-[46px] px-4 py-2 rounded-full shadow-xl gap-2 text-xs font-bold cursor-pointer relative"
        >
          <MessageSquare className="w-4 h-4 shrink-0" />
          <span>LiveChat</span>
          {unreadChatCount > 0 && (
            <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-[#D45B66] dark:bg-rose-600 text-white font-mono text-[10px] font-extrabold flex items-center justify-center tabular-nums">
              {unreadChatCount > 99 ? '99+' : unreadChatCount}
            </span>
          )}
        </button>
      </div>

      {/* ============================================================== */}
      {/* MORAJAWS STICKY FOOTER ACTION BAR                              */}
      {/* ============================================================== */}
      {currentUser.role !== 'leader' && (
        <footer className="bg-[#FFFFFF]/95 dark:bg-[#1E1238] backdrop-blur-md px-3.5 sm:px-6 pt-2.5 pb-safe border-t border-[#DDE6F0] dark:border-[#35105E] shadow-[0_-4px_16px_rgba(38,54,74,0.06)] dark:shadow-[0_-4px_16px_rgba(31,22,56,0.06)] shrink-0 z-20">
          <div className="max-w-5xl mx-auto space-y-2">
            {/* Progress Meta Row */}
            <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] font-mono">
              <span className="text-[#52647A] dark:text-[#C4B5D6] tabular-nums">
                Foto Wajib:{' '}
                <strong
                  className={
                    isMandatoryEvidenceReady
                      ? 'text-[#218A63] dark:text-emerald-400'
                      : 'text-[#9B2C37] dark:text-rose-300'
                  }
                >
                  {mandatoryPhotoCount}/3
                </strong>{' '}
                <span className="text-[#8492A5] dark:text-[#A79BC0]">(Total {verifiedUploadedPhotoCount}/{totalPhotoSlots})</span>
              </span>

              {ticketClosed ? (
                <span className="text-[#218A63] dark:text-emerald-400 font-bold inline-flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" />
                  <span>Terverifikasi Dispatch</span>
                </span>
              ) : requiresProgressCheckIn ? (
                <span className="text-[#9D661F] dark:text-amber-300 font-bold inline-flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5" />
                  <span>Lakukan CHECK IN Dahulu</span>
                </span>
              ) : !isMandatoryEvidenceReady ? (
                <span className="text-[#9B2C37] dark:text-rose-300 font-bold inline-flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5" />
                  <span>Unggah Foto Wajib ({mandatoryPhotoCount}/3)</span>
                </span>
              ) : !isCheckoutFormReady ? (
                <span className="text-[#5145A6] dark:text-[#DAB9FF] font-bold inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Pilih COMPLETED atau UNSUCCESS</span>
                </span>
              ) : (
                <span className="text-[#218A63] dark:text-emerald-400 font-bold inline-flex items-center gap-1">
                  <BadgeCheck className="w-3.5 h-3.5" />
                  <span>Siap Kirim Report</span>
                </span>
              )}
            </div>

            {/* Action Buttons Row */}
            <div className="flex items-center gap-2 relative">
              {ticketClosed ? (
                <button
                  type="button"
                  disabled
                  className="mj-btn-installer-neutral min-h-[48px] flex-1 px-4 text-sm font-bold gap-2 opacity-60 cursor-not-allowed"
                >
                  <Lock className="w-4 h-4 shrink-0" />
                  <span>WO Selesai (Terkunci)</span>
                </button>
              ) : requiresProgressCheckIn ? (
                <button
                  type="button"
                  onClick={handleTriggerCheckIn}
                  data-testid="footer-checkin-btn"
                  className="mj-btn-installer-primary min-h-[48px] flex-1 px-4 text-sm font-bold gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  <span>CHECK IN</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isSubmittingReport}
                    onClick={() => setShowBarcodeScannerModal(true)}
                    aria-label="Scan Barcode SN ONT / Perangkat Wi-Fi"
                    title="Scan Barcode / QR SN ONT & Perangkat Wi-Fi"
                    className="mj-btn-icon-3d-installer h-12 w-12 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    <QrCode className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    disabled={isSubmittingReport || isAnySlotUploading}
                    onClick={() => setShowCompletedModal(true)}
                    data-testid="footer-completed-btn"
                    className={`mj-btn-installer-success min-h-[48px] flex-1 px-3 sm:px-4 text-xs sm:text-sm font-bold gap-1.5 cursor-pointer disabled:opacity-50 ${
                      isSubmittingReport ? 'mj-btn-loading' : ''
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      {canonicalApproval === 'REVISION' ? 'COMPLETED (REVISI)' : 'COMPLETED'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmittingReport || isAnySlotUploading}
                    onClick={() => setShowUnsuccessModal(true)}
                    data-testid="footer-unsuccess-btn"
                    className={`mj-btn-installer-danger min-h-[48px] flex-1 px-3 sm:px-4 text-xs sm:text-sm font-bold gap-1.5 cursor-pointer disabled:opacity-50 ${
                      isSubmittingReport ? 'mj-btn-loading' : ''
                    }`}
                  >
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate">UNSUCCESS</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </footer>
      )}

      {/* ============================================================== */}
      {/* QC CONFIRMATION BOTTOM SHEET MODAL                             */}
      {/* ============================================================== */}
      {showQcConfirmSheet &&
        (() => {
          const qcSheet = (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="qc-confirm-sheet-title"
              style={{
                zIndex: qcLayerZ,
                ...(qcViewport.keyboardInset > 0 ? { paddingBottom: `${qcViewport.keyboardInset}px` } : {})
              }}
              className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#26364A]/40 dark:bg-slate-900/50 backdrop-blur-[2px] animate-in fade-in duration-150"
            >
              <div className="absolute inset-0" onClick={() => setShowQcConfirmSheet(false)} />

              <div
                ref={qcSheetRef}
                style={
                  qcViewport.isKeyboardOpen
                    ? { maxHeight: `${Math.max(280, qcViewport.viewportHeight - 12)}px` }
                    : undefined
                }
                className="mj-sheet-enter relative z-10 w-full sm:max-w-lg bg-[#FFFFFF] dark:bg-[#1E1238] text-[#26364A] dark:text-[#f5eeff] rounded-t-[1.5rem] sm:rounded-2xl border border-[#DDE6F0] dark:border-[#35105E] shadow-2xl max-h-[92dvh] flex flex-col overflow-hidden"
              >
            <div className="flex justify-center pt-2.5 pb-1 sm:hidden shrink-0">
              <div className="w-10 h-1.5 rounded-full bg-[#CBD5E1] dark:bg-[#4B386B]" />
            </div>

            <div className="px-5 pt-3 pb-3.5 border-b border-[#DDE6F0] dark:border-[#35105E] bg-[#F8FAFD] dark:bg-[#160D29] flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[#EAE8FF] dark:bg-[#2A194B] border border-[#DCE3F2] dark:border-[#4B386B] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#2E7D8B] dark:text-[#DAB9FF]">
                      VALIDASI AKHIR QC &amp; CHECK-OUT
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2A194B] font-mono text-[10px] font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                      #{activeTicket.woNumber}
                    </span>
                  </div>
                  <h3
                    id="qc-confirm-sheet-title"
                    className="font-display font-bold text-base text-[#26364A] dark:text-[#f5eeff] leading-snug mt-0.5 truncate"
                  >
                    Konfirmasi Penyelesaian WO
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQcConfirmSheet(false)}
                className="mj-btn-icon-3d-installer min-w-[44px] min-h-[44px] sm:w-9 sm:h-9 cursor-pointer shrink-0"
                aria-label="Tutup Konfirmasi QC"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
              {/* Telemetry Summary */}
              <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-mono font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Ringkasan Teknis</span>
                  </span>
                  <span className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold border ${opmStatus.badgeCls}`}>
                    {opmStatus.label}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-lg bg-[#FFFFFF] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] p-3">
                    <div className="text-[11px] text-[#8492A5] dark:text-[#A79BC0]">Rx Optical Power</div>
                    <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
                      <span
                        className={`text-lg font-bold leading-none ${
                          opmStatus.isOutOfSpec ? 'text-[#9B2C37] dark:text-rose-300' : 'text-[#26364A] dark:text-[#f5eeff]'
                        }`}
                      >
                        {opmDbm.trim() || '—'}
                      </span>
                      {opmDbm.trim() && <span className="text-xs text-[#8492A5] dark:text-[#A79BC0]">dBm</span>}
                    </div>
                  </div>

                  <div className="rounded-lg bg-[#FFFFFF] dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E] p-3">
                    <div className="text-[11px] text-[#8492A5] dark:text-[#A79BC0]">Dropcore &amp; FAT</div>
                    <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
                      <span className="text-lg font-bold text-[#26364A] dark:text-[#f5eeff] leading-none">
                        {dropcoreLength.trim() || '—'}
                      </span>
                      {dropcoreLength.trim() && <span className="text-xs text-[#8492A5] dark:text-[#A79BC0]">m</span>}
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-[#5145A6] dark:text-[#DAB9FF] truncate">
                      FAT {activeTicket.fatCode || '-'}{fatPort ? ` • #${fatPort}` : ''}
                    </div>
                  </div>
                </div>
              </div>

              {/* Uploaded Photo Proof Thumbnails */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-bold text-sm text-[#26364A] dark:text-[#f5eeff]">
                    Bukti Foto Fisik
                  </h4>
                  <span className="font-mono text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                    Wajib {mandatoryPhotoCount}/3 · {verifiedUploadedPhotoCount}/{totalPhotoSlots} Terverifikasi
                  </span>
                </div>

                {verifiedUploadedPhotoCount > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {verifiedUploadedSlotsList.map(slot => (
                      <button
                        key={slot.slotKey}
                        type="button"
                        onClick={() => setLightboxState({ url: slot.url })}
                        className="relative h-24 rounded-lg overflow-hidden border border-[#DDE6F0] dark:border-[#35105E] bg-[#EDF3F8] dark:bg-[#160D29] cursor-pointer text-left"
                      >
                        <img
                          src={getSafePreviewUrl(slot.url)}
                          alt={slot.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-[#FFFFFF]/95 dark:bg-[#160D29]/95 border-t border-[#DDE6F0] dark:border-[#35105E] px-2 py-1 flex items-center gap-1 text-[#26364A] dark:text-[#f5eeff] text-[10px] font-mono font-semibold">
                          <CheckCircle2 className="w-3 h-3 text-[#218A63] dark:text-emerald-400 shrink-0" />
                          <span className="truncate">{slot.title}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg border border-dashed border-[#CBD5E1] dark:border-[#4B386B] bg-[#F8FAFD] dark:bg-[#160D29] text-center space-y-2">
                    <p className="text-xs text-[#52647A] dark:text-[#C4B5D6]">
                      Belum ada foto bukti SOP yang tersimpan di server. Unggah 3 foto wajib sebelum Check-Out.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowQcConfirmSheet(false)}
                      className="mj-btn-installer-primary mj-btn-compact px-3 py-1.5 text-[11px] cursor-pointer"
                    >
                      Unggah Foto Bukti Sekarang
                    </button>
                  </div>
                )}
              </div>

              {/* SOP Verification Checklist */}
              <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-3.5 space-y-2">
                <div className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                  Lembar Verifikasi Kualitas (SOP)
                </div>
                {[
                  { key: 'dropcoreNeat' as const, label: 'Kabel dropcore terpasang rapi, aman & klem kencang' },
                  { key: 'opmClean' as const, label: 'Konektor bersih & redaman OPM sesuai standar SOP' },
                  { key: 'customerTested' as const, label: 'Pelanggan telah uji koneksi & menyetujui Berita Acara' }
                ].map(item => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 text-xs text-[#26364A] dark:text-[#f5eeff] cursor-pointer select-none py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={sopChecks[item.key]}
                      onChange={e =>
                        setSopChecks(prev => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 rounded accent-[#6657C8] dark:accent-[#7135b5] cursor-pointer"
                    />
                    <span className="leading-snug">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] bg-[#F8FAFD] dark:bg-[#160D29] border-t border-[#DDE6F0] dark:border-[#35105E] space-y-2 shrink-0">
              <button
                type="button"
                disabled={
                  isSubmittingReport ||
                  isAnySlotUploading ||
                  !isMandatoryEvidenceReady ||
                  !sopChecks.dropcoreNeat ||
                  !sopChecks.opmClean ||
                  !sopChecks.customerTested
                }
                onClick={handleSaveReport}
                className={`mj-btn-installer-primary min-h-[44px] w-full py-3 px-4 text-sm gap-2 cursor-pointer ${
                  isSubmittingReport ? 'mj-btn-loading' : ''
                }`}
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
                className="mj-btn-installer-neutral mj-btn-compact min-h-[44px] w-full py-2.5 px-4 text-xs cursor-pointer"
              >
                Periksa Ulang / Kembali
              </button>
            </div>
          </div>
        </div>
          );
          return typeof document !== 'undefined' ? createPortal(qcSheet, document.body) : qcSheet;
        })()}

      {/* ============================================================== */}
      {/* STATUS WO COMPLETED MODAL                                      */}
      {/* ============================================================== */}
      <CompletedStatusModal
        isOpen={showCompletedModal}
        ticket={activeTicket}
        hierarchicalStatuses={hierarchicalStatuses}
        reportStatus={reportStatus}
        reportStatusId={reportStatusId}
        reasonReport={reasonReport}
        reasonReportId={reasonReportId}
        remarksReport={remarksReport}
        isMandatoryEvidenceReady={isMandatoryEvidenceReady}
        mandatoryPhotoCount={mandatoryPhotoCount}
        isAnySlotUploading={isAnySlotUploading}
        isSubmittingReport={isSubmittingReport}
        onSelectStatusAndReason={handleSelectCompletedStatusAndReason}
        onChangeRemarks={val => {
          setRemarksReport(val);
          if (reportError) setReportError(null);
        }}
        onGoToPhotos={() => {
          if (photoAccordionRef.current) photoAccordionRef.current.open = true;
          photoAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onConfirmSave={() => {
          setShowCompletedModal(false);
          handleOpenQcSheet();
        }}
        onClose={() => setShowCompletedModal(false)}
      />

      {/* ============================================================== */}
      {/* STATUS WO UNSUCCESS MODAL                                      */}
      {/* ============================================================== */}
      <UnsuccessStatusModal
        isOpen={showUnsuccessModal}
        ticket={activeTicket}
        hierarchicalStatuses={hierarchicalStatuses}
        remarksReport={remarksReport}
        isMandatoryEvidenceReady={isMandatoryEvidenceReady}
        mandatoryPhotoCount={mandatoryPhotoCount}
        isAnySlotUploading={isAnySlotUploading}
        isSubmittingReport={isSubmittingReport}
        onChangeRemarks={val => {
          setRemarksReport(val);
          if (reportError) setReportError(null);
        }}
        onGoToPhotos={() => {
          if (photoAccordionRef.current) photoAccordionRef.current.open = true;
          photoAccordionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        onSelectKendalaLapangan={() => {
          setShowUnsuccessModal(false);
          setShowKendalaModal(true);
        }}
        onSubmitUnsuccessReport={handleSaveUnsuccessReport}
        onClose={() => setShowUnsuccessModal(false)}
      />

      {/* ============================================================== */}
      {/* FLOATING LIVECHAT MODAL                                        */}
      {/* ============================================================== */}
      <FloatingLiveChatModal
        isOpen={showLiveChatModal}
        onClose={() => {
          setShowLiveChatModal(false);
          setIsChatActive(false);
        }}
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
        onChatInputChange={handleChatInputChange}
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

      {/* ============================================================== */}
      {/* KENDALA / RESCHEDULE ESCALATION MODAL (MANDATORY PHOTO+DESC)   */}
      {/* ============================================================== */}
      <KendalaReportModal
        isOpen={showKendalaModal}
        ticket={activeTicket}
        onClose={() => setShowKendalaModal(false)}
      />

      {/* ============================================================== */}
      {/* SUCCESS ALERT MODAL (MORAJAWS LIGHT & DARK)                    */}
      {/* ============================================================== */}
      {showSuccessAlert &&
        (() => {
          const successAlert = (
            <div
              role="dialog"
              aria-modal="true"
              style={{ zIndex: successAlertLayerZ }}
              className="fixed inset-0 flex items-center justify-center p-3 sm:p-4 bg-[#26364A]/40 dark:bg-slate-900/50 backdrop-blur-[2px] animate-in fade-in duration-200"
            >
          <div className="w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden bg-[#FFFFFF] dark:bg-[#1E1238] rounded-2xl border border-[#DDE6F0] dark:border-[#35105E] shadow-2xl text-center">
            <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6 space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#E4F5EC] dark:bg-emerald-950/50 border border-[#B7E4CC] dark:border-emerald-700/60 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-[#218A63] dark:text-emerald-400" />
              </div>

              <div>
                <h3 className="text-lg font-bold text-[#26364A] dark:text-[#f5eeff] uppercase tracking-tight">
                  Report &amp; Check-Out Tersimpan
                </h3>
                <p className="text-xs text-[#52647A] dark:text-[#C4B5D6] mt-1 leading-relaxed">
                  Laporan berhasil dikirim ke Dispatch dengan status{' '}
                  <strong className="text-[#5145A6] dark:text-[#DAB9FF]">BUTUH APPROVAL</strong>.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-left text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#8492A5] dark:text-[#A79BC0]">No. Work Order:</span>
                  <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF]">{activeTicket.woNumber}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#8492A5] dark:text-[#A79BC0]">Status WO:</span>
                  <span className="font-semibold text-[#26364A] dark:text-[#f5eeff]">
                    {savedReportSnapshot?.status || reportStatus}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#8492A5] dark:text-[#A79BC0]">Reason WO:</span>
                  <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] truncate max-w-[190px]">
                    {savedReportSnapshot?.reason || reasonReport}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-[#DDE6F0] dark:border-[#35105E]">
                  <span className="text-[#8492A5] dark:text-[#A79BC0]">Bukti Foto Fisik:</span>
                  <span className="font-mono font-bold text-[#218A63] dark:text-emerald-400">
                    {verifiedUploadedPhotoCount} Terunggah (Total {uploadedPhotoCount}/{totalPhotoSlots})
                  </span>
                </div>
              </div>
            </div>

            <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 shrink-0">
              <button
                type="button"
                disabled={isRedirecting}
                onClick={handleConfirmRedirect}
                className={`mj-btn-installer-primary min-h-[44px] w-full py-3 px-5 text-xs sm:text-sm gap-2 cursor-pointer ${
                  isRedirecting ? 'mj-btn-loading' : ''
                }`}
              >
                <ArrowRight className="w-4 h-4" />
                <span>
                  {isRedirecting ? 'Mengalihkan...' : 'Kembali ke Daftar WO'}
                </span>
              </button>
            </div>
          </div>
        </div>
          );
          return typeof document !== 'undefined' ? createPortal(successAlert, document.body) : successAlert;
        })()}

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

      {/* Barcode / QR Scanner Modal for ONT & Wi-Fi Device SN */}
      <BarcodeScannerModal
        isOpen={showBarcodeScannerModal}
        onClose={() => {
          setShowBarcodeScannerModal(false);
          setBarcodeScannerSlot(null);
        }}
        title={
          barcodeScannerSlot
            ? 'Scan Barcode SN & MAC ONT (Slot 06)'
            : 'Scan Barcode SN ONT / Perangkat Wi-Fi'
        }
        subtitle={
          barcodeScannerSlot
            ? 'Arahkan kamera barcode ke stiker SN & MAC ONT — otomatis mengisi SN dan foto bukti'
            : 'Arahkan kamera ke stiker barcode atau QR Code Serial Number perangkat'
        }
        woNumber={activeTicket.woNumber}
        initialSerialNumber={ontSerialNumber}
        onConfirmSerialNumber={handleConfirmBarcodeSn}
      />

      {/* Photo Lightbox Modal */}
      <PhotoLightboxModal
        imageUrl={lightboxState?.url || null}
        matchedSlot={lightboxMatchedSlot}
        matchedSlotDef={lightboxMatchedSlotDef}
        ticketClosed={ticketClosed}
        onClose={() => setLightboxState(null)}
        onRetake={slotDef => openCameraForSlot(slotDef)}
        onDelete={slotDef => handleDeletePhotoSlot(slotDef)}
      />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(fullviewContent, document.body) : fullviewContent;
};
