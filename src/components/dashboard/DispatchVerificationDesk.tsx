import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CalendarClock,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Copy,
  Database,
  Edit3,
  ExternalLink,
  Eye,
  Filter,
  GitBranch,
  ImageOff,
  Layers,
  Loader2,
  MapPin,
  Maximize2,
  MessageSquare,
  Network,
  QrCode,
  Radio,
  RefreshCw,
  RotateCcw,
  Router,
  Ruler,
  Satellite,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Timer,
  UserCheck,
  Wrench,
  X,
  ZoomIn,
  Zap
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { DispatchApprovalWoAgentStatus, TechnicalPhotoSlot, Ticket, WOKpiSummary } from '../../types/index.ts';
import {
  DISPATCH_APPROVAL_OPTIONS,
  computeClientKpiSummary,
  getDispatchApprovalOutcomeLabel,
  getRecommendedDispatchWoAgentStatus,
  getTicketCanonicalApprovalStatus,
  isTicketCheckedIn,
  isTicketClosed
} from '../../services/woLifecycleService';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { buildGoogleMapsCoordinateUrl, buildGoogleMapsSearchUrl, formatCoordinates, isValidCoordinatePair } from '../../services/mapsService';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import { StatusAgentBadge, StatusApprovalBadge, StatusInstallerBadge } from '../common/Badge';

interface DispatchVerificationDeskProps {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

type QueueFilterTab = 'all' | 'critical' | 'revision';

interface ZoomedPhotoState {
  url: string;
  title: string;
  subtitle: string;
  latitude?: number;
  longitude?: number;
  gpsAccuracyMeters?: number;
}

function getLatestSubmittedTimestamp(ticket: Ticket): string | undefined {
  return (
    ticket.progressReports?.[0]?.timestamp ||
    ticket.technicalReport?.submittedAt ||
    ticket.updatedAt ||
    ticket.createdAt
  );
}

function getWaitingMinutes(iso?: string): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  const diffMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return diffMin;
}

function formatRelativeMinutes(mins: number | null): string {
  if (mins === null) return '-';
  if (mins < 1) return 'Baru masuk';
  if (mins < 60) return `${mins}m yang lalu`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem > 0 ? `${hours}j ${rem}m lalu` : `${hours}j yang lalu`;
  const days = Math.floor(hours / 24);
  return `${days}h yang lalu`;
}

