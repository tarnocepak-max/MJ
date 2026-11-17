import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Ticket,
  ProgressReportEntry,
  ChatAttachment,
  TechnicalPhotoSlot
} from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { StatusInstallerBadge, StatusApprovalBadge, StatusBadge } from '../common/Badge';
import {
  isTicketClosed,
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus
} from '../../services/woLifecycleService';
import { buildWhatsAppClickToChatUrl } from '../../services/whatsappService';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import { formatJakartaTimeOnly, getTicketWorkStatus } from '../../services/workSessionService';
import { MessageStatusReceipt } from '../chat/MessageStatusReceipt';
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
  Send,
  Camera,
  Maximize2,
  FileText,
  MessageCircle,
  History,
  Paperclip,
  AlertCircle,
  X,
  Shield,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Tag,
  Play,
  Lock,
  LockOpen,
  GitBranch,
  QrCode,
  Cable,
  PenTool,
  RefreshCw,
  HardDriveDownload,
  Timer,
  AlertTriangle,
  User,
  Wrench,
  Trash2,
  Package,
  ShieldAlert,
  SlidersHorizontal
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useAnimation } from '../../context/AnimationContext';
import { useMoraJawsSound } from '../../context/SoundContext';
import { TactileConfirmModal, EscalationReasonOption } from '../common/TactileConfirmModal';

interface InstallerTicketFullviewProps {
  ticket: Ticket;
  onBack: () => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
}

type PhotoSlotKey = TechnicalPhotoSlot['slotKey'];

interface PhotoSlotDefinition {
  slotKey: PhotoSlotKey;
  title: string;
  defaultTag: string;
  verifiedTag: string;
  emptyHint: string;
}

const PHOTO_SLOT_DEFINITIONS: PhotoSlotDefinition[] = [
  {
    slotKey: 'opm',
    title: '1. Redaman OPM',
    defaultTag: 'OPM',
    verifiedTag: 'EXIF OK',
    emptyHint: 'Foto layar Optical Power Meter di roset pelanggan'
  },
  {
    slotKey: 'barcode_sn',
    title: '2. Barcode & MAC',
    defaultTag: 'SN ONT',
    verifiedTag: 'MATCH',
    emptyHint: 'Foto stiker Serial Number & MAC Address ONT'
  },
  {
    slotKey: 'fat_pole',
    title: '3. FAT & Port Lapangan',
    defaultTag: 'FAT / Tiang',
    verifiedTag: 'GPS OK',
    emptyHint: 'Foto port aktif & label kotak FAT di tiang'
  },
  {
    slotKey: 'customer_install',
    title: '4. Instalasi Pelanggan',
    defaultTag: 'Lokasi ONT',
    verifiedTag: 'VALID',
    emptyHint: 'Foto perangkat ONT terpasang & lampu indikator menyala'
  }
];

function formatBytesToLabel(bytes?: number): string {
  if (!bytes || bytes <= 0) return 'Tersimpan';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hrs, mins, secs].map(v => String(v).padStart(2, '0')).join(':');
}

function compressImageToDataUrl(file: File, maxDim = 1280, quality = 0.78): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const src = String(reader.result || '');
      const img = new Image();
      img.onerror = () => resolve(src);
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          const scale = Math.min(1, maxDim / Math.max(width, height, 1));
          const targetW = Math.max(1, Math.round(width * scale));
          const targetH = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(src);
            return;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed || src);
        } catch {
          resolve(src);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

function buildInitialPhotoSlots(ticket: Ticket): Record<PhotoSlotKey, TechnicalPhotoSlot | null> {
  const map: Record<PhotoSlotKey, TechnicalPhotoSlot | null> = {
    opm: null,
    barcode_sn: null,
    fat_pole: null,
    customer_install: null
  };

  const existingSlots = ticket.technicalReport?.photoSlots;
  if (Array.isArray(existingSlots)) {
    existingSlots.forEach(slot => {
      if (slot && slot.url && slot.slotKey in map) {
        map[slot.slotKey] = slot;
      }
    });
  }

  const legacyPhotos = Array.isArray(ticket.technicalReport?.photos) ? ticket.technicalReport!.photos : [];
  const fallbacks = [
    ticket.technicalReport?.photoAfterUrl || legacyPhotos[0],
    legacyPhotos[1],
    ticket.technicalReport?.photoBeforeUrl || legacyPhotos[2],
    legacyPhotos[3]
  ];

  PHOTO_SLOT_DEFINITIONS.forEach((def, idx) => {
    if (!map[def.slotKey] && fallbacks[idx]) {
      map[def.slotKey] = {
        slotKey: def.slotKey,
        title: def.title,
        url: fallbacks[idx]!,
        capturedAt: ticket.technicalReport?.submittedAt
          ? formatJakartaTimeOnly(ticket.technicalReport.submittedAt)
          : undefined,
        statusTag: def.verifiedTag
      };
    }
  });

  return map;
}

export const InstallerTicketFullview: React.FC<InstallerTicketFullviewProps> = ({
  ticket: initialTicket,
  onBack,
  onOpenWhatsApp
}) => {
  const {
    tickets,
    updateTicketStatus,
    startWorkOnTicket,
    saveProgressReport,
    currentUser,
    getMessagesForTicket,
    refreshMessagesForTicket,
    sendTicketMessage,
    markTicketMessagesAsRead,
    getTicketUnreadCount,
    hierarchicalStatuses,
    chatCategories,
    setTicketChatCategory
  } = useApp();
  const { toast } = useToast();
  const { showGlobalError, startLoading, stopLoading } = useAnimation();
  const { playReportSavedSound, playErrorSound } = useMoraJawsSound();

  // Keep ticket state fresh from context whenever tickets update
  const activeTicket = useMemo(() => {
    return tickets.find(t => t.id === initialTicket.id) || initialTicket;
  }, [tickets, initialTicket]);

  const [serverProgressTriggerByTicket, setServerProgressTriggerByTicket] = useState<Record<string, boolean>>({});
  const triggerKey = `${activeTicket.id}::${currentUser?.id || ''}`;
  const draftStorageKey = `mj_checkout_draft_${activeTicket.id}`;

  const workSession = useMemo(() => getTicketWorkStatus(activeTicket), [activeTicket]);
  const unreadChatCount = getTicketUnreadCount(activeTicket.id);
  const [copiedAddress, setCopiedAddress] = useState(false);

  // Success Confirmation Alert Modal & Pre-submit QC Bottom Sheet State
  const [showQcConfirmSheet, setShowQcConfirmSheet] = useState(false);
  const [sopChecks, setSopChecks] = useState({
    dropcoreNeat: true,
    opmClean: true,
    customerTested: true
  });
  const [showKendalaModal, setShowKendalaModal] = useState(false);
  const [isSubmittingKendala, setIsSubmittingKendala] = useState(false);
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
    return latestReport?.rootCause || activeTicket.rootcauseLabel || activeTicket.technicalReport?.rootCause || '';
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
  // TELEMETRY, 4-POINT PHOTO EVIDENCE & CUSTOMER SIGN-OFF STATE
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

  const [photoSlots, setPhotoSlots] = useState<Record<PhotoSlotKey, TechnicalPhotoSlot | null>>(() =>
    buildInitialPhotoSlots(activeTicket)
  );
  const [uploadingSlot, setUploadingSlot] = useState<PhotoSlotKey | null>(null);
  const photoInputRefs = useRef<Record<PhotoSlotKey, HTMLInputElement | null>>({
    opm: null,
    barcode_sn: null,
    fat_pole: null,
    customer_install: null
  });

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

  // Restore local draft when switching tickets (only when ticket is still editable)
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
          setPhotoSlots(prev => ({ ...prev, ...draft.photoSlots }));
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
          toast.warning('Penyimpanan lokal penuh. Kurangi ukuran foto atau kirim langsung saat online.', 'Draft Penuh');
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
      Boolean(reportStatus || reasonReport || rootCause || remarksReport.trim() || opmDbm || ontSerialNumber || dropcoreLength || customerSignatureUrl) ||
      Object.values(photoSlots).some(Boolean);
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
      rm => (rm.text || rm.name) === newRootcauseText || rm.name === newRootcauseText || rm.id === newRootcauseText
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
        label: 'MENUNGGU UKUR',
        badgeCls: 'bg-[#F4EAFF] text-[#431599] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#D8B4FE] dark:border-[#5B35B1]',
        isOutOfSpec: false
      };
    }
    if (opmNumeric <= -15 && opmNumeric >= -22) {
      return {
        label: 'PASS (OPTIMAL)',
        badgeCls: 'bg-emerald-100 text-[#16A36A] border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700',
        isOutOfSpec: false
      };
    }
    if (opmNumeric > -24 && opmNumeric < -8) {
      return {
        label: 'PASS (SOP OK)',
        badgeCls: 'bg-teal-100 text-teal-700 border-teal-300 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-700',
        isOutOfSpec: false
      };
    }
    return {
      label: 'OUT OF SPEC (SOP)',
      badgeCls: 'bg-rose-100 text-[#BA1A1A] border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-700',
      isOutOfSpec: true
    };
  }, [opmNumeric]);

  // -------------------------------------------------------------
  // 4-POINT SOP PHOTO HANDLERS
  // -------------------------------------------------------------
  const uploadedPhotoSlotsList = useMemo(() => {
    return PHOTO_SLOT_DEFINITIONS.map(def => photoSlots[def.slotKey]).filter(
      (s): s is TechnicalPhotoSlot => Boolean(s && s.url)
    );
  }, [photoSlots]);

  const handlePhotoUploadForSlot = async (slotDef: PhotoSlotDefinition, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('File harus berupa gambar (JPG, PNG, atau WebP).', 'Format Tidak Valid');
      return;
    }

    setUploadingSlot(slotDef.slotKey);
    try {
      const compressedUrl = await compressImageToDataUrl(file);
      const capturedAt = formatJakartaTimeOnly(new Date().toISOString());
      const badgeValue =
        slotDef.slotKey === 'opm'
          ? opmDbm
            ? `${opmDbm} dBm`
            : slotDef.defaultTag
          : slotDef.slotKey === 'barcode_sn'
          ? ontSerialNumber
            ? ontSerialNumber.slice(0, 10)
            : slotDef.defaultTag
          : slotDef.slotKey === 'fat_pole'
          ? activeTicket.fatCode || slotDef.defaultTag
          : activeTicket.clusterName || slotDef.defaultTag;

      setPhotoSlots(prev => ({
        ...prev,
        [slotDef.slotKey]: {
          slotKey: slotDef.slotKey,
          title: slotDef.title,
          url: compressedUrl,
          fileName: file.name,
          fileSizeBytes: file.size,
          capturedAt,
          badgeText: badgeValue,
          statusTag: slotDef.verifiedTag
        }
      }));
      toast.success(`Foto "${slotDef.title}" berhasil dilampirkan.`);
    } catch {
      toast.error(`Gagal memproses foto "${slotDef.title}".`, 'Upload Foto Gagal');
    } finally {
      setUploadingSlot(null);
      const inputEl = photoInputRefs.current[slotDef.slotKey];
      if (inputEl) inputEl.value = '';
    }
  };

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
    ctx.strokeStyle = document.documentElement.classList.contains('dark') ? '#E9D5FF' : '#35105E';
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
  // LIVE CHAT ROOM STATE & HANDLERS (MUST BE DEFINED BEFORE SUBMIT)
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
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [isChatActive, setIsChatActive] = useState(false);
  const [showHistorySection, setShowHistorySection] = useState(true);

  const chatFileInputRef = useRef<HTMLInputElement>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatSectionRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

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
    (hasPersistedProgressFromCurrentTechnician || Boolean(serverProgressTriggerByTicket[triggerKey]));

  const requiresProgressCheckIn =
    currentUser.role === 'installer' && !hasValidProgressFromCurrentTechnician;

  const validatedCheckInTime = useMemo(() => {
    const iso = persistedProgressMessage?.timestamp || activeTicket.checkInAt;
    if (!iso) return '-';
    return formatJakartaTimeOnly(iso);
  }, [persistedProgressMessage?.timestamp, activeTicket.checkInAt]);

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
      activeChatCategories.find(c => String(c.name || '').trim().toUpperCase() === 'PROGRESS')?.name || 'PROGRESS';
    setChatCategory(progressCat);
    await setTicketChatCategory(activeTicket.id, progressCat);
    setIsChatActive(true);
    chatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      chatInputRef.current?.focus();
    }, 200);
    toast.info('Kategori PROGRESS dipilih. Kirim pesan untuk mencatat Check-in otomatis.', 'Siap Check-in');
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
  // PRE-SUBMIT VALIDATION -> OPEN QC BOTTOM SHEET -> EXECUTE SAVE
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
        'Check-in belum tercatat! Kirim minimal 1 pesan LiveChat dengan kategori PROGRESS terlebih dahulu sebelum mengirim laporan checkout.';
      setReportError(msg);
      toast.error(msg, 'Check-in Wajib (PROGRESS)');
      handleOpenProgressChatForCheckIn();
      return false;
    }

    if (!reportStatus) {
      setReportError('LEVEL 1: Report Status wajib dipilih.');
      return false;
    }
    if (!reasonReport) {
      setReportError('LEVEL 2: Reason Report wajib dipilih.');
      return false;
    }
    if (!rootCause) {
      setReportError('LEVEL 3: Rootcause Code wajib dipilih.');
      return false;
    }
    if (!remarksReport.trim()) {
      setReportError('Catatan Teknisi & Hasil Commissioning wajib diisi.');
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
      title: 'MENGIRIM LAPORAN CHECKOUT KE DISPATCH...',
      subtitle: 'Menyimpan relasi 3-tingkat, telemetri ONT, foto bukti fisik, dan memicu Check-out ke database'
    });

    try {
      const normalizedOpm = opmDbm.trim()
        ? (opmDbm.trim().toLowerCase().includes('dbm') ? opmDbm.trim() : `${opmDbm.trim()} dBm`)
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
          `Laporan checkout "${reportStatus}" berhasil dikirim ke Dispatch (status: BUTUH APPROVAL).`,
          'LAPORAN TERKIRIM',
          { withSound: true }
        );
      } else {
        playErrorSound();
        const errMsg = res.error || 'Gagal menyimpan laporan ke database.';
        setReportError(errMsg);
        if ((res as any).code === 'CHECK_IN_REQUIRED') {
          toast.error(errMsg, 'Check-in PROGRESS Diperlukan');
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

  // WhatsApp & Maps Helpers
  const waUrlObj = buildWhatsAppClickToChatUrl(
    activeTicket.customerPhone,
    `Halo ${activeTicket.customerName}, saya teknisi ${currentUser.name || 'MoraJaws'} terkait penanganan tiket WO ${activeTicket.woNumber} hari ini.`
  );

  const handleCopyAddress = () => {
    const fullAddr = `${activeTicket.streetName || activeTicket.address || ''}, ${activeTicket.clusterName || ''}, ${activeTicket.area || ''}`.trim();
    if (navigator.clipboard) {
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
    updateTicketStatus(activeTicket.id, undefined, 'En Route', `Teknisi ${currentUser.name} sedang berangkat menuju lokasi.`);
    toast.success('Status diubah menjadi En Route (Otw Lokasi).', 'Otw Lokasi');
    handleOpenMaps();
  };

  const woBadgeLabel = activeTicket.appointmentType || activeTicket.ticketCategory || 'FTTH Install';
  const isSignatureReady = Boolean(customerSignatureUrl) && customerConsentConfirmed;

  return (
    <div className="bg-[#F5F1FF] dark:bg-[#140827] min-h-screen -m-3 sm:-m-5 lg:-m-6 flex flex-col text-[#211A2E] dark:text-[#F5EEFF] transition-colors">
      {/* Main Container matching mobile 3D tactile design & expanding to 12-col enterprise grid on desktop */}
      <div className="flex-1 w-full max-w-7xl mx-auto px-3.5 sm:px-5 lg:px-6 pt-3 pb-28 space-y-3.5">

        {/* ============================================================ */}
        {/* NAVIGATION & STAGE CONTEXT BAR                               */}
        {/* ============================================================ */}
        <div className="flex flex-wrap items-center justify-between gap-2 py-1">
          <div className="flex items-center gap-2">
            {/* 3D Ceramic Back Button */}
            <button
              type="button"
              onClick={onBack}
              className="tactile-btn-secondary inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-[#22123F] text-[#211A2E] dark:text-white border border-[#D8CCF3] dark:border-[#4B386B] font-semibold text-[13px] cursor-pointer min-h-[40px]"
            >
              <ArrowLeft className="w-4 h-4 text-[#431599] dark:text-[#D8B4FE]" />
              <span>Tugas Saya</span>
            </button>

            {/* Quick LiveChat Jump Button (Mobile/Tablet) */}
            <button
              type="button"
              onClick={() => {
                setIsChatActive(true);
                chatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="lg:hidden tactile-btn-secondary inline-flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-white dark:bg-[#22123F] text-[#431599] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#4B386B] font-bold text-[12px] cursor-pointer min-h-[40px]"
              title="Lompat ke LiveChat"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
              {unreadChatCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#DC4C5A] text-white font-mono text-[10px] leading-none">
                  {unreadChatCount}
                </span>
              )}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* Quick Operational Buttons */}
            {!ticketClosed && !activeTicket.workStartedAt && (
              <button
                type="button"
                onClick={async () => {
                  await startWorkOnTicket(activeTicket.id);
                }}
                className="btn-3d-emerald inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Mulai Kerjakan</span>
              </button>
            )}

            {!ticketClosed && (
              <button
                type="button"
                onClick={handleOtwLokasi}
                className="tactile-btn-secondary hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#22123F] text-[#431599] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#4B386B] text-[11px] font-bold cursor-pointer"
                title="Ubah status ke En Route dan buka Google Maps"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Otw Lokasi</span>
              </button>
            )}

            {!ticketClosed && (
              <button
                type="button"
                onClick={() => setShowKendalaModal(true)}
                className="tactile-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#22123F] text-[#BA1A1A] dark:text-rose-300 border border-rose-200 dark:border-rose-500/40 text-[11px] font-bold cursor-pointer"
                title="Laporkan kendala teknis atau minta reschedule"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Kendala</span>
              </button>
            )}

            {/* Tactile Pill: CHECKOUT UNLOCKED / LOCKED */}
            {ticketClosed ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#334155] text-white font-mono text-[11px] font-bold border border-slate-600 shadow-xs">
                <Lock className="w-3.5 h-3.5 text-emerald-300" />
                <span className="tracking-wide">CLOSED (READ-ONLY)</span>
              </div>
            ) : requiresProgressCheckIn ? (
              <button
                type="button"
                onClick={handleOpenProgressChatForCheckIn}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-mono text-[11px] font-bold border border-amber-300 dark:border-amber-700 shadow-xs cursor-pointer hover:bg-amber-100 transition-colors"
                title="Klik untuk membuka LiveChat dengan kategori PROGRESS"
              >
                <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span className="tracking-wide">CHECKOUT LOCKED</span>
              </button>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F4EAFF] dark:bg-[#2E1459] text-[#431599] dark:text-[#D8B4FE] font-mono text-[11px] font-bold border border-[#D8B4FE]/70 dark:border-[#7135B5] shadow-[0_2px_0_rgba(216,180,254,0.5),0_2px_6px_rgba(113,53,181,0.06)]">
                <LockOpen className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
                <span className="tracking-wide">CHECKOUT UNLOCKED</span>
              </div>
            )}
          </div>
        </div>

        {/* ============================================================ */}
        {/* BANNER TIKET WO & STATUS (STITCH HERO CONTEXT CARD)          */}
        {/* ============================================================ */}
        <div className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4 relative overflow-hidden">
          <div className="absolute -right-6 -top-6 w-28 h-28 bg-gradient-to-br from-[#E9D5FF]/50 to-[#D8B4FE]/20 dark:from-[#7135B5]/30 dark:to-transparent rounded-full blur-xl pointer-events-none" />

          <div className="flex items-start justify-between gap-3 mb-2 relative z-10">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-mono text-[15px] sm:text-[16px] font-bold text-[#160D29] dark:text-white tracking-tight">
                  {activeTicket.woNumber}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-[#35105E] text-white font-bold text-[10px] tracking-wider uppercase shadow-[0_1.5px_0_#160D29]">
                  {woBadgeLabel}
                </span>
                <StatusInstallerBadge status={activeTicket.statusWOInstaller} />
                {activeTicket.approvalStatus && activeTicket.approvalStatus !== 'NONE' && (
                  <StatusApprovalBadge status={activeTicket.approvalStatus} />
                )}
              </div>
              <h1 className="font-display font-bold text-[18px] sm:text-[20px] text-[#211A2E] dark:text-white mt-1.5 tracking-tight truncate">
                {activeTicket.customerName || activeTicket.endUserName || 'Pelanggan'}
              </h1>
            </div>

            {/* Live Elapsed Timer + Start Time */}
            <div className="flex flex-col items-end shrink-0">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-[#16A36A] dark:text-emerald-300 font-mono text-[12px] font-bold border border-emerald-200 dark:border-emerald-700 shadow-xs tabular-nums">
                <Timer className="w-3.5 h-3.5" />
                <span>{elapsedClockLabel}</span>
              </span>
              <span className="font-mono text-[10px] text-[#8B8495] dark:text-[#CEC0E8]/75 mt-1 tabular-nums">
                {sessionStartIso
                  ? `Mulai: ${formatJakartaTimeOnly(sessionStartIso)}`
                  : `Slot: ${activeTicket.slotTime || '-'}`}
              </span>
            </div>
          </div>

          {/* Verified LiveChat Progress Banner OR Actionable Check-in Gate */}
          {!requiresProgressCheckIn ? (
            <div className="mt-2.5 p-2.5 rounded-xl bg-[#F9F0FF] dark:bg-[#160D29] border border-[#D8CCF3]/60 dark:border-[#35105E] flex items-center justify-between gap-2 shadow-inner">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 text-[#16A36A] shrink-0" />
                <span className="text-[12px] font-medium text-[#211A2E] dark:text-[#F5EEFF] truncate">
                  LiveChat Tag <span className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE]">#PROGRESS</span> Tervalidasi
                </span>
              </div>
              <span className="font-mono text-[11px] text-[#766B83] dark:text-[#CEC0E8] shrink-0 font-semibold tabular-nums">
                {validatedCheckInTime}
              </span>
            </div>
          ) : (
            <div className="mt-2.5 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-start gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="text-[12px] text-amber-900 dark:text-amber-200">
                  <div className="font-bold">Wajib Check-in LiveChat Kategori #PROGRESS</div>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    Kirim minimal 1 pesan LiveChat dengan kategori <strong>PROGRESS</strong> untuk membuka tombol kirim checkout.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenProgressChatForCheckIn}
                className="btn-3d-amber px-3 py-1.5 rounded-xl text-[11px] font-bold shrink-0 cursor-pointer"
              >
                Buka LiveChat (#PROGRESS)
              </button>
            </div>
          )}

          {/* Dispatch Revision Alert Banner if REVISI */}
          {!ticketClosed && canonicalApproval === 'REVISION' && (
            <div className="mt-2.5 p-3 rounded-xl bg-[#FEF2F2] dark:bg-rose-950/60 border border-[#FCA5A5] dark:border-rose-800 text-[#B91C1C] dark:text-rose-200 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 font-extrabold uppercase tracking-wide">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Revisi Laporan Diminta Dispatch</span>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-[#B91C1C] text-white font-mono font-bold text-[10px]">
                  Kirim Revisi v{(activeTicket.progressReports?.length || 0) + 1}
                </span>
              </div>
              <p className="text-[11.5px] font-semibold text-[#7F1D1D] dark:text-rose-100 leading-relaxed">
                Alasan ({latestReport?.rejectedBy || activeTicket.rejectedBy || 'Dispatch'}): &ldquo;{latestRevisionReason || 'Silakan perbaiki laporan dan kirim ulang.'}&rdquo;
              </p>
            </div>
          )}

          {/* WO CLOSED Read-Only Lock Banner */}
          {ticketClosed && (
            <div className="mt-2.5 p-3 rounded-xl bg-[#334155] text-white border border-[#1E293B] text-xs flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-extrabold uppercase tracking-wide flex items-center gap-2 flex-wrap">
                  <span>Work Order CLOSED (Terkunci Read-Only)</span>
                  <StatusBadge status="APPROVED" variant="approval" />
                </div>
                <p className="text-[11px] text-slate-200">
                  Laporan akhir ({canonicalReport !== 'NONE' ? canonicalReport : activeTicket.statusWOInstaller}) telah disetujui Dispatch{' '}
                  {activeTicket.approvedBy ? `(${activeTicket.approvedBy})` : ''}.
                </p>
              </div>
            </div>
          )}

          {/* Site Quick Specs + Quick Address/WA Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 pt-2.5 border-t border-dashed border-[#D8CCF3] dark:border-[#35105E]">
            <button
              type="button"
              onClick={handleCopyAddress}
              className="flex items-center gap-1.5 text-left text-[#766B83] dark:text-[#CEC0E8] hover:text-[#431599] dark:hover:text-white transition-colors cursor-pointer min-w-0"
              title="Ketuk untuk menyalin alamat pelanggan"
            >
              {copiedAddress ? (
                <Check className="w-4 h-4 text-[#16A36A] shrink-0" />
              ) : (
                <MapPin className="w-4 h-4 text-[#7135B5] dark:text-[#A78BFA] shrink-0" />
              )}
              <span className="text-[11.5px] font-medium truncate">
                {activeTicket.streetName || activeTicket.address || activeTicket.clusterName || 'Alamat belum tercatat'}
              </span>
            </button>

            <div className="flex items-center gap-1.5 text-[#766B83] dark:text-[#CEC0E8] min-w-0">
              <GitBranch className="w-4 h-4 text-[#431599] dark:text-[#A78BFA] shrink-0" />
              <span className="text-[11.5px] font-mono font-bold text-[#160D29] dark:text-white truncate">
                {activeTicket.fatCode || activeTicket.fdtCode || '-'}
                {fatPort || activeTicket.fatPort ? ` #${String(fatPort || activeTicket.fatPort).replace(/^#/, '')}` : ''}
              </span>
            </div>

            <div className="flex items-center justify-start sm:justify-end gap-1.5">
              <button
                type="button"
                onClick={handleOpenMaps}
                className="px-2.5 py-1 rounded-lg bg-[#F5F1FF] dark:bg-[#261942] border border-[#D8CCF3] dark:border-[#4B386B] text-[#431599] dark:text-[#D8B4FE] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer hover:bg-[#EDE4FF]"
              >
                <Navigation className="w-3 h-3" />
                <span>Maps</span>
              </button>
              {activeTicket.customerPhone && (
                <button
                  type="button"
                  onClick={() => {
                    if (waUrlObj.url) {
                      window.open(waUrlObj.url, '_blank', 'noopener,noreferrer');
                    } else {
                      onOpenWhatsApp(activeTicket);
                    }
                  }}
                  className="btn-3d-icon-wa px-2.5 py-1 text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Phone className="w-3 h-3" />
                  <span>WhatsApp</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* MAIN RESPONSIVE GRID: LEFT = 3-TIER CHECKOUT, RIGHT = CHAT   */}
        {/* ============================================================ */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">

          {/* ========================================================== */}
          {/* LEFT COLUMN (7/12 on desktop): STITCH 3-TIER CHECKOUT FLOW */}
          {/* ========================================================== */}
          <form onSubmit={handleOpenQcSheet} className="lg:col-span-7 space-y-3.5">

            {/* Error Alert */}
            {reportError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-[#BA1A1A] dark:text-rose-200 text-xs flex items-center gap-2 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{reportError}</span>
              </div>
            )}

            {/* -------------------------------------------------------- */}
            {/* SECTION 1: 3-TIER CASCADE CHECKOUT                       */}
            {/* -------------------------------------------------------- */}
            <section className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-[#7135B5] to-[#5B35B1] text-white flex items-center justify-center border-t border-white/30 shadow-[0_2px_0_#35105E]">
                    <GitBranch className="w-4 h-4" />
                  </div>
                  <h2 className="font-display font-bold text-[16px] text-[#160D29] dark:text-white">
                    3-Tier Cascade Checkout
                  </h2>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-[#E9D5FF] dark:bg-[#35105E] text-[#35105E] dark:text-[#D8B4FE] font-bold text-[10px] uppercase border border-[#D8CCF3] dark:border-[#5B35B1] shadow-xs">
                  Wajib SOP
                </span>
              </div>

              {/* Visual Flow Tracker (Debossed Well) */}
              <div className="flex items-center justify-between px-3 py-2 bg-[#F5F1FF] dark:bg-[#160D29] rounded-xl mb-3.5 text-[11px] font-mono border border-[#D8CCF3]/70 dark:border-[#35105E] shadow-inner">
                <span className={`font-bold ${reportStatus ? 'text-[#431599] dark:text-[#D8B4FE]' : 'text-[#8B8495]'}`}>
                  L1: Status
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[#7135B5]" />
                <span className={`font-bold ${reasonReport ? 'text-[#431599] dark:text-[#D8B4FE]' : 'text-[#8B8495]'}`}>
                  L2: Reason
                </span>
                <ChevronRight className="w-3.5 h-3.5 text-[#7135B5]" />
                <span className={`font-bold ${rootCause ? 'text-[#431599] dark:text-[#D8B4FE]' : 'text-[#8B8495]'}`}>
                  L3: Rootcause
                </span>
              </div>

              <div className="space-y-3">
                {/* Level 1 */}
                <div>
                  <label className="block font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] mb-1 uppercase tracking-wider">
                    LEVEL 1: REPORT STATUS <span className="text-[#DC4C5A]">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={reportStatus}
                      disabled={ticketClosed || isSubmittingReport}
                      onChange={e => handleReportStatusChange(e.target.value)}
                      className="tactile-debossed-input w-full bg-[#F5F1FF] dark:bg-[#160D29] text-[#160D29] dark:text-white font-semibold text-[13px] rounded-xl py-2.5 pl-3 pr-10 appearance-none focus:outline-none focus:ring-2 focus:ring-[#D8B4FE] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <option value="">-- Pilih Report Status (Level 1) --</option>
                      {availableStatusOptions.map(st => (
                        <option key={st.id} value={st.name}>
                          {st.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-4 h-4 absolute right-3 top-3 text-[#7135B5] dark:text-[#D8B4FE] pointer-events-none" />
                  </div>
                </div>

                {/* Level 2 */}
                <div>
                  <label className="block font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] mb-1 uppercase tracking-wider">
                    LEVEL 2: REASON REPORT <span className="text-[#DC4C5A]">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={reasonReport}
                      disabled={ticketClosed || isSubmittingReport || !reportStatus || availableReasonOptions.length === 0}
                      onChange={e => handleReasonReportChange(e.target.value)}
                      className="tactile-debossed-input w-full bg-[#F5F1FF] dark:bg-[#160D29] text-[#160D29] dark:text-white font-semibold text-[13px] rounded-xl py-2.5 pl-3 pr-10 appearance-none focus:outline-none focus:ring-2 focus:ring-[#D8B4FE] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
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
                    <ChevronDown className="w-4 h-4 absolute right-3 top-3 text-[#7135B5] dark:text-[#D8B4FE] pointer-events-none" />
                  </div>
                </div>

                {/* Level 3 */}
                <div>
                  <label className="block font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] mb-1 uppercase tracking-wider">
                    LEVEL 3: ROOTCAUSE CODE <span className="text-[#DC4C5A]">*</span>
                  </label>
                  <div className="relative">
                    <select
                      value={rootCause}
                      disabled={ticketClosed || isSubmittingReport || !reasonReport || availableRootcauseOptions.length === 0}
                      onChange={e => handleRootcauseChange(e.target.value)}
                      className="tactile-debossed-input w-full bg-[#F5F1FF] dark:bg-[#160D29] text-[#160D29] dark:text-white font-semibold text-[13px] rounded-xl py-2.5 pl-3 pr-10 appearance-none focus:outline-none focus:ring-2 focus:ring-[#D8B4FE] cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
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
                    <ChevronDown className="w-4 h-4 absolute right-3 top-3 text-[#7135B5] dark:text-[#D8B4FE] pointer-events-none" />
                  </div>
                </div>
              </div>
            </section>

            {/* -------------------------------------------------------- */}
            {/* SECTION 2: TELEMETRI & KALIBRASI ONT                     */}
            {/* -------------------------------------------------------- */}
            <section className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-[#7135B5] to-[#35105E] text-white flex items-center justify-center border-t border-white/30 shadow-[0_2px_0_#160D29]">
                    <Radio className="w-4 h-4" />
                  </div>
                  <h2 className="font-display font-bold text-[16px] text-[#160D29] dark:text-white">
                    Telemetri &amp; Kalibrasi ONT
                  </h2>
                </div>
                <span className="font-mono text-[10.5px] text-[#16A36A] dark:text-emerald-300 font-bold flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A36A]" />
                  <span>LIVE SYNC</span>
                </span>
              </div>

              <div className="space-y-3.5">
                {/* OPM Signal Card Taktil */}
                <div className="bg-gradient-to-b from-[#F9F0FF] to-[#F4EEFF] dark:from-[#1A0E2E] dark:to-[#160D29] p-3 rounded-xl border border-[#D8CCF3]/70 dark:border-[#35105E] shadow-xs">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <label
                      htmlFor="opm-input"
                      className="font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] uppercase tracking-wider"
                    >
                      REDAMAN OPM PADA ROSET (dBm)
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
                      className={`tactile-debossed-input w-full bg-white dark:bg-[#140827] font-mono font-bold text-[22px] rounded-xl py-2 pl-3 pr-16 focus:outline-none focus:ring-2 focus:ring-[#431599] tabular-nums disabled:opacity-60 ${
                        opmStatus.isOutOfSpec ? 'text-[#DC4C5A]' : 'text-[#160D29] dark:text-white'
                      }`}
                    />
                    <span className="absolute right-3.5 font-mono text-[13px] font-semibold text-[#8B8495]">
                      dBm
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-[#D8CCF3]/40 dark:border-[#35105E] flex-wrap">
                    <span className="font-mono text-[10px] text-[#8B8495] dark:text-[#CEC0E8]/75">
                      Batas Max SOP: -24.00 dBm
                    </span>
                    <span className="font-mono text-[10px] text-[#16A36A] dark:text-emerald-300 font-bold">
                      Rentang Ideal: -15 s/d -22 dBm
                    </span>
                  </div>
                </div>

                {/* ONT Serial Number + 3D Micro-Key Scanner Helper */}
                <div>
                  <label
                    htmlFor="ont-sn-input"
                    className="block font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] mb-1 uppercase tracking-wider"
                  >
                    NOMOR SERI (SN) ONT / MODEM
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
                        className="tactile-debossed-input w-full bg-[#F5F1FF] dark:bg-[#160D29] text-[#160D29] dark:text-white font-mono font-bold text-[14px] rounded-xl py-2.5 pl-3 pr-9 focus:outline-none focus:ring-2 focus:ring-[#431599] uppercase tracking-wider disabled:opacity-60"
                      />
                      {ontSerialNumber.trim().length >= 6 && (
                        <CheckCircle2 className="w-4 h-4 absolute right-3 top-3 text-[#16A36A]" />
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={ticketClosed}
                      onClick={() => {
                        setShowSnScannerTip(prev => !prev);
                        snInputRef.current?.focus();
                      }}
                      className="tactile-micro-key w-11 h-11 shrink-0 rounded-xl bg-gradient-to-b from-[#7135B5] to-[#5B35B1] text-white flex items-center justify-center border-t border-white/40 cursor-pointer disabled:opacity-50"
                      title="Fokus & Foto Stiker Barcode SN ONT"
                    >
                      <QrCode className="w-5 h-5" />
                    </button>
                  </div>
                  {showSnScannerTip && (
                    <div className="mt-1.5 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#F5F1FF] dark:bg-[#22123F] border border-[#D8CCF3] dark:border-[#4B386B] text-[11px] text-[#431599] dark:text-[#D8B4FE]">
                      <span>Ketik SN manual atau foto stiker barcode pada slot Foto #2 di bawah.</span>
                      <button
                        type="button"
                        onClick={() => photoInputRefs.current.barcode_sn?.click()}
                        className="font-bold underline shrink-0 cursor-pointer"
                      >
                        Ambil Foto SN
                      </button>
                    </div>
                  )}
                  <p className="font-mono text-[11px] text-[#766B83] dark:text-[#CEC0E8] mt-1.5 flex items-center gap-1 font-medium">
                    <Check className="w-3.5 h-3.5 text-[#16A36A]" />
                    <span>
                      {activeTicket.oltCode
                        ? `Terdaftar di OLT ${activeTicket.oltCode}${activeTicket.oltRegistrationStatus ? ` (${activeTicket.oltRegistrationStatus})` : ''}`
                        : `Brand ONT: ${activeTicket.ontBrand || 'GPON ONT'} ${activeTicket.ontModel || ''}`.trim()}
                    </span>
                  </p>
                </div>

                {/* Dropcore Length & Port FAT Grid */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="dropcore-input"
                      className="block font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] mb-1 uppercase tracking-wider"
                    >
                      PANJANG DROPCORE
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
                        className="tactile-debossed-input w-full bg-[#F5F1FF] dark:bg-[#160D29] text-[#160D29] dark:text-white font-mono font-bold text-[14px] rounded-xl py-2.5 pl-3 pr-14 focus:outline-none focus:ring-2 focus:ring-[#431599] tabular-nums disabled:opacity-60"
                      />
                      <span className="absolute right-3 top-2.5 font-mono text-[11px] text-[#8B8495] font-medium">
                        Meter
                      </span>
                    </div>
                    <span className="text-[10px] text-[#8B8495] mt-1 block font-medium">
                      {activeTicket.installationType || 'Pre-connector 1 Core'}
                    </span>
                  </div>

                  <div>
                    <label
                      htmlFor="fat-port-input"
                      className="block font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] mb-1 uppercase tracking-wider"
                    >
                      PORT FAT AKTIF
                    </label>
                    <div className="relative">
                      <input
                        id="fat-port-input"
                        type="text"
                        value={fatPort}
                        disabled={ticketClosed || isSubmittingReport}
                        onChange={e => setFatPort(e.target.value)}
                        placeholder="Port #04"
                        className="tactile-debossed-input w-full bg-[#F4EAFF] dark:bg-[#22123F] text-[#431599] dark:text-[#D8B4FE] font-mono font-bold text-[14px] rounded-xl py-2.5 pl-3 pr-8 focus:outline-none focus:ring-2 focus:ring-[#431599] disabled:opacity-60"
                      />
                      <Cable className="w-4 h-4 absolute right-2.5 top-3 text-[#431599] dark:text-[#A78BFA] pointer-events-none" />
                    </div>
                    <span className="font-mono text-[10px] text-[#8B8495] mt-1 block">
                      {activeTicket.fatRedamanDbm ? `Tiang: ${activeTicket.fatRedamanDbm} dBm` : `FAT: ${activeTicket.fatCode || '-'}`}
                    </span>
                  </div>
                </div>

                {/* Material Terpakai di Lapangan + Quick Chips */}
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label
                      htmlFor="materials-input"
                      className="flex items-center gap-1.5 font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] uppercase tracking-wider"
                    >
                      <Package className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                      <span>MATERIAL TERPAKAI DI LAPANGAN</span>
                    </label>
                    <span className="text-[10px] text-[#8B8495] font-mono">Opsional / Audit</span>
                  </div>
                  <input
                    id="materials-input"
                    ref={materialInputRef}
                    type="text"
                    value={usedMaterials}
                    disabled={ticketClosed || isSubmittingReport}
                    onChange={e => setUsedMaterials(e.target.value)}
                    placeholder="Contoh: Dropcore 85m, 1x ONT ZTE, 2x Fast Connector, 1x Roset"
                    className="tactile-debossed-input w-full bg-[#F5F1FF] dark:bg-[#160D29] text-[#160D29] dark:text-white font-semibold text-[12.5px] rounded-xl py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-[#431599] disabled:opacity-60"
                  />
                  {!ticketClosed && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {['Fast Connector (2x)', 'Roset 1 Port', 'Patchcord SC-UPC', 'Clamp S (2x)'].map(chip => (
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
                          className="px-2 py-0.5 rounded-lg bg-[#F3EAFF] hover:bg-[#E8DDFF] dark:bg-[#261942] dark:hover:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] border border-[#E8DDFF] dark:border-[#4B386B] text-[10.5px] font-bold transition-colors cursor-pointer"
                        >
                          + {chip}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* -------------------------------------------------------- */}
            {/* SECTION 3: BUKTI FOTO FISIK (4 TITIK SOP)                */}
            {/* -------------------------------------------------------- */}
            <section className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-b from-[#35105E] to-[#160D29] text-white flex items-center justify-center border-t border-white/30 shadow-[0_2px_0_#160D29]">
                    <Camera className="w-4 h-4" />
                  </div>
                  <h2 className="font-display font-bold text-[16px] text-[#160D29] dark:text-white">
                    Bukti Foto Fisik (4 Titik SOP)
                  </h2>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-[#E9D5FF] dark:bg-[#35105E] text-[#35105E] dark:text-[#D8B4FE] font-mono text-[11px] font-bold border border-[#D8CCF3] dark:border-[#5B35B1] shadow-xs tabular-nums">
                  {uploadedPhotoSlotsList.length}/4 Terunggah
                </span>
              </div>
              <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] mb-3 leading-tight">
                EXIF Geotag dan stempel waktu otomatis dicatat saat teknisi mengunggah bukti fisik dari perangkat lapangan.
              </p>

              {/* 2x2 Photo Evidence Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {PHOTO_SLOT_DEFINITIONS.map(slotDef => {
                  const slotData = photoSlots[slotDef.slotKey];
                  const isBusy = uploadingSlot === slotDef.slotKey;

                  return (
                    <div
                      key={slotDef.slotKey}
                      className="relative rounded-xl overflow-hidden bg-white dark:bg-[#160D29] flex flex-col border border-[#D8CCF3]/70 dark:border-[#35105E] shadow-[0_2px_0_#CEC3D4,0_4px_8px_rgba(27,18,48,0.04)] dark:shadow-none"
                    >
                      <input
                        ref={el => {
                          photoInputRefs.current[slotDef.slotKey] = el;
                        }}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={ticketClosed}
                        onChange={e => handlePhotoUploadForSlot(slotDef, e)}
                        className="hidden"
                      />

                      <div className="h-28 w-full relative bg-[#F5F1FF] dark:bg-[#140827]">
                        {slotData?.url ? (
                          <>
                            <img
                              src={getSafePreviewUrl(slotData.url)}
                              alt={slotDef.title}
                              onClick={() => setZoomImage(slotData.url)}
                              className="w-full h-full object-cover cursor-pointer"
                            />
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-[#160D29]/85 text-white font-mono text-[9px] font-bold backdrop-blur-xs shadow-xs max-w-[90px] truncate">
                              {slotData.badgeText || slotDef.defaultTag}
                            </span>
                            <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-md bg-[#16A36A] text-white font-bold text-[9px] flex items-center gap-0.5 shadow-xs">
                              <Check className="w-2.5 h-2.5" />
                              <span>{slotData.statusTag || slotDef.verifiedTag}</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setZoomImage(slotData.url)}
                              className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/50 text-white hover:bg-black/70 cursor-pointer"
                              title="Perbesar Foto"
                            >
                              <Maximize2 className="w-3 h-3" />
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={ticketClosed || isBusy}
                            onClick={() => photoInputRefs.current[slotDef.slotKey]?.click()}
                            className="w-full h-full flex flex-col items-center justify-center gap-1 p-2 text-center text-[#766B83] dark:text-[#CEC0E8] hover:bg-[#EDE4FF]/60 dark:hover:bg-[#22123F] transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <Camera className="w-5 h-5 text-[#7135B5] dark:text-[#D8B4FE]" />
                            <span className="text-[10px] font-semibold leading-tight line-clamp-2">
                              {isBusy ? 'Memproses...' : slotDef.emptyHint}
                            </span>
                          </button>
                        )}
                      </div>

                      <div className="p-2 flex flex-col justify-between flex-1 bg-white dark:bg-[#1E1238]">
                        <div>
                          <p className="font-bold text-[11px] text-[#211A2E] dark:text-white line-clamp-1">
                            {slotDef.title}
                          </p>
                          <p className="font-mono text-[9px] text-[#8B8495] dark:text-[#CEC0E8]/75">
                            {slotData?.capturedAt
                              ? `${slotData.capturedAt} • ${formatBytesToLabel(slotData.fileSizeBytes)}`
                              : 'Belum diunggah'}
                          </p>
                        </div>

                        {!ticketClosed && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => photoInputRefs.current[slotDef.slotKey]?.click()}
                            className="tactile-pill-btn mt-2 w-full py-1 px-2 rounded-lg bg-white dark:bg-[#261942] text-[#431599] dark:text-[#D8B4FE] font-bold text-[10px] flex items-center justify-center gap-1 border border-[#D8CCF3] dark:border-[#4B386B] cursor-pointer"
                          >
                            <RefreshCw className={`w-3 h-3 ${isBusy ? 'animate-spin' : ''}`} />
                            <span>{slotData?.url ? 'Ganti Foto' : 'Unggah Foto'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* -------------------------------------------------------- */}
            {/* SECTION 4: CATATAN TEKNISI & HASIL COMMISSIONING         */}
            {/* -------------------------------------------------------- */}
            <section className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="remarks-commissioning"
                  className="block font-bold text-[11px] text-[#766B83] dark:text-[#CEC0E8] uppercase tracking-wider"
                >
                  CATATAN TEKNISI &amp; HASIL COMMISSIONING <span className="text-[#DC4C5A]">*</span>
                </label>
                <span className="text-[10px] font-mono text-[#7135B5] dark:text-[#A78BFA]">
                  Level 3 Template / Manual
                </span>
              </div>

              {!ticketClosed && availableRemarksTemplates.length > 0 && (
                <div className="mb-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
                  <span className="text-[#8B8495] text-[10px] font-semibold shrink-0">Template:</span>
                  {availableRemarksTemplates.map((tpl, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setRemarksReport(tpl)}
                      className="px-2 py-0.5 rounded-lg bg-[#F5F1FF] hover:bg-[#E9D5FF] dark:bg-[#261942] dark:hover:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#4B386B] whitespace-nowrap text-[10px] font-semibold transition-colors cursor-pointer"
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
                placeholder="Tuliskan catatan hasil commissioning, panjang dropcore, redaman OPM akhir, dan konfirmasi pelanggan..."
                className="tactile-debossed-input w-full bg-[#F5F1FF] dark:bg-[#160D29] text-[#160D29] dark:text-white font-medium text-[13px] rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-[#431599] leading-relaxed resize-none disabled:opacity-60"
              />
              <div className="flex items-center justify-between gap-2 mt-2 text-[11px] text-[#8B8495] dark:text-[#CEC0E8]/75">
                <span className="text-[#35105E] dark:text-[#D8B4FE] font-medium truncate">
                  {opmDbm || dropcoreLength
                    ? `Ringkasan: ${opmDbm ? `OPM ${opmDbm} dBm` : ''}${opmDbm && dropcoreLength ? ' · ' : ''}${dropcoreLength ? `Dropcore ${dropcoreLength}m` : ''}`
                    : 'Catat parameter teknis lapangan secara jelas'}
                </span>
                <span className="font-mono font-semibold shrink-0 tabular-nums">
                  {remarksReport.length} Karakter
                </span>
              </div>
            </section>

            {/* -------------------------------------------------------- */}
            {/* SECTION 5: KONFIRMASI & TANDA TANGAN PELANGGAN           */}
            {/* -------------------------------------------------------- */}
            <section className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] flex items-center justify-center border-t border-white/60 dark:border-white/10 shadow-[0_1.5px_0_#CEC3D4] dark:shadow-none">
                    <PenTool className="w-4 h-4" />
                  </div>
                  <h2 className="font-display font-bold text-[16px] text-[#160D29] dark:text-white">
                    Konfirmasi &amp; Tanda Tangan
                  </h2>
                </div>
                <span
                  className={`font-mono text-[10.5px] font-bold flex items-center gap-1 px-2.5 py-0.5 rounded-full border ${
                    isSignatureReady
                      ? 'text-[#16A36A] bg-emerald-50 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700'
                      : 'text-[#766B83] bg-[#F5F1FF] border-[#D8CCF3] dark:bg-[#22123F] dark:text-[#CEC0E8] dark:border-[#4B386B]'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isSignatureReady ? 'Siap Submit' : 'Belum TTD'}</span>
                </span>
              </div>

              {/* Interactive Signature Pad (Debossed Well) */}
              <div className="tactile-debossed-input relative bg-[#F5F1FF] dark:bg-[#160D29] rounded-xl p-3 flex flex-col items-center justify-center overflow-hidden">
                <div className="relative w-full h-28">
                  <canvas
                    ref={signatureCanvasRef}
                    onPointerDown={handleSignaturePointerDown}
                    onPointerMove={handleSignaturePointerMove}
                    onPointerUp={handleSignaturePointerUp}
                    onPointerLeave={handleSignaturePointerUp}
                    className={`w-full h-full touch-none ${ticketClosed ? 'cursor-not-allowed' : 'cursor-crosshair'}`}
                  />
                  {!customerSignatureUrl && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] font-medium text-[#8B8495] dark:text-[#CEC0E8]/60">
                      Tanda tangan pelanggan di area ini...
                    </div>
                  )}
                </div>

                <div className="w-full flex items-center justify-between pt-2.5 border-t border-dashed border-[#D8CCF3] dark:border-[#35105E] mt-1">
                  <span className="text-[12px] font-bold text-[#211A2E] dark:text-white truncate">
                    {activeTicket.customerName || 'Pelanggan'} (Pelanggan)
                  </span>
                  {!ticketClosed && (
                    <button
                      type="button"
                      onClick={handleClearSignature}
                      className="tactile-btn-secondary inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-[#261942] text-[#431599] dark:text-[#D8B4FE] font-bold text-[11px] border border-[#D8CCF3] dark:border-[#4B386B] cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Ulangi</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Consent Verification Checkbox */}
              <label className="flex items-start gap-2.5 mt-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={customerConsentConfirmed}
                  disabled={ticketClosed || isSubmittingReport}
                  onChange={e => setCustomerConsentConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded text-[#7135B5] focus:ring-[#D8B4FE] accent-[#7135B5] cursor-pointer"
                />
                <span className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] leading-snug font-medium">
                  Pelanggan telah menguji koneksi (Speedtest &amp; browsing), menerima CPE dalam keadaan baik, dan menandatangani Berita Acara Digital.
                </span>
              </label>
            </section>

            {/* -------------------------------------------------------- */}
            {/* LOCAL DRAFT SYNC BANNER                                  */}
            {/* -------------------------------------------------------- */}
            {!ticketClosed && (
              <div className="flex items-center gap-2.5 p-3 bg-[#F4EAFF] dark:bg-[#22123F] rounded-xl border border-[#D8CCF3]/70 dark:border-[#4B386B] shadow-xs">
                <HardDriveDownload className="w-5 h-5 text-[#431599] dark:text-[#D8B4FE] shrink-0" />
                <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] flex-1 leading-tight">
                  Tersimpan otomatis ke draft lokal (<span className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE]">LocalDraft: {activeTicket.woNumber}</span>)
                  {draftSavedAt ? ` · Disimpan ${formatJakartaTimeOnly(draftSavedAt)}` : ' jika koneksi lapangan terputus.'}
                </p>
              </div>
            )}

            {/* -------------------------------------------------------- */}
            {/* DUAL 3D TACTILE EXECUTION CONTROLS                       */}
            {/* -------------------------------------------------------- */}
            {!ticketClosed && (
              <div className="flex flex-col gap-3 pt-1">
                {/* Primary 3D CTA */}
                <button
                  type="submit"
                  disabled={isSubmittingReport || requiresProgressCheckIn}
                  className="tactile-btn-primary w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#7135B5] to-[#5B35B1] text-white font-display flex flex-col items-center justify-center relative overflow-hidden group cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                  title={
                    requiresProgressCheckIn
                      ? 'Kirim pesan LiveChat kategori PROGRESS terlebih dahulu'
                      : 'Kirim Laporan Checkout & Ubah status ke BUTUH APPROVAL'
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-[15px] tracking-wide">
                      {isSubmittingReport
                        ? 'Mengunggah Laporan ke Dispatch...'
                        : canonicalApproval === 'REVISION'
                        ? `Kirim Revisi v${(activeTicket.progressReports?.length || 0) + 1} & Minta Approval Dispatch`
                        : 'Kirim Laporan & Minta Approval Dispatch'}
                    </span>
                    <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                  </span>
                  <span className="text-[10.5px] text-[#DEC0FF] font-medium mt-0.5 tracking-normal">
                    {requiresProgressCheckIn
                      ? 'Terkunci — Kirim LiveChat tag #PROGRESS terlebih dahulu'
                      : 'Akan mengubah status WO menjadi BUTUH APPROVAL'}
                  </span>
                </button>

                {/* Secondary 3D CTA */}
                <button
                  type="button"
                  disabled={isSubmittingReport}
                  onClick={() => persistDraftToDevice(true)}
                  className="tactile-btn-secondary w-full py-3 px-4 rounded-2xl bg-white dark:bg-[#22123F] text-[#35105E] dark:text-[#E9D5FF] font-display font-bold text-[13px] border border-[#D8CCF3] dark:border-[#4B386B] text-center tracking-wide cursor-pointer"
                >
                  Simpan Sebagai Draft / Tunda Sesaat
                </button>
              </div>
            )}
          </form>

          {/* ========================================================== */}
          {/* RIGHT COLUMN (5/12 on desktop): LIVE CHAT & HISTORY        */}
          {/* ========================================================== */}
          <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-4">

            {/* Live Chat Room */}
            <div
              ref={chatSectionRef}
              onClick={() => {
                if (!isChatActive) setIsChatActive(true);
              }}
              className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4 flex flex-col h-[560px] lg:h-[620px]"
            >
              {/* Chat Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[#E9E5F0] dark:border-[#35105E] shrink-0 gap-2 flex-wrap">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] flex items-center justify-center font-bold border border-[#D8CCF3] dark:border-[#5B35B1]">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-display font-bold text-[14px] text-[#160D29] dark:text-white flex items-center gap-2">
                      <span>Live Chat Room</span>
                      {unreadChatCount > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#DC4C5A] text-white tabular-nums">
                          {unreadChatCount > 99 ? '99+' : unreadChatCount} Baru
                        </span>
                      )}
                    </h3>
                    <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] font-mono">
                      WO: {activeTicket.woNumber}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  {chatCategory && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white shadow-2xs flex items-center gap-1"
                      style={{ backgroundColor: currentChatCategoryObj?.color || '#7135B5' }}
                    >
                      <Tag className="w-2.5 h-2.5" />
                      <span>{chatCategory}</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[10.5px] text-[#16A36A] dark:text-emerald-300 font-bold bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#16A36A]" />
                    <span>Live</span>
                  </span>
                </div>
              </div>

              {/* Chat Conversation Area */}
              <div className="flex-1 p-3 my-3 overflow-y-auto space-y-3 bg-[#F5F1FF]/70 dark:bg-[#140827]/80 rounded-xl border border-[#D8CCF3]/60 dark:border-[#35105E]">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-5 text-[#8B8495] space-y-2">
                    <div className="w-10 h-10 rounded-2xl bg-[#F4EAFF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE] flex items-center justify-center shadow-xs">
                      <MessageCircle className="w-5 h-5" />
                    </div>
                    <h4 className="font-bold text-[#211A2E] dark:text-white text-xs">
                      Belum Ada Pesan Koordinasi
                    </h4>
                    <p className="text-[11px] max-w-xs text-[#766B83] dark:text-[#CEC0E8] leading-relaxed">
                      Pilih kategori <strong>PROGRESS</strong> lalu kirim pesan pertama untuk Check-in lapangan otomatis sebelum mengisi laporan checkout.
                    </p>
                  </div>
                ) : (
                  messages.map(msg => {
                    const isMe = msg.senderId === currentUser.id || msg.senderRole === currentUser.role;
                    const formattedTime = new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit'
                    });

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} space-y-1`}
                      >
                        <div className="flex items-center gap-1.5 text-[10.5px]">
                          <span className="font-bold text-[#211A2E] dark:text-[#E9D5FF]">
                            {isMe ? 'Anda' : msg.senderName}
                          </span>
                          {msg.category && (
                            <span className="font-mono text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-[#E9D5FF] dark:bg-[#35105E] text-[#431599] dark:text-[#D8B4FE]">
                              #{msg.category}
                            </span>
                          )}
                          <span className="text-[10px] text-[#8B8495] font-mono tabular-nums">
                            {formattedTime}
                          </span>
                        </div>

                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-2xs space-y-1.5 text-xs ${
                            isMe
                              ? 'bg-[#5B35B1] text-white rounded-tr-xs'
                              : 'bg-white dark:bg-[#22123F] text-[#211A2E] dark:text-[#F5EEFF] border border-[#D8CCF3] dark:border-[#35105E] rounded-tl-xs'
                          }`}
                        >
                          {msg.text && (
                            <p className="leading-relaxed whitespace-pre-wrap break-words font-normal">
                              {msg.text}
                            </p>
                          )}

                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                              {msg.attachments.map(att => (
                                <div
                                  key={att.id}
                                  className="group relative rounded-lg overflow-hidden border border-black/10 dark:border-white/10 bg-black/5 cursor-pointer"
                                  onClick={() => setZoomImage(att.url)}
                                >
                                  <img
                                    src={getSafePreviewUrl(att.url)}
                                    alt={att.fileName}
                                    className="w-full h-28 object-cover"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {isMe && (
                          <MessageStatusReceipt
                            message={msg}
                            senderId={currentUser.id}
                            variant="onLight"
                            showLabel={true}
                          />
                        )}
                      </div>
                    );
                  })
                )}
                <div ref={chatMessagesEndRef} />
              </div>

              {/* Chat Error Alert */}
              {chatError && (
                <div className="mb-2 p-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-[#BA1A1A] dark:text-rose-300 text-xs flex items-center gap-1.5 shrink-0">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{chatError}</span>
                </div>
              )}

              {/* Pending Attachments Preview */}
              {chatAttachments.length > 0 && (
                <div className="mb-2 p-2 bg-[#F4EAFF] dark:bg-[#22123F] border border-[#D8CCF3] dark:border-[#4B386B] rounded-xl flex items-center gap-2 overflow-x-auto shrink-0">
                  {chatAttachments.map(att => (
                    <div key={att.id} className="relative shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-[#7135B5]">
                      <img src={att.url} alt={att.fileName} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        onClick={() => handleRemoveAttachment(att.id)}
                        className="absolute top-0.5 right-0.5 p-0.5 bg-[#DC4C5A] text-white rounded-full cursor-pointer"
                        title="Hapus lampiran"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                  <span className="text-[11px] text-[#431599] dark:text-[#D8B4FE] font-semibold">
                    {chatAttachments.length} foto siap dikirim
                  </span>
                </div>
              )}

              {/* Chat Input Controls */}
              {currentUser.role === 'leader' ? (
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-xl text-center text-xs text-amber-800 dark:text-amber-300 font-medium shrink-0">
                  Mode Pantau: Leader hanya dapat membaca riwayat percakapan.
                </div>
              ) : (
                <form onSubmit={handleSendChatMessage} className="space-y-2 shrink-0">
                  <select
                    value={chatCategory}
                    onChange={e => handleChatCategorySelect(e.target.value)}
                    className="tactile-debossed-input w-full px-3 py-1.5 rounded-xl bg-[#F5F1FF] dark:bg-[#160D29] text-[#160D29] dark:text-white text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-[#7135B5] cursor-pointer"
                  >
                    <option value="">-- Pilih Kategori Chat Wajib (mis. PROGRESS) --</option>
                    {activeChatCategories.map(cat => (
                      <option key={cat.id} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={chatFileInputRef}
                      onChange={handleChatFileSelect}
                      accept="image/jpeg,image/png,image/webp,image/jpg"
                      multiple
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => chatFileInputRef.current?.click()}
                      className="tactile-btn-secondary p-2.5 rounded-xl bg-white dark:bg-[#22123F] text-[#431599] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#4B386B] shrink-0 cursor-pointer"
                      title="Lampirkan foto ke chat"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>

                    <input
                      ref={chatInputRef}
                      type="text"
                      value={chatInputText}
                      onFocus={() => setIsChatActive(true)}
                      onChange={e => setChatInputText(e.target.value)}
                      placeholder={!chatCategory ? 'Pilih kategori chat dahulu...' : 'Tulis pesan koordinasi...'}
                      className="tactile-debossed-input flex-1 px-3.5 py-2.5 bg-[#F5F1FF] dark:bg-[#160D29] rounded-xl text-xs text-[#160D29] dark:text-white placeholder:text-[#8B8495] focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
                    />

                    <button
                      type="submit"
                      disabled={
                        isSendingChat ||
                        !chatCategory ||
                        chatCategory.toUpperCase() === 'UNCLASSIFIED' ||
                        (!chatInputText.trim() && chatAttachments.length === 0)
                      }
                      className="tactile-micro-key p-2.5 bg-gradient-to-b from-[#7135B5] to-[#5B35B1] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl flex items-center justify-center shrink-0 cursor-pointer"
                      title="Kirim pesan"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* History Progress Report Card */}
            <div className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4 space-y-3">
              <button
                type="button"
                onClick={() => setShowHistorySection(prev => !prev)}
                className="w-full flex items-center justify-between pb-2 border-b border-[#E9E5F0] dark:border-[#35105E] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-[#16A36A] shrink-0" />
                  <h3 className="font-display font-bold text-sm text-[#160D29] dark:text-white">
                    History Progress Report
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-100 text-[#16A36A] dark:bg-emerald-950/70 dark:text-emerald-300 tabular-nums">
                    {progressHistory.length} Versi
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-[#766B83] transition-transform ${showHistorySection ? 'rotate-180' : ''}`}
                  />
                </div>
              </button>

              {showHistorySection && (
                progressHistory.length === 0 ? (
                  <div className="py-5 text-center text-[#8B8495] space-y-1.5">
                    <Clock className="w-6 h-6 mx-auto opacity-50" />
                    <p className="text-xs">Belum ada riwayat laporan untuk WO ini.</p>
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                    {progressHistory.map((item, idx) => {
                      const formattedDate = new Date(item.timestamp).toLocaleString('id-ID', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      });

                      return (
                        <div
                          key={item.id || idx}
                          className="p-3 rounded-xl border border-[#D8CCF3]/70 dark:border-[#35105E] bg-[#F5F1FF]/70 dark:bg-[#160D29] space-y-1.5 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-1.5 pb-1.5 border-b border-[#D8CCF3]/50 dark:border-[#35105E]">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="px-1.5 py-0.5 rounded font-mono text-[10px] font-extrabold bg-[#E9D5FF] text-[#431599] dark:bg-[#2E1459] dark:text-[#D8B4FE]">
                                v{item.versionNumber || progressHistory.length - idx}
                              </span>
                              <span className="font-mono text-[10.5px] text-[#766B83] dark:text-[#CEC0E8]">
                                {formattedDate} WIB
                              </span>
                              <span className="font-bold text-[#211A2E] dark:text-white inline-flex items-center gap-1">
                                <User className="w-3 h-3 text-[#7135B5]" />
                                {item.submittedBy}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <StatusBadge status={item.reportStatus} variant="report" />
                              {(item.approvalStatus || (idx === 0 && activeTicket.approvalStatus && activeTicket.approvalStatus !== 'NONE')) && (
                                <StatusBadge
                                  status={item.approvalStatus || activeTicket.approvalStatus}
                                  variant="approval"
                                />
                              )}
                            </div>
                          </div>

                          <div className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] space-y-0.5">
                            <div>
                              Reason: <strong className="text-[#211A2E] dark:text-white">{item.reasonReport}</strong>
                            </div>
                            <div>
                              Rootcause: <strong className="text-[#431599] dark:text-[#D8B4FE]">{item.rootCause}</strong>
                            </div>
                          </div>

                          {item.remarksReport && (
                            <p className="text-[11px] text-[#494453] dark:text-[#CEC0E8] italic bg-white dark:bg-[#1E1238] p-2 rounded-lg border border-[#E9E5F0] dark:border-[#35105E]">
                              &ldquo;{item.remarksReport}&rdquo;
                            </p>
                          )}

                          {(item.revisionReason || (item as any).rejectionReason) && (
                            <div className="p-2 rounded-lg bg-[#FEF2F2] dark:bg-rose-950/60 border border-[#FCA5A5] dark:border-rose-800 text-[#B91C1C] dark:text-rose-200 text-[10.5px] font-semibold">
                              Catatan Revisi Dispatch: &ldquo;{item.revisionReason || (item as any).rejectionReason}&rdquo;
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* Compact Network & Metadata Summary Card */}
            <div className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4 space-y-2 text-[11px]">
              <div className="flex items-center gap-1.5 font-bold text-[#766B83] dark:text-[#CEC0E8] uppercase tracking-wider">
                <Wrench className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#A78BFA]" />
                <span>Spesifikasi Infrastruktur WO</span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div>
                  <span className="text-[#8B8495] block">ID Pelanggan</span>
                  <span className="font-mono font-bold text-[#211A2E] dark:text-white">
                    {activeTicket.idCustomer || activeTicket.customerId || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[#8B8495] block">Mitra Vendor</span>
                  <span className="font-semibold text-[#211A2E] dark:text-white truncate block">
                    {activeTicket.contactorName || activeTicket.contractorName || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[#8B8495] block">Kode FDT / FAT</span>
                  <span className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE]">
                    {activeTicket.fdtCode || '-'} / {activeTicket.fatCode || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[#8B8495] block">Area / Cluster</span>
                  <span className="font-semibold text-[#211A2E] dark:text-white truncate block">
                    {activeTicket.area || '-'} · {activeTicket.clusterName || '-'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* STITCH AI BOTTOM SHEET MODAL: KONFIRMASI PENYELESAIAN WO (QC)  */}
      {/* ============================================================== */}
      {showQcConfirmSheet && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qc-confirm-sheet-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-[#160D29]/75 backdrop-blur-sm animate-in fade-in duration-150"
        >
          <div className="absolute inset-0" onClick={() => setShowQcConfirmSheet(false)} />

          <div className="mj-sheet-enter relative z-10 w-full sm:max-w-lg bg-[#FDF7FF] dark:bg-[#1E1238] rounded-t-[1.5rem] sm:rounded-3xl border border-[#E8DDFF] dark:border-[#5B35B1]/60 shadow-[0_-12px_40px_rgba(22,13,41,0.4),0_20px_50px_rgba(22,13,41,0.45)] max-h-[92vh] flex flex-col overflow-hidden">
            {/* Pull Handle on mobile */}
            <div className="flex justify-center pt-2.5 pb-1 sm:hidden shrink-0">
              <div className="w-10 h-1.5 rounded-full bg-[#CEC3D4] dark:bg-[#4B386B]" />
            </div>

            {/* Sheet Header */}
            <div className="px-5 pt-3 pb-3.5 border-b border-[#E8DDFF] dark:border-[#35105E] flex items-start justify-between gap-3 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-[#F3EAFF] dark:bg-[#35105E] border border-[#E8DDFF] dark:border-[#7135B5] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#58149C] dark:text-[#DAB9FF]">
                      VALIDASI AKHIR QC
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-[#F3EAFF] dark:bg-[#2E1459] font-mono text-[10.5px] font-bold text-[#4B4452] dark:text-[#E9D5FF] border border-[#E8DDFF] dark:border-[#4B386B]">
                      #{activeTicket.woNumber}
                    </span>
                  </div>
                  <h3
                    id="qc-confirm-sheet-title"
                    className="font-display font-bold text-[18px] text-[#1F1638] dark:text-white leading-snug mt-0.5 truncate"
                  >
                    Konfirmasi Penyelesaian WO
                  </h3>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowQcConfirmSheet(false)}
                className="tactile-pill-btn p-2 rounded-full bg-white dark:bg-[#2A1647] text-[#4B4452] dark:text-[#E9D5FF] border border-[#E8DDFF] dark:border-[#4B386B] cursor-pointer shrink-0"
                aria-label="Tutup Konfirmasi QC"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Dark #160D29 Optical Telemetry Live Card */}
              <div className="rounded-2xl bg-[#160D29] border border-[#35105E] p-4 text-white shadow-[0_8px_22px_rgba(22,13,41,0.3)] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10.5px] font-mono font-bold uppercase tracking-wider text-[#DAB9FF]">
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>OPTICAL TELEMETRY LIVE</span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${
                      opmStatus.isOutOfSpec
                        ? 'bg-rose-950/70 text-rose-300 border-rose-500/50'
                        : Number.isNaN(opmNumeric)
                        ? 'bg-amber-950/70 text-amber-300 border-amber-500/50'
                        : 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>
                      {opmStatus.isOutOfSpec
                        ? 'Perlu Periksa Redaman'
                        : Number.isNaN(opmNumeric)
                        ? 'OPM Belum Diisi'
                        : 'Status Optimal'}
                    </span>
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl bg-[#241740] border border-white/10 p-3">
                    <div className="text-[11px] text-[#CEC0E8]">Rx Optical Power</div>
                    <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
                      <span
                        className={`text-[22px] font-bold leading-none ${
                          opmStatus.isOutOfSpec ? 'text-rose-400' : 'text-emerald-400'
                        }`}
                      >
                        {opmDbm.trim() || '—'}
                      </span>
                      {opmDbm.trim() && <span className="text-xs text-[#CEC0E8]">dBm</span>}
                    </div>
                    <div className="mt-1.5 text-[10.5px] font-mono text-emerald-300">
                      ✓ Ambang: &gt;= -24 dBm
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#241740] border border-white/10 p-3">
                    <div className="text-[11px] text-[#CEC0E8]">Jalur &amp; Dropcore</div>
                    <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
                      <span className="text-[20px] font-bold text-white leading-none">
                        {dropcoreLength.trim() || '—'}
                      </span>
                      {dropcoreLength.trim() && <span className="text-xs text-[#CEC0E8]">m</span>}
                    </div>
                    <div className="mt-1.5 text-[10.5px] font-mono text-[#DAB9FF] truncate">
                      FAT {activeTicket.fatCode || '-'}{fatPort ? ` • #${fatPort}` : ''}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2 text-[11px]">
                  <span className="flex items-center gap-1.5 font-semibold text-[#F5EEFF] truncate">
                    <Radio className="w-3.5 h-3.5 text-[#DAB9FF] shrink-0" />
                    <span className="truncate">
                      {activeTicket.ontBrand || 'GPON ONT'} {activeTicket.ontModel || ''}
                    </span>
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#241740] border border-white/10 font-mono text-[10.5px] text-[#DAB9FF] shrink-0">
                    SN: {ontSerialNumber.trim() || 'Belum diisi'}
                  </span>
                </div>
              </div>

              {/* Foto Bukti Lapangan */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-display font-bold text-[14px] text-[#1F1638] dark:text-white">
                    Foto Bukti Lapangan
                  </h4>
                  <span className="font-mono text-[11px] font-bold text-[#58149C] dark:text-[#DAB9FF]">
                    {uploadedPhotoSlotsList.length} Terlampir
                  </span>
                </div>

                {uploadedPhotoSlotsList.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2.5">
                    {uploadedPhotoSlotsList.map(slot => (
                      <button
                        key={slot.slotKey}
                        type="button"
                        onClick={() => setZoomImage(slot.url)}
                        className="relative h-28 rounded-xl overflow-hidden border border-[#E8DDFF] dark:border-[#4B386B] bg-[#F3EAFF] dark:bg-[#160D29] group cursor-pointer text-left"
                      >
                        <img
                          src={getSafePreviewUrl(slot.url)}
                          alt={slot.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#160D29]/90 via-[#160D29]/45 to-transparent p-2 flex items-center gap-1.5 text-white text-[10.5px] font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">{slot.title.replace(/^\d+\.\s*/, '')}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl border border-dashed border-[#CEC3D4] dark:border-[#4B386B] bg-white dark:bg-[#160D29] text-center space-y-2">
                    <p className="text-xs text-[#7D7484] dark:text-[#CEC0E8]">
                      Belum ada foto bukti SOP yang diunggah. Anda disarankan melampirkan foto OPM &amp; SN sebelum kirim.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowQcConfirmSheet(false)}
                      className="tactile-btn-secondary px-3 py-1.5 rounded-lg bg-[#F3EAFF] dark:bg-[#261942] text-[#58149C] dark:text-[#DAB9FF] text-[11px] font-bold cursor-pointer"
                    >
                      Unggah Foto Bukti Sekarang
                    </button>
                  </div>
                )}
              </div>

              {/* Lembar Verifikasi Kualitas (SOP) Interactive Checklist */}
              <div className="rounded-2xl bg-white dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] p-3.5 space-y-2">
                <div className="text-[11px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8]">
                  Lembar Verifikasi Kualitas (SOP)
                </div>
                {[
                  { key: 'dropcoreNeat' as const, label: 'Kabel dropcore terpasang rapi, aman & klem kencang' },
                  { key: 'opmClean' as const, label: 'Konektor bersih & redaman OPM sesuai batas toleransi SOP' },
                  { key: 'customerTested' as const, label: 'Pelanggan telah uji koneksi & menandatangani Berita Acara' }
                ].map(item => (
                  <label
                    key={item.key}
                    className="flex items-start gap-2.5 text-xs text-[#1F1638] dark:text-[#F5EEFF] cursor-pointer select-none py-0.5"
                  >
                    <input
                      type="checkbox"
                      checked={sopChecks[item.key]}
                      onChange={e =>
                        setSopChecks(prev => ({ ...prev, [item.key]: e.target.checked }))
                      }
                      className="mt-0.5 w-4 h-4 rounded accent-[#58149C] cursor-pointer"
                    />
                    <span className="leading-snug font-medium">{item.label}</span>
                  </label>
                ))}
              </div>

              {/* Ringkasan Material Terpakai & 3-Tier Status */}
              <div className="rounded-2xl bg-white dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#35105E] p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-[#1F1638] dark:text-white flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                    <span>Material &amp; Status Laporan</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowQcConfirmSheet(false);
                      setTimeout(() => materialInputRef.current?.focus(), 120);
                    }}
                    className="text-[11px] font-bold text-[#58149C] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                  >
                    Ubah Material
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className="px-2 py-0.5 rounded-lg bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] font-bold text-[11px]">
                    {reportStatus} • {reasonReport}
                  </span>
                  {dropcoreLength && (
                    <span className="px-2 py-0.5 rounded-lg bg-[#F8F1FF] dark:bg-[#241740] border border-[#E8DDFF] dark:border-[#4B386B] font-mono text-[11px]">
                      {dropcoreLength}m Dropcore
                    </span>
                  )}
                  {usedMaterials && (
                    <span className="px-2 py-0.5 rounded-lg bg-[#F8F1FF] dark:bg-[#241740] border border-[#E8DDFF] dark:border-[#4B386B] text-[11px]">
                      {usedMaterials}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Sheet Sticky Footer 3D Extruded Buttons */}
            <div className="px-5 py-4 bg-white dark:bg-[#160D29] border-t border-[#E8DDFF] dark:border-[#35105E] space-y-2.5 shrink-0">
              <button
                type="button"
                disabled={isSubmittingReport || !sopChecks.dropcoreNeat || !sopChecks.opmClean || !sopChecks.customerTested}
                onClick={handleSaveReport}
                className="tactile-btn-primary w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-[#58149C] to-[#7135B5] text-white font-display font-bold text-[14px] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle2 className="w-4.5 h-4.5" />
                <span>
                  {isSubmittingReport
                    ? 'Menyimpan ke Server...'
                    : 'Kirim Laporan & Selesaikan WO'}
                </span>
              </button>
              <button
                type="button"
                disabled={isSubmittingReport}
                onClick={() => setShowQcConfirmSheet(false)}
                className="tactile-btn-secondary w-full py-2.5 px-4 rounded-2xl bg-white dark:bg-[#22123F] text-[#4B4452] dark:text-[#E9D5FF] border border-[#CEC3D4] dark:border-[#4B386B] font-bold text-[13px] cursor-pointer"
              >
                Periksa Ulang / Kembali
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* LEVEL-3 KENDALA / RESCHEDULE ESCALATION MODAL                  */}
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
      {/* MORAJAWS SUCCESS ALERT MODAL WITH CONFIRMATION BUTTON           */}
      {/* ============================================================== */}
      {showSuccessAlert && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#160D29]/85 backdrop-blur-md animate-in fade-in duration-200"
        >
          <div
            className="w-full max-w-md bg-[#160D29] rounded-3xl border border-[#D8B4FE]/50 p-6 sm:p-7 shadow-[0_0_50px_rgba(113,53,181,0.6)] relative overflow-hidden animate-in zoom-in-95 duration-200 text-center"
            style={{
              backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(113, 53, 181, 0.45) 0%, rgba(22, 13, 41, 0.98) 75%)'
            }}
          >
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#D8B4FE] to-transparent" />

            <div className="relative w-20 h-20 mx-auto mb-4 flex items-center justify-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#35105E] to-[#160D29] border border-[#D8B4FE]/60 flex items-center justify-center shadow-[0_0_20px_rgba(52,211,153,0.4)] relative z-10">
                <CheckCircle2 className="w-9 h-9 text-emerald-400" />
              </div>
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold tracking-wider uppercase bg-[#35105E] text-[#D8B4FE] border border-[#D8B4FE]/40 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-[#D8B4FE]" />
              <span>MORAJAWS SYSTEM</span>
            </div>

            <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight uppercase">
              REPORT TERSIMPAN!
            </h3>

            <p className="text-xs sm:text-sm text-[#E9D5FF] mt-1.5 font-medium leading-relaxed">
              Laporan checkout berhasil disimpan dan tiket WO kini berstatus{' '}
              <strong className="text-amber-300 font-bold">BUTUH APPROVAL</strong> (Menunggu pemeriksaan Dispatch).
            </p>

            <div className="grid grid-cols-2 gap-2 mt-3.5 mb-2">
              <div className="py-1.5 px-3 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300 font-bold text-xs flex items-center justify-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                <span>BUTUH APPROVAL</span>
              </div>
              <div className="py-1.5 px-3 rounded-xl bg-[#7135B5]/25 border border-[#D8B4FE]/30 text-[#E9D5FF] font-bold text-xs flex items-center justify-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-[#D8B4FE]" />
                <span>Supabase Synced</span>
              </div>
            </div>

            <div className="my-4 p-3.5 rounded-2xl bg-[#35105E]/40 border border-[#D8B4FE]/25 text-left text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[#D8B4FE]/70">No. Work Order:</span>
                <span className="font-mono font-bold text-white bg-[#35105E] px-2 py-0.5 rounded border border-[#D8B4FE]/30">
                  {activeTicket.woNumber}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#D8B4FE]/70">Report Status:</span>
                <span className="font-bold text-[#E9D5FF] bg-purple-500/25 px-2.5 py-0.5 rounded-md border border-[#D8B4FE]/30">
                  {savedReportSnapshot?.status || reportStatus}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#D8B4FE]/70">Reason Report:</span>
                <span className="font-semibold text-[#E9D5FF] truncate max-w-[200px]">
                  {savedReportSnapshot?.reason || reasonReport}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#D8B4FE]/70">Rootcause:</span>
                <span className="font-semibold text-[#E9D5FF] truncate max-w-[200px]">
                  {savedReportSnapshot?.rootCause || rootCause}
                </span>
              </div>
              {opmDbm && (
                <div className="flex items-center justify-between">
                  <span className="text-[#D8B4FE]/70">Redaman OPM:</span>
                  <span className="font-mono font-bold text-emerald-300">{opmDbm} dBm</span>
                </div>
              )}
              <div className="flex items-center justify-between pt-1 border-t border-[#D8B4FE]/15">
                <span className="text-[#D8B4FE]/70">Bukti Foto SOP:</span>
                <span className="font-mono font-bold text-white">{uploadedPhotoSlotsList.length}/4 Terunggah</span>
              </div>
            </div>

            <button
              type="button"
              disabled={isRedirecting}
              onClick={handleConfirmRedirect}
              className="w-full py-3.5 px-5 bg-gradient-to-r from-[#7135B5] to-[#A855F7] hover:from-[#7E3CC7] hover:to-[#B666FE] text-white font-extrabold text-xs sm:text-sm tracking-wide rounded-[14px] shadow-[0_0_24px_rgba(168,85,247,0.55)] border border-[#E9D5FF]/40 flex items-center justify-center gap-2.5 transition-all cursor-pointer disabled:opacity-60"
            >
              <CheckCircle2 className="w-5 h-5 text-white shrink-0" />
              <span>
                {isRedirecting ? 'MENGALIHKAN KE TUGAS SAYA...' : 'KONFIRMASI & KEMBALI KE DAFTAR WO'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* LIGHTBOX MODAL: FULLSIZE IMAGE VIEW                            */}
      {/* ============================================================== */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-70 bg-black/90 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setZoomImage(null)}
        >
          <div className="relative max-w-4xl max-h-[92vh]" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoomImage(null)}
              className="absolute top-3 right-3 p-2 bg-black/70 text-white rounded-full hover:bg-rose-600 transition-colors z-10 cursor-pointer"
              title="Tutup"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={getSafePreviewUrl(zoomImage)}
              alt="Lampiran Bukti Lapangan"
              className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
            />
          </div>
        </div>
      )}
    </div>
  );
};