function parseNumericDbm(raw?: string | number | null): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/dbm/gi, '').replace(',', '.').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function getInitials(name?: string): string {
  if (!name) return 'TK';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

function hasText(v?: unknown): boolean {
  if (v === undefined || v === null) return false;
  const s = String(v).trim();
  return s !== '' && s !== '-' && s !== 'null' && s !== 'undefined';
}

function getTicketProofStats(ticket: Ticket) {
  const slots = Array.isArray(ticket.technicalReport?.photoSlots) ? ticket.technicalReport!.photoSlots : [];
  const houseSlot = slots.find(s => s.slotKey === 'customer_house');
  const opmSlot = slots.find(s => s.slotKey === 'opm');
  const fatSlot =
    slots.find(s => s.slotKey === 'fat_pole') ||
    slots.find(s => s.slotKey === 'fat_attenuation') ||
    slots.find(s => s.slotKey === 'barcode_sn');

  const housePhotoUrl =
    getSafePreviewUrl(houseSlot?.url) ||
    getSafePreviewUrl(ticket.houseLocation?.photoUrl) ||
    getSafePreviewUrl(ticket.technicalReport?.photoBeforeUrl);

  const houseLat = houseSlot?.latitude ?? ticket.houseLocation?.latitude;
  const houseLng = houseSlot?.longitude ?? ticket.houseLocation?.longitude;
  const houseAcc = houseSlot?.gpsAccuracyMeters ?? ticket.houseLocation?.accuracyMeters;
  const houseGeoStatus = houseSlot?.geotagStatus ?? ticket.houseLocation?.geotagStatus;
  const hasHouseGeo = isValidCoordinatePair(houseLat, houseLng);
  const hasHouseValid = Boolean(housePhotoUrl) || houseGeoStatus === 'valid' || hasHouseGeo;

  const rawOpm =
    ticket.rosetRedamanDbm ??
    ticket.technicalReport?.opticalPowerRx ??
    ticket.technicalReport?.opticalPowerDbm;
  const numericOpm = parseNumericDbm(rawOpm);
  const isOpmOptimal = numericOpm !== null && numericOpm <= -12 && numericOpm >= -25;
  const hasOpmProof = numericOpm !== null || Boolean(getSafePreviewUrl(opmSlot?.url));

  const fatPhotoUrl =
    getSafePreviewUrl(fatSlot?.url) ||
    getSafePreviewUrl(ticket.technicalReport?.photoAfterUrl) ||
    getSafePreviewUrl(ticket.technicalReport?.photos?.[0]);
  const fatLabel = ticket.fatCode || ticket.fat || '';
  const ontSerial =
    ticket.technicalReport?.deviceSerialNumber ||
    ticket.ontSerialNumber ||
    ticket.routerSerialNumber ||
    '';
  const hasFatOrOntProof = Boolean(fatPhotoUrl) || (hasText(fatLabel) && hasText(ontSerial));

  const verifiedPointsCount = [hasHouseValid, hasOpmProof, hasFatOrOntProof].filter(Boolean).length;

  return {
    slots,
    houseSlot,
    opmSlot,
    fatSlot,
    housePhotoUrl,
    houseLat,
    houseLng,
    houseAcc,
    houseGeoStatus,
    hasHouseGeo,
    hasHouseValid,
    rawOpm,
    numericOpm,
    isOpmOptimal,
    hasOpmProof,
    fatPhotoUrl,
    fatLabel,
    ontSerial,
    hasFatOrOntProof,
    verifiedPointsCount
  };
}

export const DispatchVerificationDesk: React.FC<DispatchVerificationDeskProps> = ({
  onNavigate,
  onSelectTicket,
  onOpenWhatsApp
}) => {
  const {
    currentUser,
    scopedTickets,
    kpiSummary,
    todayWIB,
    databaseStatus,
    isDataLoading,
    refreshDatabaseData,
    refreshKpiSummary,
    approveProgressReport,
    rejectProgressReport,
    updateTicket,
    getMessagesForTicket,
    toast
  } = useApp();

  const [queueFilter, setQueueFilter] = useState<QueueFilterTab>('all');
  const [criticalOnlyToggle, setCriticalOnlyToggle] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [hotDeskModalOpen, setHotDeskModalOpen] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [isRefreshingNow, setIsRefreshingNow] = useState(false);
  const [decisionNotes, setDecisionNotes] = useState('');
  const [selectedWoAgentStatus, setSelectedWoAgentStatus] = useState<DispatchApprovalWoAgentStatus>('Done');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isRescheduling, setIsRescheduling] = useState(false);
  const [showReschedulePanel, setShowReschedulePanel] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleSlot, setRescheduleSlot] = useState('09:00 - 11:00 WIB');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [qcChecklist, setQcChecklist] = useState<{
    facadeAndCable: boolean;
    opticalAttenuation: boolean;
    dropcoreBarcodeAndFat: boolean;
    ontOnlineProvisioned: boolean;
  }>({
    facadeAndCable: false,
    opticalAttenuation: false,
    dropcoreBarcodeAndFat: false,
    ontOnlineProvisioned: false
  });
  const [queueLimit, setQueueLimit] = useState(12);
  const [zoomPhoto, setZoomPhoto] = useState<ZoomedPhotoState | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const studioRef = useRef<HTMLDivElement>(null);
  const notesInputRef = useRef<HTMLTextAreaElement>(null);
  const modalNotesInputRef = useRef<HTMLTextAreaElement>(null);

  const canManageApproval = currentUser.role === 'dispatch' || currentUser.role === 'super_admin';

  const slotTimeOptions = useMemo(() => {
    const defaults = ['09:00 - 11:00 WIB', '11:00 - 13:00 WIB', '13:00 - 15:00 WIB', '15:00 - 17:00 WIB'];
    const dynamic = Array.from(
      new Set((scopedTickets || []).map(t => String(t.slotTime || '').trim()).filter(Boolean))
    );
    return Array.from(new Set([...defaults, ...dynamic]));
  }, [scopedTickets]);

  // Real 10-second auto-refresh interval when toggled on
  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const timer = window.setInterval(async () => {
      try {
        await Promise.all([refreshDatabaseData(), refreshKpiSummary()]);
      } catch {
        // Handled silently by AppContext sync state
      }
    }, 10000);
    return () => window.clearInterval(timer);
  }, [autoRefreshEnabled, refreshDatabaseData, refreshKpiSummary]);

  const handleManualRefresh = async () => {
    if (isRefreshingNow) return;
    setIsRefreshingNow(true);
    try {
      await Promise.all([refreshDatabaseData(), refreshKpiSummary()]);
    } finally {
      setIsRefreshingNow(false);
    }
  };

  // Authoritative summary metrics
  const effectiveSummary: WOKpiSummary = useMemo(() => {
    const clientFallback = computeClientKpiSummary(scopedTickets, currentUser, {
      dateWIB: todayWIB,
      contractorFilter: 'ALL',
      areaFilter: 'ALL'
    });
    if (
      kpiSummary &&
      kpiSummary.dateWIB === todayWIB &&
      kpiSummary.contractorFilter === 'ALL' &&
      kpiSummary.areaFilter === 'ALL'
    ) {
      return kpiSummary;
    }
    return clientFallback;
  }, [kpiSummary, scopedTickets, currentUser, todayWIB]);

  const counts = effectiveSummary.counts;

  // Base active queue tickets from scopedTickets
  const activeOperationalTickets = useMemo(
    () => (scopedTickets || []).filter(t => !t.isDeleted && !t.isArchived),
    [scopedTickets]
  );

  const todayTickets = useMemo(
    () => activeOperationalTickets.filter(t => getTicketAppointmentDate(t) === todayWIB),
    [activeOperationalTickets, todayWIB]
  );

  // Build verification queue (all BUTUH APPROVAL across active scope + today's active/revision/verified items)
  const queueBuckets = useMemo(() => {
    const pendingList: Ticket[] = [];
    const revisionList: Ticket[] = [];
    const todayActiveRest: Ticket[] = [];

    for (const t of activeOperationalTickets) {
      const appStat = getTicketCanonicalApprovalStatus(t);
      const isToday = getTicketAppointmentDate(t) === todayWIB;
      if (appStat === 'BUTUH APPROVAL') {
        pendingList.push(t);
      } else if (appStat === 'REVISION') {
        revisionList.push(t);
      } else if (isToday && (appStat === 'APPROVED' || isTicketCheckedIn(t) || Boolean(t.technicalReport))) {
        todayActiveRest.push(t);
      }
    }

    // Sort pending queue oldest/highest aging first so SLA critical items sit at top
    pendingList.sort((a, b) => {
      const aTime = new Date(getLatestSubmittedTimestamp(a) || 0).getTime();
      const bTime = new Date(getLatestSubmittedTimestamp(b) || 0).getTime();
      return aTime - bTime;
    });

    revisionList.sort((a, b) => {
      const aTime = new Date(b.rejectedAt || b.updatedAt || 0).getTime();
      const bTime = new Date(a.rejectedAt || a.updatedAt || 0).getTime();
      return aTime - bTime;
    });

    todayActiveRest.sort((a, b) => {
      const aTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
      const bTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
      return aTime - bTime;
    });

    const allQueue = [...pendingList, ...revisionList, ...todayActiveRest];

    const criticalQueue = pendingList.filter(t => {
      const waitMin = getWaitingMinutes(getLatestSubmittedTimestamp(t));
      const appt = getTicketAppointmentDate(t);
      const isOverdue = Boolean(appt && appt < todayWIB);
      return (waitMin !== null && waitMin >= 15) || isOverdue;
    });

    return {
      pendingList,
      revisionList,
      criticalQueue,
      allQueue
    };
  }, [activeOperationalTickets, todayWIB]);

  // Aging distribution & KPI secondary calculations from real ticket timestamps
  const telemetryStats = useMemo(() => {
    const pendingWaitMins: number[] = [];
    let optimalUnder15 = 0;
    let warning15To30 = 0;
    let criticalOver30 = 0;

    for (const t of queueBuckets.pendingList) {
      const m = getWaitingMinutes(getLatestSubmittedTimestamp(t));
      if (m !== null) {
        pendingWaitMins.push(m);
        if (m < 15) optimalUnder15++;
        else if (m <= 30) warning15To30++;
        else criticalOver30++;
      } else {
        optimalUnder15++;
      }
    }

    const avgAgingMin =
      pendingWaitMins.length > 0
        ? Math.round((pendingWaitMins.reduce((s, v) => s + v, 0) / pendingWaitMins.length) * 10) / 10
        : null;

    const totalPendingCount = queueBuckets.pendingList.length;
    const targetMetPct =
      totalPendingCount > 0 ? Math.round((optimalUnder15 / totalPendingCount) * 1000) / 10 : 0;

    const approvedToday = todayTickets.filter(t => getTicketCanonicalApprovalStatus(t) === 'APPROVED').length;
    const revisionToday = todayTickets.filter(t => getTicketCanonicalApprovalStatus(t) === 'REVISION').length;
    const verifiedTodayTotal = approvedToday + revisionToday;
    const approvedSharePct =
      verifiedTodayTotal > 0 ? Math.round((approvedToday / verifiedTodayTotal) * 100) : 0;

    const checkedInToday = todayTickets.filter(t => isTicketCheckedIn(t));
    const geotagValidToday = todayTickets.filter(t => {
      const proof = getTicketProofStats(t);
      return proof.hasHouseValid;
    }).length;
    const geotagValidPct =
      checkedInToday.length > 0
        ? Math.min(100, Math.round((geotagValidToday / Math.max(checkedInToday.length, geotagValidToday)) * 100))
        : geotagValidToday > 0
        ? 100
        : 0;

    // Technician Compliance Meter metrics across scoped active operational tickets
    const submittedPool = activeOperationalTickets.filter(
      t =>
        Boolean(t.technicalReport) ||
        getTicketCanonicalApprovalStatus(t) !== 'NONE' ||
        isTicketCheckedIn(t)
    );
    const geoMatchedTotal = submittedPool.filter(t => getTicketProofStats(t).hasHouseValid).length;
    const geoCompliancePct =
      submittedPool.length > 0 ? Math.round((geoMatchedTotal / submittedPool.length) * 1000) / 10 : 0;

    const decidedPool = activeOperationalTickets.filter(t => {
      const st = getTicketCanonicalApprovalStatus(t);
      return st === 'APPROVED' || st === 'REVISION';
    });
    const approvedPool = decidedPool.filter(t => getTicketCanonicalApprovalStatus(t) === 'APPROVED').length;
    const ftrRatePct =
      decidedPool.length > 0 ? Math.round((approvedPool / decidedPool.length) * 1000) / 10 : 0;

    const completeProofPool = submittedPool.filter(t => getTicketProofStats(t).verifiedPointsCount === 3).length;
    const proofCompletePct =
      submittedPool.length > 0 ? Math.round((completeProofPool / submittedPool.length) * 1000) / 10 : 0;

    return {
      avgAgingMin,
      optimalUnder15,
      warning15To30,
      criticalOver30,
      targetMetPct,
      approvedToday,
      revisionToday,
      verifiedTodayTotal,
      approvedSharePct,
      geotagValidToday,
      geotagValidPct,
      geoCompliancePct,
      ftrRatePct,
      proofCompletePct
    };
  }, [queueBuckets.pendingList, todayTickets, activeOperationalTickets]);

  // Filtered queue list for left pane
  const displayedQueue = useMemo(() => {
    let base: Ticket[];
    if (criticalOnlyToggle || queueFilter === 'critical') {
      base = queueBuckets.criticalQueue;
    } else if (queueFilter === 'revision') {
      base = queueBuckets.revisionList;
    } else {
      base = queueBuckets.allQueue;
    }

    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;

    return base.filter(t => {
      const hay = [
        t.woNumber,
        t.customerName,
        t.idCustomer,
        t.address,
        t.streetName,
        t.area,
        t.installerName,
        t.contactorName,
        t.fatCode,
        t.fat,
        t.oltCode
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [criticalOnlyToggle, queueFilter, queueBuckets, searchQuery]);

  // Active selected ticket in Studio
  const selectedTicket = useMemo(() => {
    if (selectedTicketId) {
      const found =
        displayedQueue.find(t => t.id === selectedTicketId) ||
        activeOperationalTickets.find(t => t.id === selectedTicketId);
      if (found) return found;
    }
    return displayedQueue[0] || queueBuckets.pendingList[0] || activeOperationalTickets[0] || null;
  }, [selectedTicketId, displayedQueue, queueBuckets.pendingList, activeOperationalTickets]);

  // Sync decision notes, reschedule form & QC checklist when switching ticket
  useEffect(() => {
    if (!selectedTicket) return;
    const proof = getTicketProofStats(selectedTicket);
    const hasOntSync =
      hasText(selectedTicket.oltRegistrationStatus) ||
      hasText(proof.ontSerial) ||
      hasText(selectedTicket.oltCode);

    setDecisionError(null);
    setDecisionNotes(selectedTicket.remarksAgent || '');
    setSelectedWoAgentStatus(getRecommendedDispatchWoAgentStatus(selectedTicket));
    setFailedImages({});
    setShowReschedulePanel(false);
    setRescheduleDate(getTicketAppointmentDate(selectedTicket) || todayWIB);
    setRescheduleSlot(selectedTicket.slotTime || slotTimeOptions[0] || '09:00 - 11:00 WIB');
    setRescheduleReason('');
    setQcChecklist({
      facadeAndCable: proof.hasHouseValid,
      opticalAttenuation: proof.isOpmOptimal,
      dropcoreBarcodeAndFat: proof.hasFatOrOntProof,
      ontOnlineProvisioned: hasOntSync
    });
  }, [selectedTicket?.id, todayWIB, slotTimeOptions]);

  // Escape handler for Hot Desk QC modal & Photo Lightbox
  useEffect(() => {
    if (!hotDeskModalOpen && !zoomPhoto) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomPhoto) {
          setZoomPhoto(null);
        } else if (showReschedulePanel) {
          setShowReschedulePanel(false);
        } else if (hotDeskModalOpen) {
          setHotDeskModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotDeskModalOpen, zoomPhoto, showReschedulePanel]);

  // Selected ticket proofs + chat image attachments
  const selectedProof = useMemo(() => {
    if (!selectedTicket) return null;
    const baseProof = getTicketProofStats(selectedTicket);
    const msgs = getMessagesForTicket(selectedTicket.id);
    const extraPhotos: ZoomedPhotoState[] = [];
    const seen = new Set<string>();
    if (baseProof.housePhotoUrl) seen.add(baseProof.housePhotoUrl);
    if (baseProof.fatPhotoUrl) seen.add(baseProof.fatPhotoUrl);

    baseProof.slots.forEach((slot: TechnicalPhotoSlot, i: number) => {
      const safe = getSafePreviewUrl(slot.url);
      if (!safe || seen.has(safe)) return;
      seen.add(safe);
      extraPhotos.push({
        url: safe,
        title: slot.title || `Bukti Slot ${slot.slotKey || i + 1}`,
        subtitle: slot.capturedAtIso ? `${formatJakartaTimeOnly(slot.capturedAtIso)}` : slot.badgeText || 'Lampiran SOP',
        latitude: slot.latitude,
        longitude: slot.longitude,
        gpsAccuracyMeters: slot.gpsAccuracyMeters
      });
    });

    msgs.forEach(m => {
      (m.attachments || []).forEach((att, idx) => {
        const safe = getSafePreviewUrl(att.url);
        if (!safe || seen.has(safe)) return;
        const mime = String(att.mimeType || '').toLowerCase();
        const isImg = mime.startsWith('image/') || safe.startsWith('data:image/') || /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(safe);
        if (!isImg) return;
        seen.add(safe);
        extraPhotos.push({
          url: safe,
          title: att.fileName || `LiveChat Lampiran #${idx + 1}`,
          subtitle: `${m.senderName} · ${m.category || 'CHAT'}`
        });
      });
    });

    return {
      ...baseProof,
      extraPhotos
    };
  }, [selectedTicket, getMessagesForTicket]);

  // Cluster / OLT Hub Status computed strictly from real scopedTickets
  const clusterOltStats = useMemo(() => {
    const activeOlt =
      selectedTicket?.oltCode ||
      activeOperationalTickets.find(t => hasText(t.oltCode))?.oltCode ||
      '';
    const activeArea = selectedTicket?.area || '';
    const clusterTickets = activeOlt
      ? activeOperationalTickets.filter(t => String(t.oltCode || '').toLowerCase() === activeOlt.toLowerCase())
      : activeArea
      ? activeOperationalTickets.filter(t => String(t.area || '').toLowerCase() === activeArea.toLowerCase())
      : todayTickets;

    const completedInCluster = clusterTickets.filter(
      t => getTicketCanonicalApprovalStatus(t) === 'APPROVED' || isTicketClosed(t)
    ).length;

    const opmReadings = clusterTickets
      .map(t => parseNumericDbm(t.rosetRedamanDbm ?? t.technicalReport?.opticalPowerRx ?? t.technicalReport?.opticalPowerDbm))
      .filter((v): v is number => v !== null);

    const avgClusterDbm =
      opmReadings.length > 0
        ? (opmReadings.reduce((s, v) => s + v, 0) / opmReadings.length).toFixed(2)
        : null;

    const distinctFats = new Set(clusterTickets.map(t => t.fatCode || t.fat).filter(Boolean)).size;

    return {
      hubLabel: activeOlt || (activeArea ? `AREA-${activeArea.toUpperCase()}` : 'GLOBAL-FTTH'),
      totalClusterWo: clusterTickets.length,
      completedInCluster,
      avgClusterDbm,
      distinctFats
    };
  }, [selectedTicket, activeOperationalTickets, todayTickets]);

  const modalQueue = useMemo(() => {
    if (displayedQueue.length > 0) {
      if (selectedTicket && !displayedQueue.some(t => t.id === selectedTicket.id)) {
        return [selectedTicket, ...displayedQueue];
      }
      return displayedQueue;
    }
    if (selectedTicket) return [selectedTicket];
    return queueBuckets.allQueue;
  }, [displayedQueue, selectedTicket, queueBuckets.allQueue]);

  const modalQueueIndex = useMemo(() => {
    if (!selectedTicket || modalQueue.length === 0) return 0;
    const idx = modalQueue.findIndex(t => t.id === selectedTicket.id);
    return idx >= 0 ? idx : 0;
  }, [modalQueue, selectedTicket]);

  const handlePrevModalTicket = () => {
    if (modalQueueIndex <= 0) return;
    const prev = modalQueue[modalQueueIndex - 1];
    if (prev) setSelectedTicketId(prev.id);
  };

  const handleNextModalTicket = () => {
    if (modalQueueIndex >= modalQueue.length - 1) return;
    const next = modalQueue[modalQueueIndex + 1];
    if (next) setSelectedTicketId(next.id);
  };

  const handleJumpToHotDesk = () => {
    setCriticalOnlyToggle(false);
    setQueueFilter('all');
    const nextPending = queueBuckets.pendingList[0] || displayedQueue[0] || activeOperationalTickets[0];
    if (nextPending) {
      setSelectedTicketId(nextPending.id);
      setHotDeskModalOpen(true);
    } else {
      studioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast.info('Saat ini tidak ada Work Order pada antrean verifikasi.');
    }
  };

  const handleApproveSelected = async () => {
    if (!selectedTicket || !canManageApproval || isApproving || isRejecting || isRescheduling) return;
    if (selectedTicket.approvalStatus !== 'BUTUH APPROVAL') {
      setDecisionError('Tiket ini tidak berstatus BUTUH APPROVAL untuk disetujui.');
      return;
    }
    setDecisionError(null);
    setIsApproving(true);
    const currentId = selectedTicket.id;
    const res = await approveProgressReport(currentId, decisionNotes.trim() || undefined, {
      woAgentStatus: selectedWoAgentStatus,
      remarksAgent: decisionNotes.trim() || undefined
    });
    setIsApproving(false);

    if (res.success) {
      setDecisionNotes('');
      const nextPending = queueBuckets.pendingList.find(t => t.id !== currentId);
      setSelectedTicketId(nextPending ? nextPending.id : null);
      if (!nextPending && hotDeskModalOpen) {
        setHotDeskModalOpen(false);
      }
    } else if (res.error) {
      setDecisionError(res.error);
    }
  };

  const handleRequestRevisionSelected = async () => {
    if (!selectedTicket || !canManageApproval || isRejecting || isApproving || isRescheduling) return;
    if (decisionNotes.trim().length < 3) {
      setDecisionError('Mohon isi catatan / alasan revisi minimal 3 karakter sebelum mengirim permintaan revisi.');
      if (hotDeskModalOpen) {
        modalNotesInputRef.current?.focus();
      } else {
        notesInputRef.current?.focus();
      }
      return;
    }
    setDecisionError(null);
    setIsRejecting(true);
    const currentId = selectedTicket.id;
    const res = await rejectProgressReport(currentId, decisionNotes.trim());
    setIsRejecting(false);

    if (res.success) {
      setDecisionNotes('');
      const nextPending = queueBuckets.pendingList.find(t => t.id !== currentId);
      setSelectedTicketId(nextPending ? nextPending.id : null);
    } else if (res.error) {
      setDecisionError(res.error);
    }
  };

  const handleRescheduleSelected = () => {
    if (!selectedTicket || !canManageApproval || isRescheduling || isApproving || isRejecting) return;
    if (!rescheduleDate || !/^\d{4}-\d{2}-\d{2}$/.test(rescheduleDate)) {
      setDecisionError('Pilih tanggal appointment reschedule yang valid (YYYY-MM-DD).');
      return;
    }
    if (!rescheduleSlot.trim()) {
      setDecisionError('Pilih slot waktu kunjungan untuk jadwal ulang.');
      return;
    }

    setDecisionError(null);
    setIsRescheduling(true);

    const combinedNote = [
      `[Reschedule QC Dispatch ke ${rescheduleDate} (${rescheduleSlot})]`,
      rescheduleReason.trim() || decisionNotes.trim() || 'Dijadwalkan ulang dari Hot Desk QC Verifikasi'
    ].join(' ');

    const res = updateTicket(
      selectedTicket.id,
      {
        appointmentDate: rescheduleDate,
        slotTime: rescheduleSlot,
        statusWOAgent: 'Reschedule',
        statusWhatsApp: 'reschedule_requested',
        remarksAgent: combinedNote
      },
      `Dispatch QC Reschedule -> ${rescheduleDate} (${rescheduleSlot})`
    );

    setIsRescheduling(false);
    if (res.success) {
      setShowReschedulePanel(false);
      setRescheduleReason('');
      toast.success(
        `WO ${selectedTicket.woNumber} dijadwalkan ulang ke ${rescheduleDate} (${rescheduleSlot}).`,
        'Reschedule Tersimpan'
      );
    } else if (res.error) {
      setDecisionError(res.error);
    }
  };

  const handleCopyWo = async (woNumber: string) => {
    try {
      await navigator.clipboard.writeText(woNumber);
      toast.success(`WO Number ${woNumber} disalin ke clipboard.`);
    } catch {
      toast.info(`WO Number: ${woNumber}`);
    }
  };

  const selectedMapsUrl = selectedTicket ? buildGoogleMapsSearchUrl(selectedTicket).url : '';
  const selectedSubmittedAt = selectedTicket ? getLatestSubmittedTimestamp(selectedTicket) : undefined;
  const selectedWaitMin = getWaitingMinutes(selectedSubmittedAt);
  const checkedQcCount = Object.values(qcChecklist).filter(Boolean).length;
  const slaRemainingMins = selectedWaitMin !== null ? 30 - selectedWaitMin : 30;

  return (
    <section aria-label="Dispatch Verification Operations & QC Desk" className="space-y-6">
      {/* 1. Command Hub Header Bar */}
      <div className="w-full flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-1 rounded-full bg-[#EAE8FF] dark:bg-[#7135b5]/30 text-[#5145A6] dark:text-[#dab9ff] border border-[#DCE3F2] dark:border-transparent font-mono text-[11px] uppercase tracking-wider font-bold">
              QC Audit Desk • Stage 04
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                databaseStatus === 'connected'
                  ? 'bg-[#E4F5EC] dark:bg-emerald-500/10 text-[#218A63] dark:text-emerald-300 border border-[#B7E4CC] dark:border-transparent'
                  : 'bg-[#FFF2D9] dark:bg-amber-500/15 text-[#9D661F] dark:text-amber-300 border border-[#F2CF95] dark:border-transparent'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  databaseStatus === 'connected' ? 'bg-[#218A63] dark:bg-emerald-500 animate-pulse' : 'bg-[#C88735] dark:bg-amber-500'
                }`}
              />
              <span>
                {databaseStatus === 'connected' ? 'Ingest Engine Active' : `DB ${databaseStatus}`}
              </span>
            </span>
            <span className="px-2 py-0.5 rounded-full bg-[#DDF4F4] dark:bg-[#261447] text-[#2E7D8B] dark:text-[#dab9ff] border border-[#BDE4E8] dark:border-transparent font-mono text-[10.5px] font-bold tabular-nums">
              WIB: {todayWIB}
            </span>
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#26364A] dark:text-white tracking-tight leading-tight">
            Dispatch Command — Verification Operations &amp; QC Desk
          </h1>
          <p className="text-xs sm:text-sm text-[#52647A] dark:text-[#cabde8] max-w-3xl leading-relaxed">
            Verifikasi telemetri optik real-time, 3-point bukti foto lapangan, dan keputusan persetujuan penyelesaian Work Order.
          </p>
        </div>

        {/* 3D Tactile Header Actions */}
        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          <button
            type="button"
            onClick={() => {
              const next = !autoRefreshEnabled;
              setAutoRefreshEnabled(next);
              if (next) void handleManualRefresh();
            }}
            className={`px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-2 cursor-pointer ${
              autoRefreshEnabled
                ? 'btn-3d-lilac ring-1 ring-[#6657C8]/40 dark:bg-none dark:bg-[#35105e] dark:text-[#dab9ff] dark:border-[#7135b5]'
                : 'btn-3d-lilac dark:bg-none dark:bg-[#1e1238] dark:text-white dark:border-[#3b1d78]'
            }`}
            title="Aktifkan/nonaktifkan Auto-Refresh tiap 10 detik atau klik Refresh manual"
          >
            <RefreshCw
              className={`w-4 h-4 text-[#5145A6] dark:text-[#dab9ff] ${
                isRefreshingNow || isDataLoading || autoRefreshEnabled ? 'animate-spin' : ''
              }`}
            />
            <span>{autoRefreshEnabled ? 'Auto-Refresh ON (10s)' : 'Auto-Refresh (10s)'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const next = !criticalOnlyToggle;
              setCriticalOnlyToggle(next);
              setQueueFilter(next ? 'critical' : 'all');
            }}
            className={`px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-2 cursor-pointer ${
              criticalOnlyToggle
                ? 'btn-3d-crimson dark:bg-none dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700'
                : 'btn-3d-lilac dark:bg-none dark:bg-[#1e1238] dark:text-white dark:border-[#3b1d78]'
            }`}
          >
            <Filter className={`w-4 h-4 ${criticalOnlyToggle ? 'text-white dark:text-rose-400' : 'text-[#D45B66] dark:text-rose-400'}`} />
            <span>Filter Antrean Kritis</span>
            <span
              className={`w-2 h-2 rounded-full ${
                queueBuckets.criticalQueue.length > 0 ? 'bg-[#D45B66] dark:bg-[#ba1a1a] animate-pulse' : 'bg-[#AAB5C2] dark:bg-[#cec3d4]'
              }`}
            />
          </button>

          <button
            type="button"
            onClick={handleJumpToHotDesk}
            className="btn-3d-primary px-4 py-2.5 rounded-lg text-xs font-bold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Zap className="w-4 h-4 text-[#EAE8FF] dark:text-[#eedbff]" />
            <span>Buka Hot Desk Verifikasi ({queueBuckets.pendingList.length})</span>
          </button>
        </div>
      </div>

      {/* 2. Primary Tactile 5-Card KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {/* Hero Highlight Card: Menunggu Verifikasi (Light: Unified Aqua-Violet Glass; Night: Preserved) */}
        <button
          type="button"
          onClick={() => {
            setCriticalOnlyToggle(false);
            setQueueFilter('all');
            handleJumpToHotDesk();
          }}
          className="relative overflow-hidden text-left rounded-xl bg-gradient-to-br from-[#DDF4F4]/95 via-white/95 to-[#EAE8FF]/95 border border-[#BDE4E8] text-[#26364A] shadow-[0_8px_24px_rgba(101,184,196,0.16),inset_0_1px_0_rgba(255,255,255,0.9)] dark:border-transparent dark:from-[#7135b5] dark:via-[#58149c] dark:to-[#342b4e] dark:text-white dark:shadow-lg p-4 flex flex-col justify-between hover:-translate-y-0.5 transition-all cursor-pointer"
        >
          <div className="absolute -right-6 -bottom-6 w-32 h-32 rounded-full bg-[#65B8C4]/20 dark:bg-[#eedbff]/10 blur-xl pointer-events-none" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase font-bold text-[#2E7D8B] dark:text-[#eedbff] tracking-wider">
              MENUNGGU VERIFIKASI
            </span>
            <span className="px-2 py-0.5 rounded-full bg-white/85 border border-[#BDE4E8] text-[#2E7D8B] dark:border-transparent dark:bg-white/15 backdrop-blur dark:text-[#eedbff] text-[10.5px] font-bold flex items-center gap-1 shrink-0">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  queueBuckets.pendingList.length > 0 ? 'bg-[#C88735] dark:bg-amber-400 animate-pulse' : 'bg-[#218A63] dark:bg-emerald-400'
                }`}
              />
              <span>{queueBuckets.pendingList.length > 0 ? 'Priority' : 'Synced'}</span>
            </span>
          </div>

          <div className="py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-extrabold leading-none tracking-tight text-[#26364A] dark:text-white tabular-nums">
                {counts.butuhApproval}
              </span>
              <span className="text-sm font-bold text-[#5145A6] dark:text-[#dab9ff]">WO</span>
            </div>
            <p className="text-[11.5px] text-[#52647A] dark:text-[#dab9ff]/90 mt-1.5 tabular-nums">
              Backlog Aging Avg:{' '}
              {telemetryStats.avgAgingMin !== null ? `${telemetryStats.avgAgingMin} Menit` : '0 Menit'}
            </p>
          </div>

          <div className="pt-1 flex items-center gap-1.5 text-[#9D661F] dark:text-amber-200 text-[11px] font-semibold">
            <AlertTriangle className="w-3.5 h-3.5 text-[#C88735] dark:text-amber-300 shrink-0" />
            <span className="truncate tabular-nums">
              {queueBuckets.criticalQueue.length > 0
                ? `${queueBuckets.criticalQueue.length} Tiket Mendekati / Lewat SLA`
                : 'Belum ada antrean kritis SLA'}
            </span>
          </div>
        </button>

        {/* KPI 2: Verifikasi Hari Ini */}
        <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#52647A] dark:text-[#cabde8]">
            <span className="text-[11px] uppercase font-bold tracking-wider">VERIFIKASI HARI INI</span>
            <ShieldCheck className="w-5 h-5 text-[#6657C8] dark:text-[#dab9ff]" />
          </div>
          <div className="py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-extrabold leading-none tracking-tight text-[#26364A] dark:text-white tabular-nums">
                {telemetryStats.verifiedTodayTotal}
              </span>
              <span className="text-sm font-bold text-[#52647A] dark:text-[#cabde8]">WO</span>
            </div>
            <p className="text-[11.5px] text-[#52647A] dark:text-[#cabde8] mt-1.5 tabular-nums">
              {telemetryStats.approvedToday} Disetujui • {telemetryStats.revisionToday} Diminta Revisi
            </p>
          </div>
          <div className="w-full bg-[#EDF3F8] dark:bg-[#160d29] h-1.5 rounded-full overflow-hidden flex">
            <div
              className="bg-[#218A63] dark:bg-emerald-500 h-full transition-all"
              style={{ width: `${telemetryStats.approvedSharePct}%` }}
            />
            <div
              className="bg-[#C88735] dark:bg-amber-500 h-full transition-all"
              style={{ width: `${Math.max(0, 100 - telemetryStats.approvedSharePct)}%` }}
            />
          </div>
        </div>

        {/* KPI 3: WO Dalam Progress */}
        <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#52647A] dark:text-[#cabde8]">
            <span className="text-[11px] uppercase font-bold tracking-wider">WO DALAM PROGRESS</span>
            <GitBranch className="w-5 h-5 text-[#6657C8] dark:text-[#dab9ff]" />
          </div>
          <div className="py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-extrabold leading-none tracking-tight text-[#26364A] dark:text-white tabular-nums">
                {counts.checkedInProgress}
              </span>
              <span className="text-sm font-bold text-[#52647A] dark:text-[#cabde8]">WO</span>
            </div>
            <p className="text-[11.5px] text-[#52647A] dark:text-[#cabde8] mt-1.5">
              Penarikan dropcore / aktivasi ONT
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[#5145A6] dark:text-[#dab9ff] text-[11px] font-semibold">
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span>Live field dispatch tracking</span>
          </div>
        </div>

        {/* KPI 4: Check-in Valid (Rumah) */}
        <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between">
          <div className="flex items-center justify-between text-[#52647A] dark:text-[#cabde8]">
            <span className="text-[11px] uppercase font-bold tracking-wider">CHECK-IN VALID (RUMAH)</span>
            <MapPin className="w-5 h-5 text-[#218A63] dark:text-emerald-400" />
          </div>
          <div className="py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-extrabold leading-none tracking-tight text-[#26364A] dark:text-white tabular-nums">
                {telemetryStats.geotagValidToday}
              </span>
              <span className="text-sm font-bold text-[#52647A] dark:text-[#cabde8]">WO</span>
            </div>
            <p className="text-[11.5px] text-[#52647A] dark:text-[#cabde8] mt-1.5 tabular-nums">
              {telemetryStats.geotagValidPct}% matched optical geotag
            </p>
          </div>
          <div className="flex items-center gap-1 text-[#218A63] dark:text-emerald-300 text-[11px] font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>Foto Rumah &amp; PROGRESS valid</span>
          </div>
        </div>

        {/* KPI 5: Perlu Revisi Teknisi */}
        <button
          type="button"
          onClick={() => {
            setCriticalOnlyToggle(false);
            setQueueFilter('revision');
          }}
          className="text-left card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between cursor-pointer"
        >
          <div className="flex items-center justify-between text-[#52647A] dark:text-[#cabde8]">
            <span className="text-[11px] uppercase font-bold tracking-wider">PERLU REVISI TEKNISI</span>
            <RotateCcw className="w-5 h-5 text-[#C88735] dark:text-amber-400" />
          </div>
          <div className="py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="font-display text-4xl font-extrabold leading-none tracking-tight text-[#9D661F] dark:text-amber-300 tabular-nums">
                {String(counts.revisionRejected).padStart(2, '0')}
              </span>
              <span className="text-sm font-bold text-[#52647A] dark:text-[#cabde8]">WO</span>
            </div>
            <p className="text-[11.5px] text-[#52647A] dark:text-[#cabde8] mt-1.5">
              Redaman FAT/Dropcore &amp; bukti ulang
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[#9D661F] dark:text-amber-300 text-[11px] font-semibold">
            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
            <span>Dispatched for re-proof</span>
          </div>
        </button>
      </div>

      {/* 2B. Role Dispatch Canonical KPI Breakdown Strip (8 Live KPIs) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2.5 p-3 rounded-xl bg-white/85 dark:bg-[#1e1238] border border-[#DDE6F0] dark:border-[#3b1d78] shadow-sm backdrop-blur-md">
        {[
          { label: 'Total Ticket', value: `${counts.totalToday}`, sub: `WIB ${todayWIB}`, tone: 'text-[#26364A] dark:text-white' },
          { label: 'Waiting Verification', value: `${counts.butuhApproval}`, sub: 'Butuh Approval', tone: 'text-[#9D661F] dark:text-amber-300' },
          { label: 'Done', value: `${counts.approvedDone}`, sub: 'Approved - Done', tone: 'text-[#218A63] dark:text-emerald-300' },
          { label: 'Pending', value: `${counts.approvedPending}`, sub: 'Approved - Pending', tone: 'text-[#C88735] dark:text-amber-200' },
          { label: 'Reschedule', value: `${counts.approvedReschedule}`, sub: 'Approved - Resched', tone: 'text-[#6657C8] dark:text-[#dab9ff]' },
          { label: 'Cancel', value: `${counts.approvedCancel}`, sub: 'Approved - Cancel', tone: 'text-[#9B2C37] dark:text-rose-300' },
          { label: 'Approval Rate', value: `${counts.approvalRatePct}%`, sub: `${counts.approved}/${counts.totalToday} Closed`, tone: 'text-[#5145A6] dark:text-[#dab9ff]' },
          { label: 'Completion Rate', value: `${counts.completionRatePct}%`, sub: `${counts.approvedDone}/${counts.totalToday} Done`, tone: 'text-[#218A63] dark:text-emerald-300' }
        ].map(item => (
          <div
            key={item.label}
            className="px-3 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e]"
          >
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#cabde8] truncate">
              {item.label}
            </div>
            <div className={`font-display text-xl font-extrabold tabular-nums mt-0.5 ${item.tone}`}>
              {item.value}
            </div>
            <div className="text-[10px] text-[#8492A5] dark:text-[#cabde8]/80 truncate">
              {item.sub}
            </div>
          </div>
        ))}
      </div>

      {/* 3. Dedicated Verification Queue Hot Desk Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Pane: Verification Queue List (5 Columns) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Search & Filter Header Card */}
          <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-3 h-3 rounded-full bg-[#6657C8] dark:bg-[#7135b5] shrink-0" />
                <span className="font-display text-sm font-bold text-[#26364A] dark:text-white truncate">
                  Antrean Verifikasi Lapangan
                </span>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#35105e] text-[#5145A6] dark:text-[#dab9ff] font-mono text-[11px] font-bold shrink-0 tabular-nums">
                {displayedQueue.length} Aktif
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#8492A5] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari WO, Pelanggan, Teknisi, FAT..."
                aria-label="Cari antrean verifikasi"
                className="w-full pl-8 pr-7 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] text-xs text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/25"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Hapus pencarian"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8492A5] hover:text-[#5145A6] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Tabs */}
            <div className="grid grid-cols-3 gap-1 bg-[#EDF3F8] dark:bg-[#160d29] p-1 rounded-lg border border-[#DDE6F0] dark:border-[#35105e]">
              <button
                type="button"
                onClick={() => {
                  setCriticalOnlyToggle(false);
                  setQueueFilter('all');
                }}
                className={`py-1.5 px-2 text-center text-[11px] font-bold rounded transition-all cursor-pointer truncate ${
                  queueFilter === 'all' && !criticalOnlyToggle
                    ? 'bg-white dark:bg-[#2e1459] text-[#5145A6] dark:text-white shadow-sm'
                    : 'text-[#52647A] dark:text-[#cabde8] hover:text-[#26364A] dark:hover:text-white'
                }`}
              >
                Semua ({queueBuckets.allQueue.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setCriticalOnlyToggle(false);
                  setQueueFilter('critical');
                }}
                className={`py-1.5 px-2 text-center text-[11px] font-bold rounded transition-all cursor-pointer truncate ${
                  queueFilter === 'critical' || criticalOnlyToggle
                    ? 'bg-white dark:bg-[#2e1459] text-[#9B2C37] dark:text-rose-300 shadow-sm'
                    : 'text-[#52647A] dark:text-[#cabde8] hover:text-[#26364A] dark:hover:text-white'
                }`}
              >
                Kritis SLA ({queueBuckets.criticalQueue.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setCriticalOnlyToggle(false);
                  setQueueFilter('revision');
                }}
                className={`py-1.5 px-2 text-center text-[11px] font-bold rounded transition-all cursor-pointer truncate ${
                  queueFilter === 'revision'
                    ? 'bg-white dark:bg-[#2e1459] text-[#9D661F] dark:text-amber-300 shadow-sm'
                    : 'text-[#52647A] dark:text-[#cabde8] hover:text-[#26364A] dark:hover:text-white'
                }`}
              >
                Revisi Baru ({queueBuckets.revisionList.length})
              </button>
            </div>
          </div>

          {/* Ticket Queue Cards */}
          <div className="flex flex-col gap-3">
            {displayedQueue.length === 0 ? (
              <div className="bg-white/90 dark:bg-[#1e1238] rounded-xl p-6 text-center border border-[#DDE6F0] dark:border-[#3b1d78] space-y-2">
                <CheckCircle2 className="w-8 h-8 text-[#218A63] dark:text-emerald-500 mx-auto" />
                <p className="text-sm font-bold text-[#26364A] dark:text-white">
                  Antrean Verifikasi Bersih
                </p>
                <p className="text-xs text-[#52647A] dark:text-[#cabde8]">
                  Tidak ada Work Order yang cocok dengan filter antrean saat ini.
                </p>
              </div>
            ) : (
              displayedQueue.slice(0, queueLimit).map(ticket => {
                const isSelected = selectedTicket?.id === ticket.id;
                const appStat = getTicketCanonicalApprovalStatus(ticket);
                const waitMin = getWaitingMinutes(getLatestSubmittedTimestamp(ticket));
                const isCriticalSla = appStat === 'BUTUH APPROVAL' && waitMin !== null && waitMin >= 15;
                const proof = getTicketProofStats(ticket);

                return (
                  <div
                    key={ticket.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedTicketId(ticket.id)}
                    onDoubleClick={() => {
                      setSelectedTicketId(ticket.id);
                      setHotDeskModalOpen(true);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedTicketId(ticket.id);
                      }
                    }}
                    className={`w-full text-left rounded-xl p-4 transition-all cursor-pointer border focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5] ${
                      isSelected
                        ? 'bg-gradient-to-r from-[#DDF4F4]/70 via-white to-[#EAE8FF]/60 dark:from-[#35105e] dark:via-[#1e1238] dark:to-[#1e1238] border-[#6657C8] dark:border-[#7135b5] shadow-md ring-1 ring-[#6657C8]/30 dark:ring-[#7135b5]/40'
                        : isCriticalSla
                        ? 'bg-[#FCE9EB]/55 dark:bg-rose-950/20 border-[#F3C5CA] dark:border-rose-900/60 shadow-sm hover:shadow-md'
                        : 'bg-white/90 dark:bg-[#1e1238] border-[#DDE6F0] dark:border-[#3b1d78] shadow-sm hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 pb-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10.5px] font-bold ${
                            isSelected
                              ? 'bg-[#6657C8] dark:bg-[#7135b5] text-white'
                              : isCriticalSla
                              ? 'bg-[#FCE9EB] text-[#9B2C37] dark:bg-rose-900/70 dark:text-rose-200'
                              : 'bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff]'
                          }`}
                        >
                          #{ticket.woNumber}
                        </span>

                        {appStat === 'BUTUH APPROVAL' ? (
                          isCriticalSla ? (
                            <span className="px-2 py-0.5 rounded bg-[#D45B66] dark:bg-[#ba1a1a] text-white text-[10px] font-bold inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>SLA KRITIS</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-[#FFF2D9] dark:bg-amber-500/15 text-[#9D661F] dark:text-amber-200 text-[10.5px] font-semibold inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#C88735] dark:bg-amber-500 animate-pulse" />
                              <span>Menunggu Approval</span>
                            </span>
                          )
                        ) : (
                          <StatusApprovalBadge status={ticket.approvalStatus} />
                        )}
                      </div>

                      <span
                        className={`text-[11px] font-bold shrink-0 tabular-nums ${
                          isCriticalSla
                            ? 'text-[#9B2C37] dark:text-rose-300'
                            : appStat === 'APPROVED'
                            ? 'text-[#218A63] dark:text-emerald-300'
                            : 'text-[#5145A6] dark:text-[#dab9ff]'
                        }`}
                      >
                        {formatRelativeMinutes(waitMin)}
                      </span>
                    </div>

                    <h3 className="font-display text-sm sm:text-[15px] font-bold text-[#26364A] dark:text-white tracking-tight truncate">
                      {ticket.customerName}
                    </h3>

                    <p className="text-xs text-[#52647A] dark:text-[#cabde8] flex items-start gap-1 mt-1 leading-snug">
                      <MapPin className="w-3.5 h-3.5 text-[#8492A5] shrink-0 mt-0.5" />
                      <span className="line-clamp-2">
                        {ticket.address || ticket.streetName || '-'}
                        {ticket.area ? `, ${ticket.area}` : ''}
                      </span>
                    </p>

                    <div className="mt-3 pt-2 border-t border-[#DDE6F0] dark:border-[#35105e] flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-[#EAE8FF] dark:bg-[#7135b5]/40 flex items-center justify-center text-[#5145A6] dark:text-[#dab9ff] font-bold text-[10px] shrink-0">
                          {getInitials(ticket.installerName)}
                        </div>
                        <span className="font-medium text-[#26364A] dark:text-white truncate">
                          {ticket.installerName || 'Belum Assign'}
                          {ticket.contactorName ? ` (${ticket.contactorName})` : ''}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div
                          className={`flex items-center gap-1 font-bold tabular-nums ${
                            proof.verifiedPointsCount === 3
                              ? 'text-[#218A63] dark:text-emerald-300'
                              : proof.hasOpmProof
                              ? 'text-[#5145A6] dark:text-[#dab9ff]'
                              : 'text-[#9D661F] dark:text-amber-300'
                          }`}
                        >
                          {proof.verifiedPointsCount === 3 ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>3/3 Bukti</span>
                            </>
                          ) : (
                            <>
                              <Camera className="w-3.5 h-3.5" />
                              <span>{proof.verifiedPointsCount}/3 Bukti</span>
                            </>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedTicketId(ticket.id);
                            setHotDeskModalOpen(true);
                          }}
                          className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105e] hover:bg-[#6657C8] dark:hover:bg-[#7135b5] hover:text-white text-[#5145A6] dark:text-[#dab9ff] text-[10px] font-bold transition-colors cursor-pointer whitespace-nowrap"
                          title="Buka Hot Desk QC Modal"
                        >
                          Hot Desk
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}

            {displayedQueue.length > queueLimit && (
              <button
                type="button"
                onClick={() => setQueueLimit(prev => prev + 15)}
                className="btn-3d-lilac w-full py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                Tampilkan Lebih Banyak ({displayedQueue.length - queueLimit} tersisa)
              </button>
            )}
          </div>

          {/* Quick SLA Verification Aging Distribution Card */}
          <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase font-bold text-[#52647A] dark:text-[#cabde8] tracking-wider">
                SLA Verification Aging Distribution
              </span>
              <span className="text-[11px] text-[#5145A6] dark:text-[#dab9ff] font-bold tabular-nums">
                {telemetryStats.targetMetPct}% Target Met
              </span>
            </div>

            <div className="space-y-2.5">
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-2 text-[#26364A] dark:text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#218A63] dark:bg-emerald-500" />
                    <span>&lt; 15 Menit (Optimal)</span>
                  </span>
                  <span className="font-bold text-[#26364A] dark:text-white tabular-nums">
                    {telemetryStats.optimalUnder15} WO
                  </span>
                </div>
                <div className="w-full bg-[#EDF3F8] dark:bg-[#160d29] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#218A63] dark:bg-emerald-500 h-full transition-all"
                    style={{
                      width: `${
                        queueBuckets.pendingList.length > 0
                          ? Math.round((telemetryStats.optimalUnder15 / queueBuckets.pendingList.length) * 100)
                          : 0
                      }%`
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-2 text-[#26364A] dark:text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#C88735] dark:bg-amber-500" />
                    <span>15 - 30 Menit (Waspada)</span>
                  </span>
                  <span className="font-bold text-[#26364A] dark:text-white tabular-nums">
                    {telemetryStats.warning15To30} WO
                  </span>
                </div>
                <div className="w-full bg-[#EDF3F8] dark:bg-[#160d29] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#C88735] dark:bg-amber-500 h-full transition-all"
                    style={{
                      width: `${
                        queueBuckets.pendingList.length > 0
                          ? Math.round((telemetryStats.warning15To30 / queueBuckets.pendingList.length) * 100)
                          : 0
                      }%`
                    }}
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-2 text-[#26364A] dark:text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#D45B66] dark:bg-[#ba1a1a]" />
                    <span>&gt; 30 Menit (Kritis SLA)</span>
                  </span>
                  <span className="font-bold text-[#9B2C37] dark:text-rose-300 tabular-nums">
                    {telemetryStats.criticalOver30} WO
                  </span>
                </div>
                <div className="w-full bg-[#EDF3F8] dark:bg-[#160d29] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#D45B66] dark:bg-[#ba1a1a] h-full transition-all"
                    style={{
                      width: `${
                        queueBuckets.pendingList.length > 0
                          ? Math.round((telemetryStats.criticalOver30 / queueBuckets.pendingList.length) * 100)
                          : 0
                      }%`
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Pane: Live Inspection & Decision Studio (7 Columns) */}
        <div ref={studioRef} className="lg:col-span-7 flex flex-col gap-5">
          {!selectedTicket || !selectedProof ? (
            <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-10 text-center space-y-3">
              <ShieldCheck className="w-12 h-12 text-[#6657C8] dark:text-[#dab9ff] mx-auto" />
              <h2 className="font-display text-lg font-bold text-[#26364A] dark:text-white">
                Pilih Work Order untuk Verifikasi QC
              </h2>
              <p className="text-xs text-[#52647A] dark:text-[#cabde8] max-w-md mx-auto">
                Klik salah satu tiket dari antrean di sebelah kiri untuk menginspeksi foto rumah, bacaan OPM redaman, labeling ODP/FAT, dan menjalankan keputusan Approval Dispatch.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('tickets')}
                className="btn-3d-primary px-4 py-2 rounded-lg text-xs font-bold cursor-pointer"
              >
                Buka Daftar Work Orders
              </button>
            </div>
          ) : (
            <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-5 sm:p-6 flex flex-col gap-5">
              {/* Inspector Head */}
              <div className="flex flex-col md:flex-row md:items-start justify-between pb-5 gap-4 bg-[#F8FAFD] dark:bg-[#160d29] -m-5 sm:-m-6 mb-0 p-5 sm:p-6 rounded-t-xl border-b border-[#DDE6F0] dark:border-[#35105e]">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyWo(selectedTicket.woNumber)}
                      title="Salin WO Number"
                      className="btn-3d-primary px-2.5 py-1 rounded text-xs font-mono font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>{selectedTicket.woNumber}</span>
                      <Copy className="w-3 h-3 opacity-80" />
                    </button>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5 ${
                        selectedProof.houseGeoStatus === 'valid' || selectedProof.hasHouseGeo
                          ? 'bg-[#E4F5EC] dark:bg-emerald-500/15 text-[#218A63] dark:text-emerald-300'
                          : selectedProof.houseGeoStatus === 'weak'
                          ? 'bg-[#FFF2D9] dark:bg-amber-500/15 text-[#9D661F] dark:text-amber-300'
                          : 'bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff]'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          selectedProof.houseGeoStatus === 'valid' || selectedProof.hasHouseGeo
                            ? 'bg-[#218A63] dark:bg-emerald-500'
                            : 'bg-[#C88735] dark:bg-amber-500'
                        }`}
                      />
                      <span>
                        {selectedProof.hasHouseGeo
                          ? typeof selectedProof.houseAcc === 'number'
                            ? `Geotag Valid (±${Math.round(selectedProof.houseAcc)}m)`
                            : 'Geotag Validated'
                          : 'Menunggu Geotag GPS'}
                      </span>
                    </span>

                    <StatusApprovalBadge status={selectedTicket.approvalStatus} />
                    <StatusInstallerBadge status={selectedTicket.statusWOInstaller} />
                    <StatusAgentBadge status={selectedTicket.statusWOAgent} />
                    {isTicketClosed(selectedTicket) && (
                      <span className="px-2 py-0.5 rounded-full bg-[#26364A] text-white dark:bg-slate-200 dark:text-slate-900 text-[10px] font-bold">
                        Ticket: Closed
                      </span>
                    )}
                  </div>

                  <div>
                    <h2 className="font-display text-xl font-extrabold text-[#26364A] dark:text-white tracking-tight">
                      {selectedTicket.customerName}
                    </h2>
                    <div className="text-xs sm:text-sm text-[#52647A] dark:text-[#cabde8] flex items-start gap-1.5 mt-1">
                      <MapPin className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff] shrink-0 mt-0.5" />
                      <span className="leading-snug">
                        {selectedTicket.address || selectedTicket.streetName || '-'}
                        {selectedTicket.clusterName ? ` (${selectedTicket.clusterName}` : ''}
                        {selectedTicket.area
                          ? selectedTicket.clusterName
                            ? ` / ${selectedTicket.area})`
                            : ` (Area ${selectedTicket.area})`
                          : selectedTicket.clusterName
                          ? ')'
                          : ''}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setHotDeskModalOpen(true)}
                        className="btn-3d-primary inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer"
                      >
                        <Maximize2 className="w-3 h-3" />
                        <span>Buka Hot Desk QC Modal</span>
                      </button>
                      {selectedMapsUrl && (
                        <a
                          href={selectedMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-[#22123f] border border-[#DDE6F0] dark:border-[#3b1d78] text-[11px] font-bold text-[#5145A6] dark:text-[#dab9ff] hover:border-[#6657C8] dark:hover:border-[#7135b5] transition-colors"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Buka Google Maps</span>
                        </a>
                      )}
                      {onSelectTicket && (
                        <button
                          type="button"
                          onClick={() => onSelectTicket(selectedTicket, 'overview')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white dark:bg-[#22123f] border border-[#DDE6F0] dark:border-[#3b1d78] text-[11px] font-bold text-[#26364A] dark:text-white hover:border-[#6657C8] dark:hover:border-[#7135b5] transition-colors cursor-pointer"
                        >
                          <Eye className="w-3 h-3 text-[#5145A6] dark:text-[#dab9ff]" />
                          <span>Detail 17-Section</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex md:flex-col items-start md:items-end justify-between text-left md:text-right gap-1 shrink-0">
                  <span className="text-[10.5px] uppercase text-[#8492A5] dark:text-[#cabde8] font-bold tracking-wider">
                    Paket / Layanan
                  </span>
                  <span className="text-sm font-extrabold text-[#5145A6] dark:text-[#dab9ff]">
                    {selectedTicket.serviceType || selectedTicket.plan || selectedTicket.ticketCategory || 'FTTH Install'}
                  </span>
                  <span className="text-[11px] font-mono text-[#52647A] dark:text-[#cabde8]">
                    {selectedTicket.ontModel ||
                      selectedTicket.ontBrand ||
                      selectedTicket.router ||
                      (selectedProof.ontSerial ? `SN: ${selectedProof.ontSerial}` : `Cust ID: ${selectedTicket.idCustomer || '-'}`)}
                  </span>
                  {selectedWaitMin !== null && (
                    <span className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#cabde8] tabular-nums">
                      Aging: {selectedWaitMin} menit
                    </span>
                  )}
                </div>
              </div>

              {/* 3-Point Photographic Field Proof Checklist */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-display text-sm sm:text-base font-bold text-[#26364A] dark:text-white">
                    Photographic Field Proof — 3-Point Verification Checklist
                  </span>
                  <span
                    className={`text-[11px] font-bold px-2.5 py-0.5 rounded tabular-nums ${
                      selectedProof.verifiedPointsCount === 3
                        ? 'text-[#218A63] bg-[#E4F5EC] dark:bg-emerald-500/15 dark:text-emerald-300'
                        : 'text-[#9D661F] bg-[#FFF2D9] dark:bg-amber-500/15 dark:text-amber-300'
                    }`}
                  >
                    {selectedProof.verifiedPointsCount} of 3 Requirements Verified
                  </span>
                </div>

                {/* Proof Item 1: Foto Rumah Pelanggan & Geotag */}
                <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] p-4 flex flex-col md:flex-row gap-4 items-center">
                  <div className="relative w-full md:w-48 h-36 rounded-lg overflow-hidden shrink-0 shadow-sm bg-[#EDF3F8] dark:bg-[#22123f] group">
                    {selectedProof.housePhotoUrl && !failedImages['house'] ? (
                      <button
                        type="button"
                        onClick={() =>
                          setZoomPhoto({
                            url: selectedProof.housePhotoUrl!,
                            title: 'Foto Rumah Pelanggan & Peneng Jalan',
                            subtitle: `${selectedTicket.woNumber} · ${selectedTicket.customerName}`,
                            latitude: selectedProof.houseLat,
                            longitude: selectedProof.houseLng,
                            gpsAccuracyMeters: selectedProof.houseAcc
                          })
                        }
                        className="w-full h-full block cursor-pointer relative"
                        title="Klik untuk memperbesar Foto Rumah"
                      >
                        <img
                          src={selectedProof.housePhotoUrl}
                          alt={`Foto Rumah ${selectedTicket.customerName}`}
                          referrerPolicy="no-referrer"
                          onError={() => setFailedImages(prev => ({ ...prev, house: true }))}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-[#26364A]/85 dark:bg-[#342b4e]/85 text-white font-mono text-[10px] inline-flex items-center gap-1">
                          <ZoomIn className="w-3 h-3" />
                          <span>Zoom</span>
                        </div>
                      </button>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-[#8492A5] dark:text-[#cabde8] p-3 text-center gap-1.5">
                        <ImageOff className="w-6 h-6 opacity-70" />
                        <span className="text-[11px] font-semibold">Belum Ada Foto Rumah</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col gap-1.5 w-full min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-full text-white flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            selectedProof.hasHouseValid ? 'bg-[#218A63] dark:bg-emerald-500' : 'bg-[#C88735] dark:bg-amber-500'
                          }`}
                        >
                          1
                        </span>
                        <span className="font-display text-sm font-bold text-[#26364A] dark:text-white truncate">
                          Foto Rumah Pelanggan &amp; Geotag
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10.5px] font-bold inline-flex items-center gap-1 shrink-0 ${
                          selectedProof.hasHouseValid
                            ? 'bg-[#E4F5EC] dark:bg-emerald-500/15 text-[#218A63] dark:text-emerald-300'
                            : 'bg-[#FFF2D9] dark:bg-amber-500/15 text-[#9D661F] dark:text-amber-300'
                        }`}
                      >
                        {selectedProof.hasHouseValid ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        <span>{selectedProof.hasHouseValid ? 'PASS SOP' : 'MENUNGGU BUKTI'}</span>
                      </span>
                    </div>

                    <p className="text-xs text-[#52647A] dark:text-[#cabde8] leading-relaxed">
                      {selectedTicket.technicalReport?.technicalDescription ||
                        selectedTicket.remarksWOInstaller ||
                        selectedTicket.houseLocation?.fieldNotes ||
                        'Foto tampak depan rumah pelanggan beserta titik koordinat GPS lapangan.'}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-[#52647A] dark:text-[#cabde8] font-mono">
                      <span className="inline-flex items-center gap-1 bg-white dark:bg-[#22123f] px-2 py-0.5 rounded border border-[#DDE6F0] dark:border-[#3b1d78]">
                        <Satellite className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                        <span>
                          {selectedProof.hasHouseGeo
                            ? formatCoordinates(selectedProof.houseLat!, selectedProof.houseLng!)
                            : 'GPS belum tercatat'}
                        </span>
                      </span>

                      {typeof selectedProof.houseAcc === 'number' && (
                        <span className="inline-flex items-center gap-1 bg-white dark:bg-[#22123f] px-2 py-0.5 rounded border border-[#DDE6F0] dark:border-[#3b1d78]">
                          <Ruler className="w-3.5 h-3.5 text-[#218A63] dark:text-emerald-600" />
                          <span>Deviasi ±{Math.round(selectedProof.houseAcc)}m</span>
                        </span>
                      )}

                      <span className="inline-flex items-center gap-1 bg-white dark:bg-[#22123f] px-2 py-0.5 rounded border border-[#DDE6F0] dark:border-[#3b1d78]">
                        <Clock className="w-3.5 h-3.5 text-[#8492A5]" />
                        <span>
                          {formatJakartaTimeOnly(
                            selectedProof.houseSlot?.capturedAtIso ||
                              selectedTicket.houseLocation?.capturedAt ||
                              selectedTicket.checkInAt
                          )}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Proof Item 2: Pengukuran Redaman Optik (OPM Roset) */}
                <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] p-4 flex flex-col md:flex-row gap-4 items-center">
                  <div className="relative w-full md:w-48 h-36 rounded-lg overflow-hidden shrink-0 shadow-sm bg-gradient-to-br from-[#EDF3F8] to-[#DDF4F4] border border-[#BDE4E8] text-[#26364A] dark:bg-none dark:bg-[#0f081e] dark:border-transparent dark:text-white flex flex-col items-center justify-center p-3">
                    <span className="text-[10px] text-[#2E7D8B] dark:text-[#eedbff] uppercase tracking-wider font-semibold">
                      OPM Telemetry Readout
                    </span>
                    <div className="flex items-baseline gap-1 my-1.5">
                      <span
                        className={`font-display text-3xl font-extrabold leading-none tabular-nums ${
                          selectedProof.numericOpm === null
                            ? 'text-[#8492A5] dark:text-[#cabde8]'
                            : selectedProof.isOpmOptimal
                            ? 'text-[#218A63] dark:text-emerald-400'
                            : 'text-[#C88735] dark:text-amber-300'
                        }`}
                      >
                        {selectedProof.numericOpm !== null ? selectedProof.numericOpm.toFixed(2) : '--'}
                      </span>
                      <span className="text-sm font-bold text-[#218A63] dark:text-emerald-200">dBm</span>
                    </div>
                    <div className="text-[11px] text-[#5145A6] dark:text-[#e1bfff] flex items-center gap-1">
                      <Activity className="w-3.5 h-3.5" />
                      <span>Roset Rx Power</span>
                    </div>
                    {selectedProof.opmSlot?.url && getSafePreviewUrl(selectedProof.opmSlot.url) ? (
                      <button
                        type="button"
                        onClick={() =>
                          setZoomPhoto({
                            url: getSafePreviewUrl(selectedProof.opmSlot!.url)!,
                            title: 'Foto Pengukuran OPM Roset',
                            subtitle: `${selectedTicket.woNumber} · ${selectedProof.numericOpm ?? '-'} dBm`
                          })
                        }
                        className="mt-2 w-full bg-white/85 hover:bg-white text-[#2E7D8B] border border-[#BDE4E8] dark:border-transparent dark:bg-white/15 dark:hover:bg-white/25 rounded px-2 py-0.5 text-center text-[10px] font-bold dark:text-white cursor-pointer transition-colors"
                      >
                        Lihat Foto OPM
                      </button>
                    ) : (
                      <div className="mt-2 w-full bg-white/70 text-[#52647A] border border-[#DDE6F0] dark:border-transparent dark:bg-black/25 rounded px-2 py-0.5 text-center text-[9.5px] dark:text-[#cabde8]">
                        {selectedTicket.fatRedamanDbm ? `FAT: ${selectedTicket.fatRedamanDbm} dBm` : 'Ambang: -15 s/d -25 dBm'}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col gap-1.5 w-full min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-full text-white flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            selectedProof.isOpmOptimal
                              ? 'bg-[#218A63] dark:bg-emerald-500'
                              : selectedProof.hasOpmProof
                              ? 'bg-[#C88735] dark:bg-amber-500'
                              : 'bg-[#8492A5] dark:bg-[#7d7484]'
                          }`}
                        >
                          2
                        </span>
                        <span className="font-display text-sm font-bold text-[#26364A] dark:text-white truncate">
                          Pengukuran Redaman Optik (OPM Roset)
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10.5px] font-bold inline-flex items-center gap-1 shrink-0 ${
                          selectedProof.isOpmOptimal
                            ? 'bg-[#E4F5EC] dark:bg-emerald-500/15 text-[#218A63] dark:text-emerald-300'
                            : selectedProof.hasOpmProof
                            ? 'bg-[#FFF2D9] dark:bg-amber-500/15 text-[#9D661F] dark:text-amber-300'
                            : 'bg-[#EAE8FF] dark:bg-[#2e1459] text-[#52647A] dark:text-[#cabde8]'
                        }`}
                      >
                        {selectedProof.isOpmOptimal ? (
                          <>
                            <Check className="w-3 h-3" />
                            <span>OPTIMAL</span>
                          </>
                        ) : selectedProof.hasOpmProof ? (
                          <span>PERLU CEK</span>
                        ) : (
                          <span>BELUM DIUKUR</span>
                        )}
                      </span>
                    </div>

                    <p className="text-xs text-[#52647A] dark:text-[#cabde8] leading-relaxed">
                      {selectedProof.numericOpm !== null
                        ? `Redaman akhir di roset pelanggan terukur ${selectedProof.numericOpm.toFixed(2)} dBm (standar toleransi MoraJaws -15.00 dBm s/d -25.00 dBm).`
                        : 'Teknisi belum mengisi nilai redaman optik (OPM) di roset pelanggan.'}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-[#52647A] dark:text-[#cabde8] font-mono">
                      <span className="inline-flex items-center gap-1 bg-white dark:bg-[#22123f] px-2 py-0.5 rounded border border-[#DDE6F0] dark:border-[#3b1d78]">
                        <Activity className="w-3.5 h-3.5 text-[#218A63] dark:text-emerald-600" />
                        <span>
                          Dropcore: {selectedTicket.dropcoreLengthMeter ?? selectedTicket.dropcoreLength ?? '-'} m
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 bg-white dark:bg-[#22123f] px-2 py-0.5 rounded border border-[#DDE6F0] dark:border-[#3b1d78]">
                        <Network className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                        <span>
                          {selectedTicket.oltRegistrationStatus || (selectedTicket.oltCode ? `OLT: ${selectedTicket.oltCode}` : 'ONT Status -')}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Proof Item 3: Labeling Dropcore & Port ODP / FAT */}
                <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] p-4 flex flex-col md:flex-row gap-4 items-center">
                  <div className="relative w-full md:w-48 h-36 rounded-lg overflow-hidden shrink-0 shadow-sm bg-[#EDF3F8] dark:bg-[#22123f] group">
                    {selectedProof.fatPhotoUrl && !failedImages['fat'] ? (
                      <button
                        type="button"
                        onClick={() =>
                          setZoomPhoto({
                            url: selectedProof.fatPhotoUrl!,
                            title: 'Labeling Dropcore & Port ODP / FAT',
                            subtitle: `${selectedProof.fatLabel || 'FAT'} · SN ${selectedProof.ontSerial || '-'}`,
                            latitude: selectedProof.fatSlot?.latitude ?? selectedTicket.fatLocation?.latitude,
                            longitude: selectedProof.fatSlot?.longitude ?? selectedTicket.fatLocation?.longitude
                          })
                        }
                        className="w-full h-full block cursor-pointer relative"
                        title="Klik untuk memperbesar Foto ODP / FAT"
                      >
                        <img
                          src={selectedProof.fatPhotoUrl}
                          alt="Foto ODP FAT & Dropcore"
                          referrerPolicy="no-referrer"
                          onError={() => setFailedImages(prev => ({ ...prev, fat: true }))}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        {selectedProof.fatLabel && (
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-[#6657C8] dark:bg-[#58149c] text-white font-mono text-[10px] font-bold">
                            {selectedProof.fatLabel}
                          </div>
                        )}
                      </button>
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-[#8492A5] dark:text-[#cabde8] p-3 text-center gap-1.5">
                        <ImageOff className="w-6 h-6 opacity-70" />
                        <span className="text-[11px] font-semibold">Belum Ada Foto FAT / SN</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 flex flex-col gap-1.5 w-full min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-5 h-5 rounded-full text-white flex items-center justify-center text-[11px] font-bold shrink-0 ${
                            selectedProof.hasFatOrOntProof ? 'bg-[#218A63] dark:bg-emerald-500' : 'bg-[#C88735] dark:bg-amber-500'
                          }`}
                        >
                          3
                        </span>
                        <span className="font-display text-sm font-bold text-[#26364A] dark:text-white truncate">
                          Labeling Dropcore, Port ODP/FAT &amp; SN ONT
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10.5px] font-bold inline-flex items-center gap-1 shrink-0 ${
                          selectedProof.hasFatOrOntProof
                            ? 'bg-[#E4F5EC] dark:bg-emerald-500/15 text-[#218A63] dark:text-emerald-300'
                            : 'bg-[#FFF2D9] dark:bg-amber-500/15 text-[#9D661F] dark:text-amber-300'
                        }`}
                      >
                        {selectedProof.hasFatOrOntProof ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        <span>{selectedProof.hasFatOrOntProof ? 'VALID TAG' : 'MENUNGGU BUKTI'}</span>
                      </span>
                    </div>

                    <p className="text-xs text-[#52647A] dark:text-[#cabde8] leading-relaxed">
                      {selectedTicket.technicalReport?.correctiveAction ||
                        (selectedProof.fatLabel
                          ? `ODP/FAT ${selectedProof.fatLabel}${selectedTicket.fatPort ? ` Port #${selectedTicket.fatPort}` : ''} tercatat dengan perangkat ONT ${selectedProof.ontSerial || '-'}.`
                          : 'Dokumentasi ODP/FAT, port dropcore, dan barcode Serial Number ONT.')}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-[#52647A] dark:text-[#cabde8] font-mono">
                      <span className="inline-flex items-center gap-1 bg-white dark:bg-[#22123f] px-2 py-0.5 rounded border border-[#DDE6F0] dark:border-[#3b1d78]">
                        <Network className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                        <span>
                          {selectedProof.fatLabel || 'FAT -'}
                          {selectedTicket.fatPort ? ` / Port ${selectedTicket.fatPort}` : ''}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 bg-white dark:bg-[#22123f] px-2 py-0.5 rounded border border-[#DDE6F0] dark:border-[#3b1d78]">
                        <QrCode className="w-3.5 h-3.5 text-[#8492A5]" />
                        <span>SN: {selectedProof.ontSerial || '-'}</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Extra Uploaded Photos Strip (if any additional photoSlots or LiveChat images exist) */}
                {selectedProof.extraPhotos.length > 0 && (
                  <div className="pt-1">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#cabde8] mb-2">
                      Bukti Tambahan Terunggah ({selectedProof.extraPhotos.length})
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedProof.extraPhotos.map((p, idx) => (
                        <button
                          key={`${p.url}-${idx}`}
                          type="button"
                          onClick={() => setZoomPhoto(p)}
                          className="group relative w-20 h-16 rounded-lg overflow-hidden border border-[#DDE6F0] dark:border-[#3b1d78] bg-[#F8FAFD] dark:bg-[#160d29] cursor-pointer"
                          title={`${p.title} — ${p.subtitle}`}
                        >
                          <img src={p.url} alt={p.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 bg-[#26364A]/80 dark:bg-[#1f1638]/75 text-[9px] text-white px-1 py-0.5 truncate">
                            {p.title}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Technician Device & Field Telemetry Bar */}
              <div className="rounded-xl bg-[#EAE8FF]/70 dark:bg-[#22123f] border border-[#DCE3F2] dark:border-[#3b1d78] p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-white dark:bg-[#160d29] flex items-center justify-center shadow-xs text-[#5145A6] dark:text-[#dab9ff] font-bold text-xs shrink-0">
                    {getInitials(selectedTicket.installerName)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-[#26364A] dark:text-white truncate">
                      {selectedTicket.installerName || 'Teknisi Belum Assign'}
                    </div>
                    <div className="text-xs text-[#52647A] dark:text-[#cabde8] truncate">
                      {selectedTicket.contactorName || 'Mitra'} • {selectedTicket.area || '-'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4 flex-wrap text-[11.5px] text-[#52647A] dark:text-[#cabde8]">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-[#218A63] dark:text-emerald-600" />
                    <span className="font-semibold text-[#26364A] dark:text-white tabular-nums">
                      Check-in: {formatJakartaTimeOnly(selectedTicket.checkInAt || selectedTicket.workStartedAt)}
                    </span>
                  </div>
                  {typeof selectedTicket.workDurationMinutes === 'number' && selectedTicket.workDurationMinutes > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Activity className="w-4 h-4 text-[#218A63] dark:text-emerald-600" />
                      <span className="font-semibold text-[#26364A] dark:text-white tabular-nums">
                        Durasi: {selectedTicket.workDurationMinutes}m
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Wrench className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff]" />
                    <span className="font-semibold text-[#26364A] dark:text-white">
                      {selectedTicket.houseLocation?.locationSource || 'MoraJaws Field PWA'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Verification Dispatch Action Bar */}
              <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105e] space-y-3">
                {/* Ringkasan Laporan Installer & Agent untuk Verifikasi */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 p-3 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] text-xs">
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#dab9ff]">
                      Laporan Installer
                    </span>
                    <div className="font-semibold text-[#26364A] dark:text-white truncate">
                      {selectedTicket.progressReports?.[0]?.reportStatus ||
                        selectedTicket.technicalReport?.workResult ||
                        selectedTicket.statusWOInstaller}
                      {selectedTicket.progressReports?.[0]?.reasonReport
                        ? ` · ${selectedTicket.progressReports[0].reasonReport}`
                        : ''}
                    </div>
                    <div className="text-[11px] text-[#52647A] dark:text-[#cabde8] line-clamp-2">
                      {selectedTicket.progressReports?.[0]?.remarksReport ||
                        selectedTicket.technicalReport?.technicalDescription ||
                        selectedTicket.remarksWOInstaller ||
                        'Belum ada catatan installer.'}
                    </div>
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#dab9ff]">
                      Laporan / Catatan Agent
                    </span>
                    <div className="font-semibold text-[#26364A] dark:text-white truncate">
                      WO Agent: {selectedTicket.statusWOAgent} • WA: {selectedTicket.statusWhatsApp}
                    </div>
                    <div className="text-[11px] text-[#52647A] dark:text-[#cabde8] line-clamp-2">
                      {selectedTicket.remarksAgent || 'Belum ada catatan agent.'}
                    </div>
                  </div>
                </div>

                {canManageApproval ? (
                  <>
                    <div className="p-3 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 items-center">
                        <div>
                          <label
                            htmlFor="qc-desk-wo-agent-status"
                            className="block text-xs font-bold text-[#26364A] dark:text-white mb-1"
                          >
                            Dispatch Approval — Final Status WO Agent
                          </label>
                          <select
                            id="qc-desk-wo-agent-status"
                            value={selectedWoAgentStatus}
                            disabled={selectedTicket.approvalStatus !== 'BUTUH APPROVAL'}
                            onChange={e => {
                              setSelectedWoAgentStatus(e.target.value as DispatchApprovalWoAgentStatus);
                              if (decisionError) setDecisionError(null);
                            }}
                            className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#22123f] border border-[#CFDCE8] dark:border-[#5b35b1] text-xs font-bold text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8]/35 disabled:opacity-60"
                          >
                            {DISPATCH_APPROVAL_OPTIONS.map(opt => (
                              <option key={opt.woAgentStatus} value={opt.woAgentStatus}>
                                {opt.dispatchApprovalLabel} → WO: {opt.woAgentStatus} (Ticket: Closed)
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="text-[11px] text-[#52647A] dark:text-[#cabde8] space-y-0.5">
                          <div className="font-bold text-[#5145A6] dark:text-[#dab9ff]">
                            Mapping Hasil: {getDispatchApprovalOutcomeLabel(selectedWoAgentStatus)}
                          </div>
                          <div>
                            WO Agent: <strong>{selectedWoAgentStatus}</strong> • Ticket Result:{' '}
                            <strong>Closed</strong>
                          </div>
                          {selectedTicket.approvedAt && (
                            <div className="font-mono text-[10px]">
                              Disetujui: {selectedTicket.approvedBy || 'Dispatch'} ({formatJakartaTimeOnly(selectedTicket.approvedAt)})
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label
                          htmlFor="qc-desk-decision-notes"
                          className="text-xs font-bold text-[#26364A] dark:text-white"
                        >
                          Catatan Pemeriksaan Dispatch{' '}
                          <span className="font-normal text-[#8492A5] dark:text-[#cabde8]">
                            (Wajib min. 3 karakter jika minta revisi)
                          </span>
                        </label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setDecisionNotes('Redaman optik sesuai standar, foto bukti lengkap dan sesuai SOP. Disetujui.');
                              setDecisionError(null);
                            }}
                            className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] text-[10.5px] font-bold hover:bg-[#DCE3F2] cursor-pointer"
                          >
                            Acc Redaman Normal
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDecisionNotes('Foto rumah/OPM/barcode belum jelas, mohon unggah ulang.');
                              setDecisionError(null);
                            }}
                            className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] text-[10.5px] font-bold hover:bg-[#DCE3F2] cursor-pointer"
                          >
                            Kirim Ulang Foto
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDecisionNotes('SOP lengkap, geotag valid, status koneksi pelanggan normal.');
                              setDecisionError(null);
                            }}
                            className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] text-[10.5px] font-bold hover:bg-[#DCE3F2] cursor-pointer"
                          >
                            SOP Lengkap
                          </button>
                        </div>
                      </div>

                      <textarea
                        id="qc-desk-decision-notes"
                        ref={notesInputRef}
                        rows={2}
                        value={decisionNotes}
                        onChange={e => {
                          setDecisionNotes(e.target.value);
                          if (decisionError) setDecisionError(null);
                        }}
                        placeholder="Tuliskan catatan verifikasi atau alasan revisi teknis untuk teknisi..."
                        className="w-full p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] text-xs text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8]/30"
                      />
                    </div>

                    {decisionError && (
                      <div className="p-2.5 rounded-lg bg-[#FCE9EB] dark:bg-rose-950/60 border border-[#F3C5CA] dark:border-rose-800 text-xs font-semibold text-[#9B2C37] dark:text-rose-200 flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 shrink-0" />
                        <span>{decisionError}</span>
                      </div>
                    )}

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleRequestRevisionSelected}
                          disabled={isRejecting || isApproving || selectedTicket.approvalStatus !== 'BUTUH APPROVAL'}
                          className="btn-3d-amber flex-1 sm:flex-initial px-4 py-2.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                        >
                          {isRejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                          <span>Minta Revisi (Requested)</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (onOpenWhatsApp) {
                              onOpenWhatsApp(selectedTicket);
                            } else if (onSelectTicket) {
                              onSelectTicket(selectedTicket, 'chat');
                            }
                          }}
                          className="btn-3d-lilac flex-1 sm:flex-initial px-4 py-2.5 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <MessageSquare className="w-4 h-4 text-[#218A63] dark:text-emerald-600" />
                          <span>Hubungi WhatsApp</span>
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={handleApproveSelected}
                        disabled={
                          isApproving ||
                          isRejecting ||
                          selectedTicket.approvalStatus !== 'BUTUH APPROVAL'
                        }
                        className="btn-3d-primary px-5 py-3 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isApproving ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-[#EAE8FF] dark:text-[#eedbff]" />
                        )}
                        <span>
                          {selectedTicket.approvalStatus === 'BUTUH APPROVAL'
                            ? `Approve (${selectedWoAgentStatus}) & Close Ticket`
                            : selectedTicket.approvalStatus === 'APPROVED'
                            ? `${selectedTicket.dispatchApprovalStatus || getDispatchApprovalOutcomeLabel(getRecommendedDispatchWoAgentStatus(selectedTicket))} (Closed)`
                            : `STATUS: ${selectedTicket.approvalStatus || 'BELUM SUBMIT'}`}
                        </span>
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="p-3 rounded-lg bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] flex flex-wrap items-center justify-between gap-2 text-xs text-[#52647A] dark:text-[#cabde8]">
                    <span>
                      Mode Monitoring Read-Only: Keputusan Approve/Revisi hanya tersedia untuk role <strong>Dispatch</strong> dan <strong>Super Admin</strong>.
                    </span>
                    {onSelectTicket && (
                      <button
                        type="button"
                        onClick={() => onSelectTicket(selectedTicket, 'overview')}
                        className="btn-3d-primary px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
                      >
                        Buka Detail WO
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Secondary Operations & Compliance Radar Panel */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Technician Compliance Meter */}
            <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-4 flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between">
                <span className="font-display text-sm font-bold text-[#26364A] dark:text-white">
                  Technician Compliance Meter
                </span>
                <ShieldCheck className="w-5 h-5 text-[#218A63] dark:text-emerald-600" />
              </div>

              <div className="space-y-2.5">
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-[#52647A] dark:text-[#cabde8]">Optical Geotagging &amp; Foto Rumah</span>
                    <span className="font-bold text-[#218A63] dark:text-emerald-300 tabular-nums">
                      {telemetryStats.geoCompliancePct}% Valid
                    </span>
                  </div>
                  <div className="w-full bg-[#EDF3F8] dark:bg-[#160d29] h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-[#218A63] dark:bg-emerald-500 h-full transition-all"
                      style={{ width: `${telemetryStats.geoCompliancePct}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-[#52647A] dark:text-[#cabde8]">First-Time-Right (FTR) Approval Rate</span>
                    <span className="font-bold text-[#5145A6] dark:text-[#dab9ff] tabular-nums">
                      {telemetryStats.ftrRatePct}%
                    </span>
                  </div>
                  <div className="w-full bg-[#EDF3F8] dark:bg-[#160d29] h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-[#6657C8] dark:bg-[#58149c] h-full transition-all"
                      style={{ width: `${telemetryStats.ftrRatePct}%` }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-[#52647A] dark:text-[#cabde8]">3-Point Bukti Lengkap (Rumah + OPM + FAT)</span>
                    <span className="font-bold text-[#26364A] dark:text-white tabular-nums">
                      {telemetryStats.proofCompletePct}%
                    </span>
                  </div>
                  <div className="w-full bg-[#EDF3F8] dark:bg-[#160d29] h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-[#65B8C4] dark:bg-[#6a46c1] h-full transition-all"
                      style={{ width: `${telemetryStats.proofCompletePct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Field Network Live Topology Inspector */}
            <div className="card-3d-lavender rounded-xl dark:bg-[#1e1238] dark:border-[#3b1d78] p-4 flex flex-col justify-between gap-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-sm font-bold text-[#26364A] dark:text-white">
                  Cluster OLT / FAT Hub Status
                </span>
                <span className="text-[11px] text-[#2E7D8B] dark:text-[#dab9ff] font-mono font-bold bg-[#DDF4F4] dark:bg-[#7135b5]/30 border border-[#BDE4E8] dark:border-transparent px-2 py-0.5 rounded truncate max-w-[140px]">
                  {clusterOltStats.hubLabel}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-center">
                <div className="bg-[#F8FAFD] dark:bg-[#160d29] p-2.5 rounded-lg border border-[#DDE6F0] dark:border-[#35105e]">
                  <span className="text-[10.5px] text-[#52647A] dark:text-[#cabde8] block">WO Cluster Selesai</span>
                  <span className="font-display text-lg text-[#26364A] dark:text-white font-bold tabular-nums">
                    {clusterOltStats.completedInCluster}/{clusterOltStats.totalClusterWo}
                  </span>
                  <span className="text-[10.5px] text-[#218A63] dark:text-emerald-300 block font-semibold">
                    {clusterOltStats.distinctFats} FAT Aktif
                  </span>
                </div>

                <div className="bg-[#F8FAFD] dark:bg-[#160d29] p-2.5 rounded-lg border border-[#DDE6F0] dark:border-[#35105e]">
                  <span className="text-[10.5px] text-[#52647A] dark:text-[#cabde8] block">Avg. Rx Power Cluster</span>
                  <span className="font-display text-lg text-[#26364A] dark:text-white font-bold tabular-nums">
                    {clusterOltStats.avgClusterDbm ?? '--'}
                  </span>
                  <span className="text-[10px] text-[#52647A] dark:text-[#cabde8] block">dBm (Optical Avg)</span>
                </div>
              </div>

              <div className="pt-1 flex items-center justify-between text-[11px] text-[#52647A] dark:text-[#cabde8]">
                <span className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      databaseStatus === 'connected' ? 'bg-[#218A63] dark:bg-emerald-500' : 'bg-[#C88735] dark:bg-amber-500'
                    }`}
                  />
                  <span>Supabase Sync: {databaseStatus}</span>
                </span>
                <span className="text-[#5145A6] dark:text-[#dab9ff] font-semibold">
                  {counts.totalToday} WO Today
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stitch AI Hot Desk QC Verifikasi Modal */}
      {hotDeskModalOpen && selectedTicket && selectedProof && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Hot Desk QC Verifikasi — Review & Validasi Tiket Selesai Lapangan"
          onClick={() => setHotDeskModalOpen(false)}
          className="fixed inset-0 z-50 bg-[#26364A]/45 dark:bg-[#090414]/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-[1120px] my-auto bg-white/95 dark:bg-[#1e1238] rounded-2xl shadow-[0_24px_50px_-12px_rgba(38,54,74,0.22),0_0_0_1px_rgba(207,220,232,0.85)] dark:shadow-[0_24px_50px_-12px_rgba(22,13,41,0.35),0_0_0_1px_rgba(113,53,181,0.18)] flex flex-col overflow-hidden"
          >
            {/* Top Specular Bevel Line */}
            <div className="h-[2px] w-full bg-gradient-to-r from-[#65B8C4] via-[#6657C8] to-[#5145A6] dark:from-cyan-400 dark:via-[#7135b5] dark:to-[#a380fe] opacity-95 shrink-0" />

            {/* MODAL HEADER */}
            <div className="px-4 sm:px-6 py-4 bg-white dark:bg-[#1e1238] flex flex-col lg:flex-row lg:items-start justify-between gap-3 relative border-b border-[#DDE6F0] dark:border-[#35105e]">
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#DDF4F4] dark:bg-cyan-500/10 text-[#2E7D8B] dark:text-cyan-300 border border-[#BDE4E8] dark:border-transparent text-[11px] font-bold tracking-wide uppercase shadow-[inset_0_1px_0_0_rgba(255,255,255,0.8)] dark:shadow-none">
                    <span className="w-2 h-2 rounded-full bg-[#2E7D8B] dark:bg-cyan-500 animate-ping" />
                    <span>HOT DESK QC VERIFIKASI</span>
                  </span>

                  <button
                    type="button"
                    onClick={() => handleCopyWo(selectedTicket.woNumber)}
                    title="Klik untuk menyalin ID WO"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#35105e] text-[#5145A6] dark:text-[#dab9ff] border border-[#DCE3F2] dark:border-transparent font-mono text-[11px] font-bold hover:bg-[#F0EDFF] cursor-pointer transition-colors"
                  >
                    <span>ID: {selectedTicket.woNumber}</span>
                    <Copy className="w-3 h-3 opacity-75" />
                  </button>

                  <span className="text-[11px] font-semibold text-[#52647A] dark:text-[#cabde8] truncate">
                    • {selectedTicket.clusterName || selectedTicket.oltCode || 'Cluster FTTH'} / {selectedTicket.area || '-'}
                  </span>
                </div>

                <h2 className="font-display text-lg sm:text-[22px] font-bold text-[#26364A] dark:text-white tracking-tight leading-snug">
                  Review &amp; Validasi Tiket Selesai Lapangan (Dispatch Verification)
                </h2>

                <p className="text-xs text-[#52647A] dark:text-[#cabde8]">
                  Pelanggan: <strong className="text-[#26364A] dark:text-white font-semibold">{selectedTicket.customerName}</strong> •{' '}
                  {selectedTicket.serviceType || selectedTicket.plan || selectedTicket.ticketCategory || 'FTTH Installation'}
                  {selectedTicket.idCustomer ? ` • ID ${selectedTicket.idCustomer}` : ''}
                </p>
              </div>

              {/* Header Actions: SLA Alert & Close Button */}
              <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                <div
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7)] dark:shadow-none border ${
                    getTicketCanonicalApprovalStatus(selectedTicket) === 'APPROVED'
                      ? 'bg-[#E4F5EC] border-[#B7E4CC] text-[#218A63] dark:bg-emerald-500/12 dark:border-transparent dark:text-emerald-300'
                      : slaRemainingMins <= 0
                      ? 'bg-[#FCE9EB] border-[#F3C5CA] text-[#9B2C37] dark:bg-rose-500/12 dark:border-transparent dark:text-rose-300'
                      : 'bg-[#FFF2D9] border-[#F2CF95] text-[#9D661F] dark:bg-amber-500/12 dark:border-transparent dark:text-amber-300'
                  }`}
                >
                  <Timer
                    className={`w-4 h-4 shrink-0 ${
                      getTicketCanonicalApprovalStatus(selectedTicket) === 'APPROVED'
                        ? 'text-[#218A63] dark:text-emerald-400'
                        : slaRemainingMins <= 0
                        ? 'text-[#D45B66] dark:text-rose-400'
                        : 'text-[#C88735] dark:text-amber-400'
                    }`}
                  />
                  <div className="flex flex-col leading-tight">
                    <span className="text-[10px] font-bold uppercase tracking-wider">SLA REMAINING</span>
                    <span className="text-xs font-semibold tracking-tight tabular-nums">
                      {getTicketCanonicalApprovalStatus(selectedTicket) === 'APPROVED'
                        ? 'Terverifikasi / Selesai'
                        : slaRemainingMins > 0
                        ? `${slaRemainingMins}m sebelum SLA Alert`
                        : `SLA Alert +${Math.abs(slaRemainingMins)}m`}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setHotDeskModalOpen(false)}
                  aria-label="Tutup Dialog"
                  className="btn-3d-icon w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* PAGER BAR: Multi-Ticket Navigation */}
            <div className="px-4 sm:px-6 py-2.5 bg-[#EDF3F8] dark:bg-[#160d29] border-b border-[#DDE6F0] dark:border-[#35105e] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff]" />
                <span className="text-xs font-semibold text-[#26364A] dark:text-white">
                  Antrean Verifikasi:
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-[#6657C8] dark:bg-[#7135b5] text-white text-[11px] font-bold tabular-nums">
                  Tiket {modalQueueIndex + 1} dari {modalQueue.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevModalTicket}
                  disabled={modalQueueIndex <= 0}
                  className="btn-3d-lilac px-3 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Tiket Sebelumnya</span>
                </button>
                <button
                  type="button"
                  onClick={handleNextModalTicket}
                  disabled={modalQueueIndex >= modalQueue.length - 1}
                  className="btn-3d-lilac px-3 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <span>Tiket Berikutnya</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* MODAL BODY: TWO-COLUMN MASTER INSPECTION LAYOUT */}
            <div className="p-4 sm:p-6 max-h-[calc(86vh-205px)] overflow-y-auto">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* LEFT COLUMN: FIELD EVIDENCE & TECHNICAL DATA AUDIT (7 Cols) */}
                <div className="lg:col-span-7 flex flex-col gap-4">
                  {/* Context 1: Customer & Technician Spec Card */}
                  <div className="p-4 bg-[#F8FAFD] dark:bg-[#160d29] rounded-xl border border-[#DDE6F0] dark:border-[#35105e] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-none flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#a78bfa]">
                          Alamat Lengkap Instalasi Fisik
                        </div>
                        <div className="text-sm font-semibold text-[#26364A] dark:text-white leading-relaxed">
                          {selectedTicket.address || selectedTicket.streetName || '-'}
                          {selectedTicket.city ? `, ${selectedTicket.city}` : ''}
                          {selectedTicket.postalCode ? ` ${selectedTicket.postalCode}` : ''}
                        </div>
                      </div>

                      <div
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 whitespace-nowrap shrink-0 border ${
                          selectedProof.houseGeoStatus === 'valid' || selectedProof.hasHouseGeo
                            ? 'bg-[#E4F5EC] border-[#B7E4CC] text-[#218A63] dark:bg-emerald-500/12 dark:border-transparent dark:text-emerald-300'
                            : 'bg-[#FFF2D9] border-[#F2CF95] text-[#9D661F] dark:bg-amber-500/12 dark:border-transparent dark:text-amber-300'
                        }`}
                      >
                        {selectedProof.houseGeoStatus === 'valid' || selectedProof.hasHouseGeo ? (
                          <>
                            <ShieldCheck className="w-3.5 h-3.5 text-[#218A63] dark:text-emerald-400" />
                            <span>GIS PASSED</span>
                          </>
                        ) : (
                          <>
                            <Clock className="w-3.5 h-3.5 text-[#C88735] dark:text-amber-400" />
                            <span>MENUNGGU GIS</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      <div className="space-y-0.5">
                        <div className="text-[11px] font-semibold text-[#52647A] dark:text-[#cabde8]">
                          Paket Layanan ONT
                        </div>
                        <div className="text-xs text-[#26364A] dark:text-white font-medium">
                          {selectedTicket.serviceType || selectedTicket.plan || selectedTicket.ticketCategory || 'FTTH'} (
                          {selectedTicket.ontModel || selectedTicket.ontBrand || selectedTicket.router || 'ONT FTTH'})
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <div className="text-[11px] font-semibold text-[#52647A] dark:text-[#cabde8]">
                          Teknisi Lapangan
                        </div>
                        <div className="text-xs text-[#26364A] dark:text-white font-medium flex items-center gap-1.5">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              selectedTicket.installerName ? 'bg-[#218A63] dark:bg-emerald-500' : 'bg-[#C88735] dark:bg-amber-500'
                            }`}
                          />
                          <span className="truncate">
                            {selectedTicket.installerName || 'Belum Assign'}
                            {selectedTicket.contactorName ? ` (${selectedTicket.contactorName})` : ''}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <div className="text-[11px] font-semibold text-[#52647A] dark:text-[#cabde8]">
                          Check-in Teknisi API
                        </div>
                        <div className="text-xs text-[#26364A] dark:text-white font-mono font-medium">
                          {formatJakartaTimeOnly(selectedTicket.checkInAt || selectedTicket.workStartedAt)} •{' '}
                          {selectedTicket.houseLocation?.locationSource || 'Field PWA'}
                        </div>
                      </div>

                      <div className="space-y-0.5">
                        <div className="text-[11px] font-semibold text-[#52647A] dark:text-[#cabde8]">
                          Node OLT / FDT &amp; Material
                        </div>
                        <div className="text-xs text-[#26364A] dark:text-white font-medium truncate">
                          {selectedTicket.oltCode
                            ? `OLT ${selectedTicket.oltCode}${selectedTicket.fdtCode ? ` · FDT ${selectedTicket.fdtCode}` : ''}`
                            : selectedTicket.technicalReport?.usedMaterials || 'Dropcore & Terminal FTTH'}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {selectedMapsUrl && (
                        <a
                          href={selectedMapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-3d-ceramic inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold text-[#5145A6] dark:text-[#dab9ff]"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Buka Google Maps</span>
                        </a>
                      )}
                      {onSelectTicket && (
                        <button
                          type="button"
                          onClick={() => {
                            setHotDeskModalOpen(false);
                            onSelectTicket(selectedTicket, 'overview');
                          }}
                          className="btn-3d-lilac inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer"
                        >
                          <Eye className="w-3 h-3 text-[#5145A6] dark:text-[#dab9ff]" />
                          <span>Detail 17-Section</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* EVIDENCE SECTION TITLE */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs font-bold text-[#5145A6] dark:text-[#dab9ff] uppercase tracking-wider flex items-center gap-1.5">
                      <Camera className="w-4 h-4" />
                      <span>Audit 3 Titik Bukti Lapangan</span>
                    </span>
                    <span className="text-[11px] font-medium text-[#52647A] dark:text-[#cabde8]">
                      {selectedProof.verifiedPointsCount}/3 Titik Terverifikasi
                    </span>
                  </div>

                  {/* EVIDENCE CARD 1: Foto Rumah & Plang */}
                  <div className="bg-white dark:bg-[#160d29] p-4 rounded-xl border border-[#DDE6F0] dark:border-[#35105e] shadow-[0_2px_8px_rgba(38,54,74,0.05)] dark:shadow-[0_2px_8px_rgba(53,16,94,0.05)] flex flex-col sm:flex-row gap-4">
                    <div className="relative w-full sm:w-44 h-44 rounded-lg overflow-hidden bg-[#EDF3F8] dark:bg-[#22123f] shrink-0 shadow-[inset_0_0_0_1px_rgba(38,54,74,0.08)] group">
                      {selectedProof.housePhotoUrl && !failedImages['modal_house'] ? (
                        <>
                          <img
                            src={selectedProof.housePhotoUrl}
                            alt={`Foto Rumah ${selectedTicket.customerName}`}
                            referrerPolicy="no-referrer"
                            onError={() => setFailedImages(prev => ({ ...prev, modal_house: true }))}
                            className="w-full h-full object-cover object-center group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-[#26364A]/85 via-transparent to-transparent flex items-end p-2 pointer-events-none">
                            <span className="text-[10px] text-white font-mono tracking-tight bg-[#26364A]/75 px-1.5 py-0.5 rounded truncate max-w-full">
                              {selectedProof.hasHouseGeo
                                ? `GPS: ${formatCoordinates(selectedProof.houseLat!, selectedProof.houseLng!)}`
                                : 'GPS belum tercatat'}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setZoomPhoto({
                                url: selectedProof.housePhotoUrl!,
                                title: 'Bukti 1: Foto Rumah & Plang',
                                subtitle: `${selectedTicket.woNumber} · ${selectedTicket.customerName}`,
                                latitude: selectedProof.houseLat,
                                longitude: selectedProof.houseLng,
                                gpsAccuracyMeters: selectedProof.houseAcc
                              })
                            }
                            title="Perbesar Foto"
                            aria-label="Perbesar Foto Rumah"
                            className="absolute top-2 right-2 p-1.5 rounded-md bg-[#26364A]/70 text-white hover:bg-[#26364A] transition-colors cursor-pointer"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-[#8492A5] dark:text-[#cabde8] p-3 text-center gap-1.5">
                          <ImageOff className="w-6 h-6 opacity-70" />
                          <span className="text-[11px] font-semibold">Belum Ada Foto Rumah</span>
                        </div>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-bold text-[#26364A] dark:text-white truncate">
                            Bukti 1: Foto Rumah &amp; Plang
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10.5px] font-bold shrink-0 ${
                              selectedProof.hasHouseValid
                                ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-500/12 dark:text-emerald-300'
                                : 'bg-[#FFF2D9] text-[#9D661F] dark:bg-amber-500/12 dark:text-amber-300'
                            }`}
                          >
                            {selectedProof.hasHouseValid ? 'PASS QC' : 'MENUNGGU'}
                          </span>
                        </div>
                        <p className="text-xs text-[#52647A] dark:text-[#cabde8] mb-2 leading-relaxed">
                          {selectedTicket.technicalReport?.technicalDescription ||
                            selectedTicket.houseLocation?.fieldNotes ||
                            'Foto gerbang fasad dan jalur tarikan dropcore masuk ke dalam rumah.'}
                        </p>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex items-center justify-between py-1 px-2.5 rounded bg-[#EDF3F8] dark:bg-[#22123f]">
                            <span className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                              Radius Deviasi Geotag:
                            </span>
                            <span className="font-semibold font-mono text-[#218A63] dark:text-emerald-300">
                              {typeof selectedProof.houseAcc === 'number'
                                ? `${Math.round(selectedProof.houseAcc)}m (SOP < 50m)`
                                : selectedProof.hasHouseGeo
                                ? 'Koordinat Terkunci'
                                : 'Belum Ada GPS'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between py-1 px-2.5 rounded bg-[#EDF3F8] dark:bg-[#22123f]">
                            <span className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                              Status Geotag Lapangan:
                            </span>
                            <span className="font-semibold font-mono text-[#5145A6] dark:text-[#dab9ff]">
                              {String(selectedProof.houseGeoStatus || (selectedProof.hasHouseGeo ? 'valid' : 'pending')).toUpperCase()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[#8492A5] dark:text-[#a78bfa] font-mono">
                          Captured:{' '}
                          {formatJakartaTimeOnly(
                            selectedProof.houseSlot?.capturedAtIso ||
                              selectedTicket.houseLocation?.capturedAt ||
                              selectedTicket.checkInAt
                          )}
                        </span>
                        {selectedProof.housePhotoUrl && !failedImages['modal_house'] && (
                          <button
                            type="button"
                            onClick={() =>
                              setZoomPhoto({
                                url: selectedProof.housePhotoUrl!,
                                title: 'Bukti 1: Foto Rumah & Plang',
                                subtitle: `${selectedTicket.woNumber} · ${selectedTicket.customerName}`,
                                latitude: selectedProof.houseLat,
                                longitude: selectedProof.houseLng,
                                gpsAccuracyMeters: selectedProof.houseAcc
                              })
                            }
                            className="text-[#5145A6] dark:text-[#dab9ff] hover:text-[#6657C8] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <span>Perbesar Foto</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* EVIDENCE CARD 2: Telemetri Redaman OPM Roset */}
                  <div className="bg-white dark:bg-[#160d29] p-4 rounded-xl border border-[#DDE6F0] dark:border-[#35105e] shadow-[0_2px_8px_rgba(38,54,74,0.05)] dark:shadow-[0_2px_8px_rgba(53,16,94,0.05)] flex flex-col sm:flex-row gap-4 items-center">
                    <div className="w-full sm:w-44 p-3.5 rounded-xl bg-gradient-to-br from-[#EDF3F8] to-[#DDF4F4] border border-[#BDE4E8] dark:bg-none dark:bg-[#0f081e] dark:border-transparent text-center flex flex-col justify-center items-center shadow-inner shrink-0">
                      <span className="text-[10px] text-[#2E7D8B] dark:text-cyan-300 font-mono uppercase tracking-wider mb-1 font-bold">
                        Optical Power Meter
                      </span>
                      <div
                        className={`font-mono text-[2rem] font-bold tracking-tight leading-none py-1 tabular-nums ${
                          selectedProof.numericOpm === null
                            ? 'text-[#8492A5] dark:text-[#cabde8]'
                            : selectedProof.isOpmOptimal
                            ? 'text-[#218A63] dark:text-emerald-400 dark:drop-shadow-[0_0_12px_rgba(52,211,153,0.45)]'
                            : 'text-[#C88735] dark:text-amber-300'
                        }`}
                      >
                        {selectedProof.numericOpm !== null ? selectedProof.numericOpm.toFixed(2) : '--'}
                      </div>
                      <span className="text-[10.5px] text-[#218A63] dark:text-emerald-300 font-mono uppercase font-bold tracking-widest mt-0.5">
                        dBm • 1490nm
                      </span>
                      {selectedProof.opmSlot?.url && getSafePreviewUrl(selectedProof.opmSlot.url) && (
                        <button
                          type="button"
                          onClick={() =>
                            setZoomPhoto({
                              url: getSafePreviewUrl(selectedProof.opmSlot!.url)!,
                              title: 'Foto Pengukuran OPM Roset',
                              subtitle: `${selectedTicket.woNumber} · ${selectedProof.numericOpm ?? '-'} dBm`
                            })
                          }
                          className="mt-2 w-full bg-white/80 hover:bg-white text-[#5145A6] border border-[#DCE3F2] dark:border-transparent dark:bg-white/15 dark:hover:bg-white/25 dark:text-white rounded px-2 py-1 text-[10px] font-bold cursor-pointer transition-colors"
                        >
                          Lihat Foto OPM
                        </button>
                      )}
                    </div>

                    <div className="flex-1 w-full flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-bold text-[#26364A] dark:text-white truncate">
                            Bukti 2: Redaman Optik (Roset)
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10.5px] font-bold shrink-0 ${
                              selectedProof.isOpmOptimal
                                ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-500/12 dark:text-emerald-300'
                                : selectedProof.hasOpmProof
                                ? 'bg-[#FFF2D9] text-[#9D661F] dark:bg-amber-500/12 dark:text-amber-300'
                                : 'bg-[#EAE8FF] dark:bg-[#2e1459] text-[#52647A] dark:text-[#cabde8]'
                            }`}
                          >
                            {selectedProof.isOpmOptimal
                              ? 'PASS SOP'
                              : selectedProof.hasOpmProof
                              ? 'PERLU CEK'
                              : 'BELUM DIUKUR'}
                          </span>
                        </div>
                        <p className="text-xs text-[#52647A] dark:text-[#cabde8] mb-2">
                          Hasil ukur daya sinyal optik pada roset indoor sebelum masuk port optical ONT.
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 rounded bg-[#EDF3F8] dark:bg-[#22123f]">
                            <div className="text-[10.5px] text-[#52647A] dark:text-[#cabde8]">Ambang Batas SOP:</div>
                            <div className="font-bold text-[#26364A] dark:text-white font-mono">
                              -15.00 s/d -24.00 dBm
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#EDF3F8] dark:bg-[#22123f]">
                            <div className="text-[10.5px] text-[#52647A] dark:text-[#cabde8]">Dropcore / FAT dBm:</div>
                            <div className="font-bold text-[#218A63] dark:text-emerald-300 font-mono">
                              {selectedTicket.dropcoreLengthMeter ?? selectedTicket.dropcoreLength ?? '-'}m •{' '}
                              {selectedTicket.fatRedamanDbm ?? '-'} dBm
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[#8492A5] dark:text-[#a78bfa] font-mono">
                          OLT Node: {selectedTicket.oltCode || '-'}
                        </span>
                        <span className="text-[11px] text-[#218A63] dark:text-emerald-300 font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {selectedTicket.oltRegistrationStatus || (selectedProof.isOpmOptimal ? 'Sinyal Rx Stabil' : 'Cek Redaman')}
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* EVIDENCE CARD 3: Labeling Barcode Dropcore & Port ODP/FAT */}
                  <div className="bg-white dark:bg-[#160d29] p-4 rounded-xl border border-[#DDE6F0] dark:border-[#35105e] shadow-[0_2px_8px_rgba(38,54,74,0.05)] dark:shadow-[0_2px_8px_rgba(53,16,94,0.05)] flex flex-col sm:flex-row gap-4 items-center">
                    {selectedProof.fatPhotoUrl && !failedImages['modal_fat'] ? (
                      <button
                        type="button"
                        onClick={() =>
                          setZoomPhoto({
                            url: selectedProof.fatPhotoUrl!,
                            title: 'Bukti 3: Label Dropcore & Port ODP/FAT',
                            subtitle: `${selectedProof.fatLabel || 'FAT'} · SN ${selectedProof.ontSerial || '-'}`,
                            latitude: selectedProof.fatSlot?.latitude ?? selectedTicket.fatLocation?.latitude,
                            longitude: selectedProof.fatSlot?.longitude ?? selectedTicket.fatLocation?.longitude
                          })
                        }
                        className="relative w-full sm:w-44 h-36 rounded-xl overflow-hidden bg-[#EAE8FF] dark:bg-[#22123f] shrink-0 group cursor-pointer"
                      >
                        <img
                          src={selectedProof.fatPhotoUrl}
                          alt="Foto Label Dropcore & Port ODP/FAT"
                          referrerPolicy="no-referrer"
                          onError={() => setFailedImages(prev => ({ ...prev, modal_fat: true }))}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-[#26364A]/85 text-white font-mono text-[10px] flex items-center gap-1">
                          <ZoomIn className="w-3 h-3" />
                          <span>Zoom</span>
                        </div>
                      </button>
                    ) : (
                      <div className="w-full sm:w-44 p-3 rounded-xl bg-[#EAE8FF] dark:bg-[#22123f] flex flex-col justify-center items-center text-center shrink-0 min-h-[120px]">
                        <QrCode className="w-9 h-9 text-[#5145A6] dark:text-[#dab9ff] mb-1" />
                        <span className="text-[11px] font-mono font-bold text-[#26364A] dark:text-white break-all">
                          {selectedProof.ontSerial || selectedProof.fatLabel || 'BELUM SCAN'}
                        </span>
                        <span
                          className={`text-[10.5px] font-medium mt-0.5 ${
                            selectedProof.hasFatOrOntProof
                              ? 'text-[#218A63] dark:text-emerald-300'
                              : 'text-[#C88735] dark:text-amber-300'
                          }`}
                        >
                          {selectedProof.hasFatOrOntProof ? 'Data Tag Tercatat' : 'Menunggu Foto/SN'}
                        </span>
                      </div>
                    )}

                    <div className="flex-1 w-full flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-sm font-bold text-[#26364A] dark:text-white truncate">
                            Bukti 3: Label Dropcore &amp; ODP
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10.5px] font-bold shrink-0 ${
                              selectedProof.hasFatOrOntProof
                                ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-500/12 dark:text-emerald-300'
                                : 'bg-[#FFF2D9] text-[#9D661F] dark:bg-amber-500/12 dark:text-amber-300'
                            }`}
                          >
                            {selectedProof.hasFatOrOntProof ? 'VERIFIED' : 'MENUNGGU'}
                          </span>
                        </div>
                        <p className="text-xs text-[#52647A] dark:text-[#cabde8] mb-2">
                          {selectedTicket.technicalReport?.correctiveAction ||
                            'Validasi penomoran port ODP/FAT fisik dan barcode serial number perangkat pelanggan.'}
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="p-2 rounded bg-[#EDF3F8] dark:bg-[#22123f]">
                            <div className="text-[10.5px] text-[#52647A] dark:text-[#cabde8]">ODP/FAT Induk &amp; Port:</div>
                            <div className="font-bold text-[#26364A] dark:text-white font-mono truncate">
                              {selectedProof.fatLabel || '-'}
                              {selectedTicket.fatPort ? ` / Port ${selectedTicket.fatPort}` : ''}
                            </div>
                          </div>
                          <div className="p-2 rounded bg-[#EDF3F8] dark:bg-[#22123f]">
                            <div className="text-[10.5px] text-[#52647A] dark:text-[#cabde8]">ONT SN / Device:</div>
                            <div className="font-bold text-[#26364A] dark:text-white font-mono truncate">
                              {selectedProof.ontSerial || selectedTicket.ontMacAddress || '-'}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-[#8492A5] dark:text-[#a78bfa]">
                          Cluster: {selectedTicket.clusterName || selectedTicket.area || '-'}
                        </span>
                        <span className="text-[11px] text-[#5145A6] dark:text-[#dab9ff] font-bold">
                          {selectedTicket.fatPort ? `Port ${selectedTicket.fatPort} Tagged` : 'Port Info'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Extra Uploaded Photos Strip */}
                  {selectedProof.extraPhotos.length > 0 && (
                    <div className="pt-1">
                      <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#cabde8] mb-2">
                        Bukti Tambahan Terunggah ({selectedProof.extraPhotos.length})
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedProof.extraPhotos.map((p, idx) => (
                          <button
                            key={`modal-extra-${p.url}-${idx}`}
                            type="button"
                            onClick={() => setZoomPhoto(p)}
                            className="group relative w-20 h-16 rounded-lg overflow-hidden border border-[#DDE6F0] dark:border-[#3b1d78] bg-[#F8FAFD] dark:bg-[#160d29] cursor-pointer"
                            title={`${p.title} — ${p.subtitle}`}
                          >
                            <img src={p.url} alt={p.title} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                            <div className="absolute inset-x-0 bottom-0 bg-[#26364A]/80 text-[9px] text-white px-1 py-0.5 truncate">
                              {p.title}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* RIGHT COLUMN: AUDIT CONTROLS, DISPATCH NOTES & DECISION ACTIONS (5 Cols) */}
                <div className="lg:col-span-5 flex flex-col gap-4">
                  {/* CHECKLIST CONTAINER */}
                  <div className="bg-white dark:bg-[#160d29] p-4 rounded-xl border border-[#DDE6F0] dark:border-[#35105e] shadow-[0_2px_8px_rgba(38,54,74,0.05)] dark:shadow-[0_2px_8px_rgba(53,16,94,0.06)] flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[#26364A] dark:text-white flex items-center gap-1.5">
                        <ClipboardCheck className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff]" />
                        <span>QC Verification Checklist</span>
                      </span>
                      <span
                        className={`text-[11px] font-bold tabular-nums ${
                          checkedQcCount === 4
                            ? 'text-[#218A63] dark:text-emerald-300'
                            : 'text-[#5145A6] dark:text-[#dab9ff]'
                        }`}
                      >
                        {checkedQcCount}/4 Item Checked
                      </span>
                    </div>
                    <p className="text-xs text-[#52647A] dark:text-[#cabde8] -mt-1.5">
                      Konfirmasi fisik sebelum menyetujui aktivasi final di sistem operasional.
                    </p>

                    <label className="flex items-start gap-3 p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#22123f] hover:bg-[#EDF3F8] dark:hover:bg-[#2a1650] cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={qcChecklist.facadeAndCable}
                        onChange={e => setQcChecklist(prev => ({ ...prev, facadeAndCable: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded accent-[#6657C8] dark:accent-[#58149c] cursor-pointer"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-[#26364A] dark:text-white font-semibold">
                          Foto Fasad &amp; Jalur Kabel Rapi
                        </span>
                        <span className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                          {selectedProof.hasHouseGeo
                            ? `Koordinat GIS tercatat (${formatCoordinates(selectedProof.houseLat!, selectedProof.houseLng!)}).`
                            : 'Verifikasi kesesuaian rumah target dan kerapian tarikan kabel.'}
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#22123f] hover:bg-[#EDF3F8] dark:hover:bg-[#2a1650] cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={qcChecklist.opticalAttenuation}
                        onChange={e => setQcChecklist(prev => ({ ...prev, opticalAttenuation: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded accent-[#6657C8] dark:accent-[#58149c] cursor-pointer"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-[#26364A] dark:text-white font-semibold">
                          Redaman Optik Dalam Batas SOP
                        </span>
                        <span className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                          {selectedProof.numericOpm !== null
                            ? `Pengukuran OPM ${selectedProof.numericOpm.toFixed(2)} dBm (SOP -15 s/d -24 dBm).`
                            : 'Belum ada nilai OPM roset yang tercatat.'}
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#22123f] hover:bg-[#EDF3F8] dark:hover:bg-[#2a1650] cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={qcChecklist.dropcoreBarcodeAndFat}
                        onChange={e => setQcChecklist(prev => ({ ...prev, dropcoreBarcodeAndFat: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded accent-[#6657C8] dark:accent-[#58149c] cursor-pointer"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-[#26364A] dark:text-white font-semibold">
                          Barcode Dropcore &amp; Port ODP/FAT Terpasang
                        </span>
                        <span className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                          {selectedProof.fatLabel || selectedProof.ontSerial
                            ? `FAT ${selectedProof.fatLabel || '-'}${selectedTicket.fatPort ? ` / Port ${selectedTicket.fatPort}` : ''} • SN ${selectedProof.ontSerial || '-'}`
                            : 'Pastikan label dropcore dan port ODP/FAT terdokumentasi.'}
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-3 p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#22123f] hover:bg-[#EDF3F8] dark:hover:bg-[#2a1650] cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={qcChecklist.ontOnlineProvisioned}
                        onChange={e => setQcChecklist(prev => ({ ...prev, ontOnlineProvisioned: e.target.checked }))}
                        className="mt-0.5 w-4 h-4 rounded accent-[#6657C8] dark:accent-[#58149c] cursor-pointer"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs text-[#26364A] dark:text-white font-semibold">
                          ONT Online &amp; Registrasi Core OLT
                        </span>
                        <span className="text-[11px] text-[#52647A] dark:text-[#cabde8]">
                          {selectedTicket.oltRegistrationStatus ||
                            (selectedTicket.oltCode ? `OLT ${selectedTicket.oltCode} siap aktivasi layanan.` : 'Verifikasi status registrasi ONT dan layanan aktif.')}
                        </span>
                      </div>
                    </label>
                  </div>

                  {/* DISPATCH APPROVAL FINAL WO AGENT STATUS & NOTES */}
                  <div className="bg-white dark:bg-[#160d29] p-4 rounded-xl border border-[#DDE6F0] dark:border-[#35105e] shadow-[0_2px_8px_rgba(38,54,74,0.05)] dark:shadow-[0_2px_8px_rgba(53,16,94,0.06)] flex flex-col gap-2.5">
                    <div className="space-y-1">
                      <label
                        htmlFor="hotdesk-wo-agent-status"
                        className="text-xs font-bold text-[#26364A] dark:text-white flex items-center justify-between gap-2"
                      >
                        <span>Status Akhir WO Agent (Dispatch Approval)</span>
                        <span className="text-[10px] font-mono text-[#5145A6] dark:text-[#dab9ff]">
                          Ticket → Closed
                        </span>
                      </label>
                      <select
                        id="hotdesk-wo-agent-status"
                        value={selectedWoAgentStatus}
                        disabled={!canManageApproval || selectedTicket.approvalStatus !== 'BUTUH APPROVAL'}
                        onChange={e => {
                          setSelectedWoAgentStatus(e.target.value as DispatchApprovalWoAgentStatus);
                          if (decisionError) setDecisionError(null);
                        }}
                        className="w-full px-3 py-2 rounded-lg bg-[#F8FAFD] dark:bg-[#22123f] border border-[#CFDCE8] dark:border-[#5b35b1] text-xs font-bold text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] disabled:opacity-60"
                      >
                        {DISPATCH_APPROVAL_OPTIONS.map(opt => (
                          <option key={opt.woAgentStatus} value={opt.woAgentStatus}>
                            {opt.dispatchApprovalLabel} (WO: {opt.woAgentStatus} · Ticket: Closed)
                          </option>
                        ))}
                      </select>
                      <p className="text-[10.5px] text-[#52647A] dark:text-[#cabde8]">
                        Agent Note: {selectedTicket.remarksAgent || '-'}
                      </p>
                    </div>

                    <label
                      htmlFor="hotdesk-dispatcher-notes"
                      className="text-sm font-bold text-[#26364A] dark:text-white flex items-center justify-between gap-2"
                    >
                      <span>Catatan Dispatcher QC</span>
                      <span className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8] font-normal">
                        Wajib jika Minta Revisi
                      </span>
                    </label>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionNotes(prev => `${prev ? `${prev.trim()} ` : ''}Instalasi sangat rapi, redaman prima.`);
                          setDecisionError(null);
                        }}
                        className="px-2.5 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#2e1459] hover:bg-[#6657C8] hover:text-white text-[#5145A6] dark:text-[#dab9ff] text-[10.5px] font-medium transition-all cursor-pointer"
                      >
                        + Instalasi Sangat Rapi
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionNotes(prev => `${prev ? `${prev.trim()} ` : ''}Redaman dropcore perlu kalibrasi ulang.`);
                          setDecisionError(null);
                        }}
                        className="px-2.5 py-0.5 rounded-full bg-[#FFF2D9] dark:bg-[#2e1459] hover:bg-[#C88735] hover:text-white text-[#9D661F] dark:text-[#dab9ff] text-[10.5px] font-medium transition-all cursor-pointer"
                      >
                        + Redaman Kurang Bagus
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionNotes(prev => `${prev ? `${prev.trim()} ` : ''}Foto rumah buram, upload ulang plang nomor.`);
                          setDecisionError(null);
                        }}
                        className="px-2.5 py-0.5 rounded-full bg-[#FFF2D9] dark:bg-[#2e1459] hover:bg-[#C88735] hover:text-white text-[#9D661F] dark:text-[#dab9ff] text-[10.5px] font-medium transition-all cursor-pointer"
                      >
                        + Foto Rumah Buram
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionNotes(prev => `${prev ? `${prev.trim()} ` : ''}Labeling port ODP belum terpasang jelas.`);
                          setDecisionError(null);
                        }}
                        className="px-2.5 py-0.5 rounded-full bg-[#FFF2D9] dark:bg-[#2e1459] hover:bg-[#C88735] hover:text-white text-[#9D661F] dark:text-[#dab9ff] text-[10.5px] font-medium transition-all cursor-pointer"
                      >
                        + Labeling Belum Terbaca
                      </button>
                    </div>

                    <textarea
                      id="hotdesk-dispatcher-notes"
                      ref={modalNotesInputRef}
                      rows={3}
                      value={decisionNotes}
                      onChange={e => {
                        setDecisionNotes(e.target.value);
                        if (decisionError) setDecisionError(null);
                      }}
                      placeholder="Tulis instruksi perbaikan jika tiket diminta revisi, atau catatan kelayakan teknis lapangan..."
                      className="tactile-debossed-input w-full p-2.5 rounded-lg bg-[#F8FAFD] dark:bg-[#1e1238] border border-[#DDE6F0] dark:border-[#3b1d78] text-xs text-[#26364A] dark:text-white placeholder:text-[#8492A5] focus:outline-none focus:ring-2 focus:ring-[#6657C8] resize-none"
                    />
                  </div>

                  {/* PROVISIONING SUMMARY MINI-WIDGET */}
                  <div className="p-3 rounded-xl bg-[#EDF3F8] dark:bg-[#22123f] border border-[#DDE6F0] dark:border-[#35105e] flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Router className="w-5 h-5 text-[#5145A6] dark:text-[#dab9ff] shrink-0" />
                      <div className="flex flex-col min-w-0">
                        <span className="text-[11px] font-bold text-[#26364A] dark:text-white">
                          Auto-Provisioning Status
                        </span>
                        <span className="text-xs text-[#52647A] dark:text-[#cabde8] truncate font-mono">
                          ONT SN: {selectedProof.ontSerial || 'Belum Terdaftar'} •{' '}
                          {selectedTicket.oltRegistrationStatus || (selectedProof.isOpmOptimal ? 'Ready to Bind' : 'Pending Check')}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`px-2 py-1 rounded text-[10.5px] font-bold shrink-0 ${
                        selectedProof.ontSerial && (selectedProof.isOpmOptimal || selectedTicket.oltRegistrationStatus)
                          ? 'bg-[#DDF4F4] text-[#2E7D8B] dark:bg-cyan-500/12 dark:text-cyan-300'
                          : 'bg-[#FFF2D9] text-[#9D661F] dark:bg-amber-500/12 dark:text-amber-300'
                      }`}
                    >
                      {selectedProof.ontSerial ? 'PROV-SYNC' : 'PENDING'}
                    </span>
                  </div>

                  {/* INLINE RESCHEDULE PANEL (when toggled) */}
                  {showReschedulePanel && canManageApproval && (
                    <div className="p-3.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DCE3F2] dark:border-[#7135b5]/40 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-[#5145A6] dark:text-[#dab9ff] flex items-center gap-1.5">
                          <CalendarClock className="w-4 h-4" />
                          <span>Jadwalkan Ulang Kunjungan (Reschedule)</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowReschedulePanel(false)}
                          className="text-xs text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
                        >
                          Batal
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10.5px] font-bold text-[#52647A] dark:text-[#cabde8] mb-1">
                            Tanggal Baru
                          </label>
                          <input
                            type="date"
                            value={rescheduleDate}
                            onChange={e => setRescheduleDate(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#22123f] border border-[#DDE6F0] dark:border-[#3b1d78] text-xs text-[#26364A] dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[10.5px] font-bold text-[#52647A] dark:text-[#cabde8] mb-1">
                            Slot Waktu
                          </label>
                          <select
                            value={rescheduleSlot}
                            onChange={e => setRescheduleSlot(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#22123f] border border-[#DDE6F0] dark:border-[#3b1d78] text-xs text-[#26364A] dark:text-white"
                          >
                            {slotTimeOptions.map(slot => (
                              <option key={slot} value={slot}>
                                {slot}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[10.5px] font-bold text-[#52647A] dark:text-[#cabde8] mb-1">
                          Alasan Reschedule
                        </label>
                        <input
                          type="text"
                          value={rescheduleReason}
                          onChange={e => setRescheduleReason(e.target.value)}
                          placeholder="Contoh: Pelanggan minta kunjungan ulang besok pagi..."
                          className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#22123f] border border-[#DDE6F0] dark:border-[#3b1d78] text-xs text-[#26364A] dark:text-white"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={handleRescheduleSelected}
                        disabled={isRescheduling}
                        className="btn-3d-primary w-full py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                      >
                        {isRescheduling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
                        <span>Simpan Jadwal Ulang WO</span>
                      </button>
                    </div>
                  )}

                  {decisionError && (
                    <div className="p-2.5 rounded-lg bg-[#FCE9EB] dark:bg-rose-950/60 border border-[#F3C5CA] dark:border-rose-800 text-xs font-semibold text-[#9B2C37] dark:text-rose-200 flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 shrink-0" />
                      <span>{decisionError}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* MODAL FOOTER: 3D TACTILE DECISION ACTION BUTTONS */}
            <div className="px-4 sm:px-6 py-4 bg-[#EDF3F8] dark:bg-[#160d29] border-t border-[#DDE6F0] dark:border-[#35105e] flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9)] dark:shadow-none shrink-0">
              {canManageApproval ? (
                <>
                  <div className="flex items-center gap-2.5 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={handleRequestRevisionSelected}
                      disabled={isRejecting || isApproving || isRescheduling}
                      className="btn-3d-amber flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                    >
                      {isRejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Edit3 className="w-4 h-4" />}
                      <span>Minta Revisi</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowReschedulePanel(prev => !prev)}
                      disabled={isApproving || isRejecting || isRescheduling}
                      className={`flex-1 sm:flex-none px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                        showReschedulePanel
                          ? 'btn-3d-primary'
                          : 'btn-3d-lilac'
                      }`}
                    >
                      <CalendarClock className={`w-4 h-4 ${showReschedulePanel ? 'text-white' : 'text-[#5145A6] dark:text-[#dab9ff]'}`} />
                      <span>Reschedule</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={handleApproveSelected}
                      disabled={
                        isApproving ||
                        isRejecting ||
                        isRescheduling ||
                        selectedTicket.approvalStatus !== 'BUTUH APPROVAL'
                      }
                      className="btn-3d-emerald w-full sm:w-auto px-6 py-2.5 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isApproving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4" />
                      )}
                      <span>
                        {selectedTicket.approvalStatus === 'BUTUH APPROVAL'
                          ? `Approve (${selectedWoAgentStatus}) & Close Ticket`
                          : selectedTicket.approvalStatus === 'APPROVED'
                          ? `${selectedTicket.dispatchApprovalStatus || getDispatchApprovalOutcomeLabel(getRecommendedDispatchWoAgentStatus(selectedTicket))} (Closed)`
                          : `STATUS: ${selectedTicket.approvalStatus || 'BELUM SUBMIT'}`}
                      </span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="w-full flex flex-wrap items-center justify-between gap-2 text-xs text-[#52647A] dark:text-[#cabde8]">
                  <span>
                    Mode Monitoring Read-Only: Keputusan Approve/Revisi/Reschedule hanya tersedia untuk role <strong>Dispatch</strong> dan <strong>Super Admin</strong>.
                  </span>
                  <button
                    type="button"
                    onClick={() => setHotDeskModalOpen(false)}
                    className="btn-3d-primary px-4 py-2 rounded-lg font-bold cursor-pointer"
                  >
                    Tutup
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Photo Preview Modal */}
      {zoomPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={zoomPhoto.title}
          onClick={() => setZoomPhoto(null)}
          className="fixed inset-0 z-[70] bg-[#26364A]/65 dark:bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white dark:bg-[#1e1238] rounded-2xl border border-[#DDE6F0] dark:border-[#3b1d78] max-w-3xl w-full overflow-hidden shadow-2xl"
          >
            <div className="px-4 py-3 border-b border-[#DDE6F0] dark:border-[#35105e] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-white truncate">
                  {zoomPhoto.title}
                </h3>
                <p className="text-xs font-mono text-[#8492A5] dark:text-[#cabde8] truncate">
                  {zoomPhoto.subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZoomPhoto(null)}
                className="btn-3d-icon p-1.5 rounded-lg cursor-pointer"
                aria-label="Tutup preview foto"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-[#EDF3F8] dark:bg-[#160d29] flex items-center justify-center max-h-[70vh] overflow-hidden">
              <img
                src={zoomPhoto.url}
                alt={zoomPhoto.title}
                referrerPolicy="no-referrer"
                className="max-h-[70vh] w-auto object-contain"
              />
            </div>

            {isValidCoordinatePair(zoomPhoto.latitude, zoomPhoto.longitude) && (
              <div className="px-4 py-2.5 bg-[#F8FAFD] dark:bg-[#160d29] border-t border-[#DDE6F0] dark:border-[#35105e] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <span className="text-[#26364A] dark:text-white">
                  GPS: {formatCoordinates(zoomPhoto.latitude!, zoomPhoto.longitude!)}
                  {typeof zoomPhoto.gpsAccuracyMeters === 'number'
                    ? ` (±${Math.round(zoomPhoto.gpsAccuracyMeters)}m)`
                    : ''}
                </span>
                <a
                  href={buildGoogleMapsCoordinateUrl(zoomPhoto.latitude!, zoomPhoto.longitude!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#5145A6] dark:text-[#dab9ff] font-bold underline inline-flex items-center gap-1"
                >
                  <span>Buka di Google Maps</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
