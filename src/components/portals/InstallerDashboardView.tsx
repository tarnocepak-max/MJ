import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { useToast } from '../../context/ToastContext';
import { Ticket, ChatAttachment } from '../../types/index.ts';
import { classifyInstallerStatus } from './InstallerPortal';
import { InstallerTicketFullview } from './InstallerTicketFullview';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { GeoTagCameraCheckInModal } from '../camera/GeoTagCameraCheckInModal';
import {
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus,
  isTicketCheckedIn,
  isTicketClosed
} from '../../services/woLifecycleService';
import { getTicketAppointmentDate, formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { formatJakartaTimeOnly, formatWorkDuration, calculateDurationMinutes } from '../../services/workSessionService';
import { getSafePreviewUrl } from '../../services/storageCompatibility';
import {
  Clock,
  CheckCircle2,
  MapPin,
  Phone,
  MessageSquare,
  ArrowRight,
  Navigation,
  Play,
  Camera,
  Send,
  HelpCircle,
  ShieldAlert,
  X,
  AlertTriangle,
  CalendarClock,
  Maximize2,
  Wrench,
  Award,
  Radio,
  BatteryCharging,
  Wifi,
  WifiOff,
  SlidersHorizontal,
  ArrowUpDown,
  Search,
  RotateCw,
  Ban,
  RefreshCw,
  PieChart,
  FileCheck2,
  ChevronDown,
  ShieldCheck
} from 'lucide-react';

interface InstallerDashboardViewProps {
  onNavigateTab: (tab: string, filter?: string) => void;
  onSelectTicket: (ticket: Ticket) => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
}

type SixWoStatus = 'checkin' | 'complete' | 'requested' | 'reschedule' | 'pending' | 'cancel';
type SortMode = 'priority' | 'slot';

const formatWaTelemetryLabel = (status: string | undefined): string => {
  switch (status) {
    case 'confirmed':
      return 'Konfirmasi OK';
    case 'awaiting_confirmation':
      return 'Menunggu Balas WA';
    case 'opened_in_whatsapp':
      return 'WA Dibuka';
    case 'ready':
      return 'Siap Kirim WA';
    case 'reschedule_requested':
      return 'Reschedule WA';
    case 'unreachable':
      return 'Tidak Terjangkau';
    case 'invalid_number':
      return 'Nomor Tidak Valid';
    case 'cancelled':
      return 'Dibatalkan';
    default:
      return 'Belum Chat WA';
  }
};

const formatBytesShort = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return 'Lampiran';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getWibGreeting = (): string => {
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      hour12: false
    }).format(new Date());
    const hour = parseInt(hourStr, 10);
    if (hour >= 4 && hour < 11) return 'Selamat Pagi';
    if (hour >= 11 && hour < 15) return 'Selamat Siang';
    if (hour >= 15 && hour < 18) return 'Selamat Sore';
    return 'Selamat Malam';
  } catch {
    return 'Selamat Bertugas';
  }
};

const getInitials = (name?: string): string => {
  if (!name) return 'TK';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(s => s[0].toUpperCase())
    .join('');
};

const parseNumericDbm = (raw: unknown): number | null => {
  if (raw === null || raw === undefined) return null;
  const normalized = String(raw).replace(',', '.').trim();
  const match = normalized.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const val = parseFloat(match[0]);
  if (Number.isNaN(val)) return null;
  return val;
};

const extractTicketOpm = (ticket: Ticket): { value: number | null; raw: string | null } => {
  const candidates = [
    ticket.technicalReport?.opticalPowerDbm,
    ticket.technicalReport?.opticalPowerRx,
    ticket.rosetRedamanDbm,
    ticket.technicalReport?.fatRedamanDbm,
    ticket.fatRedamanDbm
  ];
  for (const c of candidates) {
    if (c !== undefined && c !== null && String(c).trim() !== '') {
      const num = parseNumericDbm(c);
      if (num !== null) {
        return { value: num, raw: num.toFixed(2) };
      }
    }
  }
  return { value: null, raw: null };
};

const extractTicketThumbnail = (ticket: Ticket): string | null => {
  const candidates = [
    ticket.houseLocation?.photoUrl,
    ticket.technicalReport?.photoSlots?.find(s => Boolean(s.url))?.url,
    ticket.technicalReport?.photos?.[0],
    ticket.technicalReport?.photoAfterUrl,
    ticket.technicalReport?.photoBeforeUrl
  ];
  for (const c of candidates) {
    const safe = getSafePreviewUrl(c);
    if (safe) return safe;
  }
  return null;
};

const classifySixStatus = (ticket: Ticket): SixWoStatus => {
  const approval = getTicketCanonicalApprovalStatus(ticket);
  const report = getTicketCanonicalReportStatus(ticket);
  const closed = isTicketClosed(ticket);
  const cat = classifyInstallerStatus(ticket);

  if (report === 'CANCEL' || cat === 'cancel') return 'cancel';
  if (report === 'RESCHEDULE' || cat === 'reschedule') return 'reschedule';
  if (approval === 'APPROVED' || closed || report === 'COMPLETE' || cat === 'done') return 'complete';
  if (approval === 'REVISION' || approval === 'BUTUH APPROVAL') return 'requested';
  if (isTicketCheckedIn(ticket) || Boolean(ticket.workStartedAt)) return 'checkin';
  return 'pending';
};

const STATUS_PRIORITY_ORDER: Record<SixWoStatus, number> = {
  requested: 0,
  checkin: 1,
  pending: 2,
  reschedule: 3,
  complete: 4,
  cancel: 5
};

const SIX_STATUS_LABELS: Record<SixWoStatus, string> = {
  checkin: 'Check-in',
  complete: 'Complete',
  requested: 'Requested',
  reschedule: 'Reschedule',
  pending: 'Pending',
  cancel: 'Cancel'
};

export const InstallerDashboardView: React.FC<InstallerDashboardViewProps> = ({
  onNavigateTab,
  onSelectTicket: _onSelectTicket,
  onOpenWhatsApp
}) => {
  const {
    currentUser,
    users,
    tickets,
    todayWIB,
    startWorkOnTicket,
    sendTicketMessage,
    updateTicketStatus,
    getMessagesForTicket
  } = useApp();
  const { isOnline, pendingCount, setIsOfflineModalOpen } = useOfflineSync();
  const { toast } = useToast();

  const [fullviewTicket, setFullviewTicket] = useState<Ticket | null>(null);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<SixWoStatus | 'all'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('priority');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFilterModal, setShowFilterModal] = useState(false);

  const [quickNote, setQuickNote] = useState('');
  const [quickAttachments, setQuickAttachments] = useState<ChatAttachment[]>([]);
  const [isSendingQuick, setIsSendingQuick] = useState(false);
  const [isStartingId, setIsStartingId] = useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [checkInCameraTicket, setCheckInCameraTicket] = useState<Ticket | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Device telemetry (real browser APIs with safe fallbacks, zero hardcoded fake numbers)
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [networkEffectiveType, setNetworkEffectiveType] = useState<string | null>(null);

  // Modals: Darurat & Bantuan Korlap / Reschedule
  const [modalTargetTicketId, setModalTargetTicketId] = useState<string | null>(null);
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyText, setEmergencyText] = useState('');
  const [isSendingEmergency, setIsSendingEmergency] = useState(false);

  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpMode, setHelpMode] = useState<'korlap' | 'reschedule'>('korlap');
  const [helpNote, setHelpNote] = useState('');
  const [isSubmittingHelp, setIsSubmittingHelp] = useState(false);

  const quickFileRef = useRef<HTMLInputElement>(null);
  const ticketListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;
    type BatteryManagerLike = {
      level: number;
      addEventListener?: (evt: string, fn: () => void) => void;
      removeEventListener?: (evt: string, fn: () => void) => void;
    };
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<BatteryManagerLike>;
      connection?: { effectiveType?: string; addEventListener?: (e: string, fn: () => void) => void; removeEventListener?: (e: string, fn: () => void) => void };
    };

    let batteryRef: BatteryManagerLike | null = null;
    const syncBattery = () => {
      if (mounted && batteryRef && typeof batteryRef.level === 'number') {
        setBatteryLevel(Math.round(batteryRef.level * 100));
      }
    };

    if (typeof nav.getBattery === 'function') {
      nav
        .getBattery()
        .then(bm => {
          if (!mounted) return;
          batteryRef = bm;
          syncBattery();
          bm.addEventListener?.('levelchange', syncBattery);
        })
        .catch(() => {
          // Battery API unavailable
        });
    }

    const syncConnection = () => {
      if (!mounted) return;
      const eff = nav.connection?.effectiveType;
      setNetworkEffectiveType(eff ? eff.toUpperCase() : null);
    };
    syncConnection();
    nav.connection?.addEventListener?.('change', syncConnection);

    return () => {
      mounted = false;
      batteryRef?.removeEventListener?.('levelchange', syncBattery);
      nav.connection?.removeEventListener?.('change', syncConnection);
    };
  }, []);

  const isInstallerMatch = (ticketInstaller: string | undefined, installerName: string) => {
    if (!ticketInstaller || !ticketInstaller.trim()) return false;
    const tInst = ticketInstaller.toLowerCase().trim();
    const effInst = installerName.toLowerCase().trim();
    if (tInst === effInst) return true;
    if (tInst.includes(effInst) || effInst.includes(tInst)) return true;
    const cleanEff = effInst.replace(/\(.*?\)/g, '').trim();
    if (cleanEff && (tInst.includes(cleanEff) || cleanEff.includes(tInst))) return true;
    return false;
  };

  // Strictly filter tickets to current logged-in installer AND today's Appointment Date (WIB)
  const myTickets = useMemo(() => {
    const myName = currentUser.name || '';
    const myUsername = currentUser.username || '';
    const myId = currentUser.id || '';

    return (tickets || []).filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (!t.installerName && !t.assignedTo) return false;
      if (getTicketAppointmentDate(t) !== todayWIB) return false;

      if (t.assignedTo && (t.assignedTo === myId || t.assignedTo === myUsername || t.installerId === myId)) return true;
      if (myName && isInstallerMatch(t.installerName, myName)) return true;
      if (myUsername && isInstallerMatch(t.installerName, myUsername)) return true;
      return false;
    });
  }, [tickets, currentUser, todayWIB]);

  // Realtime synced ticket for fullview mode
  const activeFullviewTicket = useMemo(() => {
    if (!fullviewTicket) return null;
    return (tickets || []).find(t => t.id === fullviewTicket.id) || fullviewTicket;
  }, [tickets, fullviewTicket]);

  // Comprehensive stats + 6-status matrix + featured WO + OPM telemetry
  const {
    stats,
    sixCounts,
    revisionCount,
    geotagValidCount,
    checkedInCount,
    revisionTickets,
    featuredTicket
  } = useMemo(() => {
    const counts: Record<SixWoStatus, number> = {
      checkin: 0,
      complete: 0,
      requested: 0,
      reschedule: 0,
      pending: 0,
      cancel: 0
    };

    let butuhApproval = 0;
    let selesai = 0;
    let revisions: Ticket[] = [];
    let geoValid = 0;
    let checkedIn = 0;

    const buckets: Record<SixWoStatus, Ticket[]> = {
      checkin: [],
      complete: [],
      requested: [],
      reschedule: [],
      pending: [],
      cancel: []
    };

    myTickets.forEach(t => {
      const six = classifySixStatus(t);
      counts[six]++;
      buckets[six].push(t);

      const approval = getTicketCanonicalApprovalStatus(t);
      if (approval === 'BUTUH APPROVAL') butuhApproval++;
      if (approval === 'REVISION') revisions.push(t);
      if (six === 'complete') selesai++;
      if (isTicketCheckedIn(t)) checkedIn++;
      if (t.houseLocation?.geotagStatus === 'valid' || (t.houseLocation?.latitude && t.houseLocation?.longitude)) {
        geoValid++;
      }
    });

    const sortBySlot = (a: Ticket, b: Ticket) =>
      String(a.slotTime || '').localeCompare(String(b.slotTime || ''));

    (Object.keys(buckets) as SixWoStatus[]).forEach(k => buckets[k].sort(sortBySlot));

    // Featured WO prioritizes revision -> active checkin -> pending -> requested -> reschedule -> complete
    const featured =
      revisions[0] ||
      buckets.checkin[0] ||
      buckets.pending[0] ||
      buckets.requested[0] ||
      buckets.reschedule[0] ||
      buckets.complete[0] ||
      buckets.cancel[0] ||
      null;

    return {
      stats: {
        total: myTickets.length,
        butuhApproval,
        selesai
      },
      sixCounts: counts,
      revisionCount: revisions.length,
      geotagValidCount: geoValid,
      checkedInCount: checkedIn,
      revisionTickets: revisions,
      featuredTicket: featured
    };
  }, [myTickets]);

  const completedOrSubmittedCount = Math.min(
    stats.total,
    sixCounts.complete + sixCounts.requested
  );
  const remainingSlots = Math.max(0, stats.total - completedOrSubmittedCount);
  const quotaPct = stats.total > 0 ? Math.round((completedOrSubmittedCount / stats.total) * 100) : 0;

  // Filtered & sorted list for "Daftar Tiket Hari Ini"
  const displayedTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = myTickets.filter(t => {
      if (selectedStatusFilter !== 'all' && classifySixStatus(t) !== selectedStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        t.woNumber?.toLowerCase().includes(q) ||
        t.customerName?.toLowerCase().includes(q) ||
        t.idCustomer?.toLowerCase().includes(q) ||
        t.fatCode?.toLowerCase().includes(q) ||
        t.streetName?.toLowerCase().includes(q) ||
        t.clusterName?.toLowerCase().includes(q) ||
        t.area?.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortMode === 'priority') {
        const pa = STATUS_PRIORITY_ORDER[classifySixStatus(a)];
        const pb = STATUS_PRIORITY_ORDER[classifySixStatus(b)];
        if (pa !== pb) return pa - pb;
      }
      return String(a.slotTime || '').localeCompare(String(b.slotTime || ''));
    });
  }, [myTickets, selectedStatusFilter, searchQuery, sortMode]);

  // OPM Live Fiber Calibration Telemetry computed directly from myTickets
  const opmTelemetry = useMemo(() => {
    const measured = myTickets
      .map(t => ({ ticket: t, opm: extractTicketOpm(t) }))
      .filter(item => item.opm.value !== null);

    const featuredOpm = featuredTicket ? extractTicketOpm(featuredTicket) : { value: null, raw: null };
    const latestMeasured = measured[measured.length - 1] || null;

    const targetTicket =
      featuredOpm.value !== null ? featuredTicket : latestMeasured?.ticket || featuredTicket;
    const activeValue =
      featuredOpm.value !== null ? featuredOpm.value : latestMeasured?.opm.value ?? null;
    const activeRaw =
      featuredOpm.raw !== null ? featuredOpm.raw : latestMeasured?.opm.raw ?? null;

    let sopState: 'PASS' | 'WARN' | 'EMPTY' = 'EMPTY';
    if (activeValue !== null) {
      sopState = activeValue >= -24.0 && activeValue <= -16.0 ? 'PASS' : 'WARN';
    }

    // Build SVG sparkline path from actual recorded dBm values (-28 .. -12 mapped to y=22 .. y=4)
    const series = measured.map(m => m.opm.value as number);
    let sparkPath = 'M 0 13 L 100 13';
    let lastPointY = 13;
    if (series.length >= 2) {
      const clampY = (dbm: number) => {
        const clamped = Math.max(-28, Math.min(-12, dbm));
        const ratio = (clamped - -28) / (-12 - -28); // 0 (-28dBm bottom) -> 1 (-12dBm top)
        return Number((21 - ratio * 17).toFixed(1));
      };
      const pts = series.map((val, idx) => {
        const x = Number(((idx / (series.length - 1)) * 100).toFixed(1));
        const y = clampY(val);
        return { x, y };
      });
      sparkPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      lastPointY = pts[pts.length - 1].y;
    } else if (series.length === 1) {
      const clamped = Math.max(-28, Math.min(-12, series[0]));
      const ratio = (clamped - -28) / 16;
      lastPointY = Number((21 - ratio * 17).toFixed(1));
      sparkPath = `M 0 ${lastPointY} L 100 ${lastPointY}`;
    }

    return {
      targetTicket,
      activeValue,
      activeRaw,
      sopState,
      measuredCount: measured.length,
      sparkPath,
      lastPointY
    };
  }, [myTickets, featuredTicket]);

  const derivedArea = useMemo(() => {
    if (currentUser.area) return currentUser.area;
    const areas = Array.from(new Set(myTickets.map(t => t.clusterName || t.area).filter(Boolean)));
    return areas.slice(0, 2).join(' & ') || 'Area Penugasan';
  }, [currentUser.area, myTickets]);

  const derivedLeader = useMemo(() => {
    const leaderName =
      featuredTicket?.leaderName ||
      featuredTicket?.corlapName ||
      myTickets.find(t => t.leaderName || t.corlapName)?.leaderName ||
      myTickets.find(t => t.corlapName)?.corlapName ||
      '';
    const leaderObj = users.find(
      u =>
        u.role === 'leader' &&
        ((leaderName && u.name.toLowerCase() === leaderName.toLowerCase()) ||
          (featuredTicket?.leaderId && u.id === featuredTicket.leaderId) ||
          (currentUser.contractor && u.contractor?.toLowerCase() === currentUser.contractor.toLowerCase()))
    );
    return {
      name: leaderName || leaderObj?.name || 'Koordinator Lapangan',
      phone: leaderObj?.phone || ''
    };
  }, [featuredTicket, myTickets, users, currentUser.contractor]);

  const shortTodayLabel = useMemo(() => {
    const full = formatAppointmentDateDisplay(todayWIB);
    if (!full) return todayWIB;
    const parts = full.split(' ');
    return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : full;
  }, [todayWIB]);

  const modalTargetTicket = useMemo(() => {
    if (modalTargetTicketId) {
      const found = myTickets.find(t => t.id === modalTargetTicketId);
      if (found) return found;
    }
    return featuredTicket;
  }, [modalTargetTicketId, myTickets, featuredTicket]);

  const featuredMessages = useMemo(() => {
    if (!featuredTicket) return [];
    return getMessagesForTicket(featuredTicket.id);
  }, [featuredTicket, getMessagesForTicket]);

  const latestTelemetryMessage = useMemo(() => {
    if (featuredMessages.length === 0) return null;
    const progressMsgs = featuredMessages.filter(m => String(m.category || '').toUpperCase() === 'PROGRESS');
    if (progressMsgs.length > 0) return progressMsgs[progressMsgs.length - 1];
    return featuredMessages[featuredMessages.length - 1];
  }, [featuredMessages]);

  const computeTicketDuration = (ticket: Ticket): string => {
    if (ticket.workDurationFormatted) return ticket.workDurationFormatted;
    const startRef = ticket.checkInAt || ticket.workStartedAt;
    if (!startRef) return '-';
    const endRef = ticket.checkOutAt || new Date(nowTick).toISOString();
    const mins = calculateDurationMinutes(startRef, endRef);
    return mins > 0 ? formatWorkDuration(mins) : '1 menit';
  };

  const handleToggleSixStatus = (status: SixWoStatus) => {
    if (typeof window !== 'undefined' && window.navigator?.vibrate) {
      try {
        window.navigator.vibrate(25);
      } catch {
        // ignore unsupported vibrate
      }
    }
    setSelectedStatusFilter(prev => (prev === status ? 'all' : status));
  };

  const handleStartWork = async (e: React.MouseEvent, ticket: Ticket, openFullviewAfter = true) => {
    e.stopPropagation();
    if (isStartingId) return;
    setIsStartingId(ticket.id);
    try {
      const res = await startWorkOnTicket(ticket.id);
      if (res.success && res.ticket) {
        toast.success(
          `Tiket WO ${ticket.woNumber} dimulai. Silakan kirim LiveChat PROGRESS atau Check-In Foto GPS.`,
          'Mulai Dikerjakan'
        );
        if (openFullviewAfter) setFullviewTicket(res.ticket);
      } else {
        toast.error(res.error || 'Gagal memulai pengerjaan tiket.', 'Gagal Memulai');
      }
    } finally {
      setIsStartingId(null);
    }
  };

  const handleQuickFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
      if (!validTypes.includes(file.type)) {
        toast.error('Format foto harus JPG, JPEG, PNG, atau WebP.', 'Format Tidak Didukung');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`Ukuran file "${file.name}" melebihi batas 5MB.`, 'File Terlalu Besar');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const attachment: ChatAttachment = {
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
          url: reader.result as string,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type
        };
        setQuickAttachments(prev => [...prev, attachment]);
      };
      reader.readAsDataURL(file);
    });

    if (quickFileRef.current) quickFileRef.current.value = '';
  };

  const handleSendQuickProgress = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!featuredTicket || isSendingQuick) return;
    if (!quickNote.trim() && quickAttachments.length === 0) {
      toast.warning('Tulis catatan lapangan atau lampirkan foto terlebih dahulu.', 'Catatan Kosong');
      return;
    }

    setIsSendingQuick(true);
    try {
      const res = await sendTicketMessage(
        featuredTicket.id,
        quickNote.trim(),
        quickAttachments,
        'PROGRESS'
      );
      if (res.success) {
        setQuickNote('');
        setQuickAttachments([]);
        toast.success('Update PROGRESS tersimpan ke LiveChat.', 'Terkirim');
      }
    } finally {
      setIsSendingQuick(false);
    }
  };

  const handleSendEmergency = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalTargetTicket || isSendingEmergency) return;
    const msgBody = emergencyText.trim() || 'Darurat lapangan: membutuhkan eskalasi segera dari Korlap/Dispatch.';
    setIsSendingEmergency(true);
    try {
      const res = await sendTicketMessage(
        modalTargetTicket.id,
        `[DARURAT LAPANGAN] ${msgBody}`,
        [],
        'ISSUE'
      );
      if (res.success) {
        setEmergencyText('');
        setShowEmergencyModal(false);
        toast.success(
          `Laporan darurat untuk WO ${modalTargetTicket.woNumber} dikirim ke Dispatch & Korlap.`,
          'Eskalasi Terkirim'
        );
      }
    } finally {
      setIsSendingEmergency(false);
    }
  };

  const handleSubmitHelpOrReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalTargetTicket || isSubmittingHelp) return;
    const cleanNote = helpNote.trim();
    if (cleanNote.length < 5) {
      toast.warning('Tuliskan keterangan/alasan minimal 5 karakter.', 'Keterangan Wajib');
      return;
    }

    setIsSubmittingHelp(true);
    try {
      if (helpMode === 'korlap') {
        const res = await sendTicketMessage(
          modalTargetTicket.id,
          `[BANTUAN KORLAP] ${cleanNote}`,
          [],
          'ISSUE'
        );
        if (res.success) {
          setHelpNote('');
          setShowHelpModal(false);
          toast.success('Permintaan bantuan dikirim ke Korlap & Dispatch via LiveChat.', 'Terkirim');
        }
      } else {
        await updateTicketStatus(
          modalTargetTicket.id,
          undefined,
          'Pending Technical',
          `Reschedule: ${cleanNote}`
        );
        await sendTicketMessage(
          modalTargetTicket.id,
          `[PERMINTAAN RESCHEDULE] ${cleanNote}`,
          [],
          'REQUEST'
        );
        setHelpNote('');
        setShowHelpModal(false);
        toast.success(
          `Permintaan reschedule WO ${modalTargetTicket.woNumber} dicatat dan dikirim ke Dispatch.`,
          'Reschedule Diajukan'
        );
      }
    } finally {
      setIsSubmittingHelp(false);
    }
  };

  if (activeFullviewTicket) {
    return (
      <InstallerTicketFullview
        ticket={activeFullviewTicket}
        onBack={() => setFullviewTicket(null)}
        onOpenWhatsApp={onOpenWhatsApp}
      />
    );
  }

  const isFeaturedStarted = Boolean(
    featuredTicket &&
      (featuredTicket.workStartedAt ||
        featuredTicket.checkInAt ||
        ['On Site', 'En Route', 'In Progress', 'Completed', 'Installed'].includes(
          featuredTicket.statusWOInstaller
        ))
  );
  const isFeaturedCheckedIn = Boolean(featuredTicket?.checkInAt);
  const isFeaturedReported = Boolean(
    featuredTicket &&
      ((featuredTicket.progressReports && featuredTicket.progressReports.length > 0) ||
        featuredTicket.checkOutAt)
  );

  const matrixCards: Array<{
    key: SixWoStatus;
    label: string;
    count: number;
    subtitle: string;
    topBarClass: string;
    iconBoxClass: string;
    countClass: string;
    dotClass: string;
    pulseDot?: boolean;
    subtitleWarn?: boolean;
    icon: React.ReactNode;
  }> = [
    {
      key: 'checkin',
      label: 'Check-in',
      count: sixCounts.checkin,
      subtitle: geotagValidCount > 0 ? `${geotagValidCount} Geotag Valid` : 'Proses Lapangan Aktif',
      topBarClass: 'from-sky-400 to-cyan-500',
      iconBoxClass: 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300',
      countClass: 'text-sky-700 dark:text-sky-300',
      dotClass: 'bg-sky-500',
      pulseDot: sixCounts.checkin > 0,
      icon: <MapPin className="w-[18px] h-[18px]" />
    },
    {
      key: 'complete',
      label: 'Complete',
      count: sixCounts.complete,
      subtitle: 'Lolos QC / Selesai',
      topBarClass: 'from-emerald-400 to-teal-500',
      iconBoxClass: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
      countClass: 'text-emerald-700 dark:text-emerald-300',
      dotClass: 'bg-emerald-500',
      icon: <CheckCircle2 className="w-[18px] h-[18px]" />
    },
    {
      key: 'requested',
      label: 'Requested',
      count: sixCounts.requested,
      subtitle: revisionCount > 0 ? `${revisionCount} Revisi QC Dispatcher` : 'Menunggu Review QC',
      topBarClass: 'from-amber-400 to-orange-500',
      iconBoxClass: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
      countClass: 'text-amber-700 dark:text-amber-300',
      dotClass: 'bg-amber-500',
      pulseDot: revisionCount > 0,
      subtitleWarn: revisionCount > 0,
      icon: <RefreshCw className="w-[18px] h-[18px]" />
    },
    {
      key: 'reschedule',
      label: 'Reschedule',
      count: sixCounts.reschedule,
      subtitle: 'Janji Ulang Pelanggan',
      topBarClass: 'from-[#a380fe] to-[#6a46c1]',
      iconBoxClass: 'bg-[#e9ddff] dark:bg-[#2E1459] text-[#522aa7] dark:text-[#D8B4FE]',
      countClass: 'text-[#6a46c1] dark:text-[#D8B4FE]',
      dotClass: 'bg-[#6a46c1]',
      icon: <CalendarClock className="w-[18px] h-[18px]" />
    },
    {
      key: 'pending',
      label: 'Pending',
      count: sixCounts.pending,
      subtitle: 'Menunggu Mulai / Kendala',
      topBarClass: 'from-yellow-500 to-amber-600',
      iconBoxClass: 'bg-yellow-50 dark:bg-yellow-950/50 text-yellow-700 dark:text-yellow-300',
      countClass: 'text-yellow-800 dark:text-yellow-300',
      dotClass: 'bg-yellow-500',
      icon: <Clock className="w-[18px] h-[18px]" />
    },
    {
      key: 'cancel',
      label: 'Cancel',
      count: sixCounts.cancel,
      subtitle: sixCounts.cancel === 0 ? 'Nol Pembatalan' : 'Dibatalkan / Gagal',
      topBarClass: 'from-rose-400 to-red-600',
      iconBoxClass: 'bg-[#ffdad6] dark:bg-rose-950/60 text-[#93000a] dark:text-rose-300',
      countClass: 'text-[#ba1a1a] dark:text-rose-300',
      dotClass: 'bg-[#ba1a1a]',
      icon: <Ban className="w-[18px] h-[18px]" />
    }
  ];

  return (
    <div className="max-w-lg lg:max-w-6xl mx-auto space-y-4 pb-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* =============================================================== */}
        {/* LEFT COLUMN (Mobile Top Stack / Desktop Left Telemetry Column)  */}
        {/* =============================================================== */}
        <div className="lg:col-span-5 space-y-4">
          {/* 1. TECHNICIAN TELEMETRY QUICK-BAR */}
          <section className="w-full bg-white dark:bg-[#1E1238] rounded-2xl p-3.5 border border-[#e8ddff] dark:border-[#3b1d78] shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(53,16,94,0.06)] relative overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-[#7135b5]/45 to-transparent" />
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="relative shrink-0">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#58149c] via-[#7135b5] to-[#6a46c1] p-[2px] shadow-sm">
                    <div className="w-full h-full rounded-[10px] bg-gradient-to-b from-[#6a46c1] to-[#35105e] text-white font-display font-extrabold text-sm flex items-center justify-center tracking-wide">
                      {getInitials(currentUser.name)}
                    </div>
                  </div>
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-[#1E1238] flex items-center justify-center">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                      }`}
                    />
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <h1 className="font-display font-bold text-[15px] sm:text-base text-[#1f1638] dark:text-white truncate">
                      {currentUser.name}
                    </h1>
                    <span className="px-1.5 py-0.5 rounded bg-[#eedbff] dark:bg-[#35105E] text-[#2a0053] dark:text-[#DAB9FF] font-mono text-[10px] font-bold tracking-wide shrink-0">
                      @{currentUser.username}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-[#4b4452] dark:text-[#CEC0E8] truncate mt-0.5">
                    {currentUser.contractor || 'Mitra FTTH'} · {derivedArea} · {shortTodayLabel}
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1 shrink-0 pl-1">
                <button
                  type="button"
                  onClick={() => setIsOfflineModalOpen(true)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold cursor-pointer transition-colors ${
                    isOnline
                      ? 'bg-[#eee4ff] dark:bg-[#2a1647] text-[#1f1638] dark:text-[#DAB9FF]'
                      : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                  }`}
                  title="Status Jaringan & Offline Queue"
                >
                  {isOnline ? (
                    <Wifi className="w-3 h-3 text-[#58149c] dark:text-[#DAB9FF]" />
                  ) : (
                    <WifiOff className="w-3 h-3 text-amber-600" />
                  )}
                  <span>{isOnline ? networkEffectiveType || 'Online' : 'Offline'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsOfflineModalOpen(true)}
                  className={`inline-flex items-center gap-1 text-[10.5px] font-bold tabular-nums cursor-pointer ${
                    pendingCount > 0
                      ? 'text-amber-600 dark:text-amber-300'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                  title="Status Sinkronisasi & Baterai Perangkat"
                >
                  <BatteryCharging className="w-3.5 h-3.5" />
                  <span>
                    {batteryLevel !== null
                      ? `${batteryLevel}%${pendingCount > 0 ? ` · ${pendingCount} Antre` : ''}`
                      : pendingCount > 0
                      ? `${pendingCount} Antrean`
                      : 'Sync OK'}
                  </span>
                </button>
              </div>
            </div>
          </section>

          {/* 2. KEPATUHAN SOP & PROGRES KUOTA HARIAN CARD */}
          <section className="w-full bg-gradient-to-br from-white via-white to-[#f8f1ff] dark:from-[#1E1238] dark:via-[#1E1238] dark:to-[#160D29] rounded-2xl p-4 border border-[#e8ddff] dark:border-[#3b1d78] shadow-[0_1px_3px_rgba(33,24,58,0.04),0_12px_24px_-4px_rgba(53,16,94,0.08)] relative overflow-hidden">
            <div className="absolute -right-8 -top-8 w-36 h-36 bg-[#7135b5]/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#eedbff] dark:bg-[#35105E] flex items-center justify-center text-[#58149c] dark:text-[#DAB9FF] shadow-inner shrink-0">
                  <Award className="w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#4b4452] dark:text-[#CEC0E8] block">
                    KEPATUHAN &amp; KUOTA HARIAN
                  </span>
                  <h2 className="font-display font-bold text-[15px] sm:text-base text-[#1f1638] dark:text-white truncate">
                    {getWibGreeting()} · Korlap {derivedLeader.name}
                  </h2>
                </div>
              </div>

              <div className="text-right shrink-0">
                <span className="font-display text-lg font-extrabold text-[#58149c] dark:text-[#DAB9FF] leading-none tabular-nums block">
                  {completedOrSubmittedCount}/{stats.total}
                </span>
                <span className="text-[10px] font-semibold text-[#4b4452] dark:text-[#CEC0E8] block mt-0.5">
                  WO Hari Ini
                </span>
              </div>
            </div>

            <div className="space-y-2 bg-[#f3eaff] dark:bg-[#160D29] rounded-xl p-3 border border-[#e8ddff]/80 dark:border-[#35105E]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-bold text-[#1f1638] dark:text-white truncate">
                    Progres SOP &amp; Pelaporan WO
                  </span>
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                </div>
                <span className="font-display text-sm font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0">
                  {quotaPct}%
                </span>
              </div>

              <div className="w-full h-2.5 bg-[#eee4ff] dark:bg-[#2C184D] rounded-full overflow-hidden p-[1px]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#6a46c1] to-[#7135b5] shadow-xs relative transition-all duration-500"
                  style={{ width: `${quotaPct}%` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/30" />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-[11px] text-[#4b4452] dark:text-[#CEC0E8] pt-0.5 tabular-nums flex-wrap">
                <span>
                  Check-in: <strong className="text-[#1f1638] dark:text-white">{checkedInCount}/{stats.total}</strong> · Sisa {remainingSlots} WO
                </span>
                <button
                  type="button"
                  onClick={() => onNavigateTab('installer_tasks', 'butuh_approval')}
                  className="font-bold text-[#58149c] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                >
                  {stats.butuhApproval} Menunggu QC →
                </button>
              </div>
            </div>
          </section>

          {/* 3. LIVE OPM FIBER CALIBRATION TELEMETRY CARD */}
          <section
            onClick={() => {
              if (opmTelemetry.targetTicket) {
                setFullviewTicket(opmTelemetry.targetTicket);
              }
            }}
            className={`w-full bg-white dark:bg-[#1E1238] rounded-2xl p-4 border border-[#e8ddff] dark:border-[#3b1d78] shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(53,16,94,0.06)] space-y-3 ${
              opmTelemetry.targetTicket ? 'cursor-pointer hover:border-[#cec3d4] transition-colors' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-[#e9ddff] dark:bg-[#35105E] text-[#22005c] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                  <Radio className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display font-bold text-sm text-[#1f1638] dark:text-white truncate">
                    Live OPM Fiber Calibration
                  </h3>
                  <span className="text-[11px] text-[#4b4452] dark:text-[#CEC0E8] truncate block">
                    {opmTelemetry.targetTicket
                      ? `${opmTelemetry.targetTicket.woNumber} · ${opmTelemetry.measuredCount} Pengukuran Terukur`
                      : 'Menunggu Pengukuran Redaman WO'}
                  </span>
                </div>
              </div>

              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-bold shrink-0 ${
                  opmTelemetry.sopState === 'PASS'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                    : opmTelemetry.sopState === 'WARN'
                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
                    : 'bg-[#f3eaff] text-[#58149c] dark:bg-[#35105E] dark:text-[#DAB9FF]'
                }`}
              >
                {opmTelemetry.sopState === 'PASS'
                  ? 'PASS SOP'
                  : opmTelemetry.sopState === 'WARN'
                  ? 'REVISI REDAMAN'
                  : 'BELUM DIUKUR'}
              </span>
            </div>

            {/* Dark High-Contrast Signal Telemetry Panel */}
            <div className="w-full bg-[#160D29] rounded-xl p-3.5 text-white relative overflow-hidden shadow-inner">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <div>
                  <span className="text-[10px] font-semibold text-[#d0bcff] uppercase tracking-wider block">
                    Rx Power (1490nm GPON)
                  </span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="font-display text-2xl sm:text-[28px] font-extrabold tracking-tight text-white tabular-nums">
                      {opmTelemetry.activeRaw ?? '--.--'}
                    </span>
                    <span className="text-xs font-semibold text-[#d0bcff]">dBm</span>
                  </div>
                </div>

                <div className="text-right min-w-0">
                  <span className="text-[10.5px] text-emerald-400 block font-semibold tabular-nums">
                    Standar: -16.0 ~ -24.0
                  </span>
                  <span className="font-mono text-[10.5px] text-white/70 truncate block mt-0.5">
                    {opmTelemetry.targetTicket
                      ? `${opmTelemetry.targetTicket.fatCode || opmTelemetry.targetTicket.fdtCode || 'FAT -'} / Port ${
                          opmTelemetry.targetTicket.fatPort ||
                          opmTelemetry.targetTicket.technicalReport?.fatPort ||
                          '-'
                        }`
                      : 'ODP / Port -'}
                  </span>
                </div>
              </div>

              {/* Dynamic Waveform Optical Sparkline */}
              <div className="w-full h-8 pt-1">
                <svg
                  className="w-full h-full text-[#d0bcff] overflow-visible"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 24"
                  aria-label="Grafik tren redaman OPM hari ini"
                >
                  <path
                    d={opmTelemetry.sparkPath}
                    fill="none"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                  {opmTelemetry.activeValue !== null && (
                    <>
                      <circle
                        className="animate-ping"
                        cx="100"
                        cy={opmTelemetry.lastPointY}
                        fill={opmTelemetry.sopState === 'PASS' ? '#34d399' : '#fbbf24'}
                        r="3.2"
                      />
                      <circle
                        cx="100"
                        cy={opmTelemetry.lastPointY}
                        fill={opmTelemetry.sopState === 'PASS' ? '#10b981' : '#f59e0b'}
                        r="2.4"
                      />
                    </>
                  )}
                </svg>
              </div>
            </div>
          </section>

          {/* 4. QUICK SOP CHECK-IN & UPDATE PANEL (when featuredTicket exists) */}
          {featuredTicket && (
            <section className="w-full bg-white dark:bg-[#1E1238] rounded-2xl p-4 border border-[#e8ddff] dark:border-[#3b1d78] shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(53,16,94,0.06)] space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#58149c] dark:text-[#DAB9FF]">
                    WO PRIORITAS &amp; SOP CHECK-IN
                  </span>
                  <h3 className="font-display font-bold text-sm text-[#1f1638] dark:text-white truncate">
                    {featuredTicket.woNumber} · {featuredTicket.customerName}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setFullviewTicket(featuredTicket)}
                  className="px-2.5 py-1 rounded-lg bg-[#f3eaff] dark:bg-[#35105E] text-[#58149c] dark:text-[#DAB9FF] text-[11px] font-bold shrink-0 cursor-pointer hover:bg-[#eee4ff]"
                >
                  Buka Fullview
                </button>
              </div>

              {/* 3-Step Compact Checklist */}
              <div className="space-y-2 bg-[#f8f1ff] dark:bg-[#160D29] rounded-xl p-3 border border-[#e8ddff]/80 dark:border-[#35105E]">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                        isFeaturedStarted
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#7135b5] text-white'
                      }`}
                    >
                      {isFeaturedStarted ? <CheckCircle2 className="w-3.5 h-3.5" /> : '1'}
                    </span>
                    <span className="font-semibold text-[#1f1638] dark:text-white truncate">
                      {isFeaturedStarted
                        ? `Mulai ${formatJakartaTimeOnly(featuredTicket.workStartedAt || featuredTicket.checkInAt)}`
                        : 'Step 1: Mulai Kerjakan'}
                    </span>
                  </div>
                  {!isFeaturedStarted && (
                    <button
                      type="button"
                      disabled={isStartingId === featuredTicket.id}
                      onClick={e => handleStartWork(e, featuredTicket, false)}
                      className="mj-tactile-btn-primary px-2.5 py-1 rounded-lg text-[10.5px] cursor-pointer shrink-0 disabled:opacity-60"
                    >
                      {isStartingId === featuredTicket.id ? 'Memulai...' : 'Mulai'}
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                        isFeaturedCheckedIn
                          ? 'bg-emerald-600 text-white'
                          : 'bg-[#58149c] text-white'
                      }`}
                    >
                      {isFeaturedCheckedIn ? <CheckCircle2 className="w-3.5 h-3.5" /> : '2'}
                    </span>
                    <span className="font-semibold text-[#1f1638] dark:text-white truncate">
                      {isFeaturedCheckedIn
                        ? `Check-in GPS ${formatJakartaTimeOnly(featuredTicket.checkInAt)}`
                        : 'Step 2: Check-in Foto GPS'}
                    </span>
                  </div>
                  {!isFeaturedCheckedIn && (
                    <button
                      type="button"
                      onClick={() => setCheckInCameraTicket(featuredTicket)}
                      className="btn-3d-amber px-2.5 py-1 rounded-lg text-[10.5px] font-bold cursor-pointer shrink-0 inline-flex items-center gap-1"
                    >
                      <Camera className="w-3 h-3" />
                      <span>Foto GPS</span>
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 ${
                        isFeaturedReported
                          ? 'bg-emerald-600 text-white'
                          : isFeaturedCheckedIn
                          ? 'bg-[#58149c] text-white'
                          : 'bg-[#e8ddff] dark:bg-[#2C184D] text-[#7d7484]'
                      }`}
                    >
                      {isFeaturedReported ? <CheckCircle2 className="w-3.5 h-3.5" /> : '3'}
                    </span>
                    <span className="font-semibold text-[#1f1638] dark:text-white truncate">
                      {isFeaturedReported
                        ? `Check-out (${featuredTicket.workDurationFormatted || 'Selesai'})`
                        : isFeaturedCheckedIn
                        ? 'Step 3: Siap Isi Laporan 3-Tingkat'
                        : 'Step 3: Terkunci hingga Check-in'}
                    </span>
                  </div>
                  {isFeaturedCheckedIn && (
                    <button
                      type="button"
                      onClick={() => setFullviewTicket(featuredTicket)}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#2A1647] border border-[#cec3d4] dark:border-[#532B97] text-[#58149c] dark:text-[#DAB9FF] text-[10.5px] font-bold cursor-pointer shrink-0"
                    >
                      Isi Laporan
                    </button>
                  )}
                </div>
              </div>

              {/* Latest Telemetry Note Preview + Quick PROGRESS Sender */}
              {latestTelemetryMessage && (
                <div className="rounded-xl bg-[#fdf7ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] px-3 py-2 text-[11px] flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-[#4b4452] dark:text-[#CEC0E8]">
                    <span className="font-mono font-bold text-[#58149c] dark:text-[#DAB9FF] mr-1">
                      [{(latestTelemetryMessage.category || 'PROGRESS').toUpperCase()}]
                    </span>
                    <span>{latestTelemetryMessage.text || 'Lampiran foto lapangan terkirim'}</span>
                  </div>
                  <span className="font-mono text-[10px] text-[#7d7484] shrink-0 tabular-nums">
                    {formatJakartaTimeOnly(latestTelemetryMessage.timestamp)}
                  </span>
                </div>
              )}

              <form onSubmit={handleSendQuickProgress} className="space-y-2">
                {quickAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {quickAttachments.map(att => (
                      <div
                        key={att.id}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#f3eaff] dark:bg-[#2A1647] border border-[#d8ccf3] text-[11px]"
                      >
                        <img
                          src={att.url}
                          alt={att.fileName}
                          className="w-5 h-5 rounded object-cover"
                        />
                        <span className="max-w-[110px] truncate font-medium text-[#1f1638] dark:text-white">
                          {att.fileName}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQuickAttachments(prev => prev.filter(x => x.id !== att.id))}
                          className="text-[#ba1a1a] cursor-pointer"
                          aria-label="Hapus lampiran"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    ref={quickFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/jpg"
                    capture="environment"
                    multiple
                    onChange={handleQuickFileSelect}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => quickFileRef.current?.click()}
                    aria-label="Ambil atau pilih foto lapangan"
                    className="min-w-[42px] min-h-[42px] rounded-xl bg-[#f3eaff] dark:bg-[#2A1647] border border-[#e8ddff] dark:border-[#4b386b] text-[#58149c] dark:text-[#DAB9FF] flex items-center justify-center hover:bg-[#eee4ff] transition-colors cursor-pointer shrink-0"
                  >
                    <Camera className="w-[18px] h-[18px]" />
                  </button>
                  <input
                    type="text"
                    value={quickNote}
                    onChange={e => setQuickNote(e.target.value)}
                    placeholder="Kirim catatan LiveChat #PROGRESS..."
                    className="flex-1 min-w-0 min-h-[42px] px-3 rounded-xl bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] text-xs text-[#1f1638] dark:text-white placeholder:text-[#7d7484] focus:outline-none focus:ring-2 focus:ring-[#58149c]"
                  />
                  <button
                    type="submit"
                    disabled={isSendingQuick || (!quickNote.trim() && quickAttachments.length === 0)}
                    aria-label="Kirim update PROGRESS"
                    className="min-w-[42px] min-h-[42px] rounded-xl bg-[#58149c] hover:bg-[#7135b5] disabled:opacity-45 text-white flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>

              {/* 3 Quick Field Action Buttons */}
              <div className="grid grid-cols-3 gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() =>
                    openCustomerAddressInGoogleMaps(featuredTicket, () => {
                      toast.warning('Alamat pelanggan belum tersedia untuk Google Maps.', 'Google Maps');
                    })
                  }
                  className="min-h-[40px] rounded-xl bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] text-[#58149c] dark:text-[#DAB9FF] text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-[#f3eaff]"
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Maps</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenWhatsApp(featuredTicket)}
                  className="min-h-[40px] rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-emerald-100/70"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>WhatsApp</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModalTargetTicketId(featuredTicket.id);
                    setShowEmergencyModal(true);
                  }}
                  className="min-h-[40px] rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[#ba1a1a] dark:text-rose-300 text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer hover:bg-rose-100/70"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Darurat</span>
                </button>
              </div>
            </section>
          )}
        </div>

        {/* =============================================================== */}
        {/* RIGHT COLUMN (Matriks 6 Status WO + Daftar Tiket + 3D Triggers) */}
        {/* =============================================================== */}
        <div className="lg:col-span-7 space-y-4">
          {/* Revision Alert Banner if any ticket requires Dispatcher QC revision */}
          {revisionTickets.length > 0 && (
            <section className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/70 p-3.5 shadow-xs space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span className="text-xs font-extrabold uppercase tracking-wide">
                    {revisionTickets.length} WO Memerlukan Revisi QC Dispatcher
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStatusFilter('requested')}
                  className="text-[11px] font-bold text-amber-800 dark:text-amber-300 underline cursor-pointer"
                >
                  Tampilkan Semua
                </button>
              </div>
            </section>
          )}

          {/* 5. MATRIKS 6 STATUS WORK ORDER (2x3 Grid with Top Color Bars) */}
          <section className="space-y-2.5">
            <div className="flex items-center justify-between px-0.5">
              <div className="flex items-center gap-1.5">
                <PieChart className="w-[18px] h-[18px] text-[#58149c] dark:text-[#DAB9FF]" />
                <h2 className="font-display font-bold text-[15px] sm:text-base text-[#1f1638] dark:text-white">
                  Matriks 6 Status Work Order
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setSelectedStatusFilter('all')}
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full tabular-nums transition-colors cursor-pointer ${
                  selectedStatusFilter !== 'all'
                    ? 'bg-[#58149c] text-white'
                    : 'bg-[#eee4ff] dark:bg-[#2a1647] text-[#4b4452] dark:text-[#CEC0E8]'
                }`}
                title={selectedStatusFilter !== 'all' ? 'Reset filter status' : 'Total penugasan hari ini'}
              >
                {selectedStatusFilter !== 'all'
                  ? `Reset Filter (${myTickets.length})`
                  : `${myTickets.length} Penugasan`}
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {matrixCards.map(card => {
                const isSelected = selectedStatusFilter === card.key;
                const isZero = card.count === 0;
                return (
                  <button
                    key={card.key}
                    type="button"
                    onClick={() => handleToggleSixStatus(card.key)}
                    aria-pressed={isSelected}
                    className={`text-left relative bg-white dark:bg-[#1E1238] rounded-xl p-3 shadow-[0_4px_10px_rgba(31,22,56,0.06),0_1px_2px_rgba(31,22,56,0.04)] active:translate-y-[1px] transition-all overflow-hidden cursor-pointer ${
                      isSelected
                        ? 'ring-2 ring-[#58149c] dark:ring-[#DAB9FF] bg-[#fdf7ff] dark:bg-[#261645]'
                        : isZero
                        ? 'opacity-85 hover:opacity-100'
                        : 'hover:shadow-[0_6px_14px_rgba(88,20,156,0.1)]'
                    }`}
                  >
                    <div
                      className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${card.topBarClass}`}
                    />
                    <div className="flex items-start justify-between">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-[inset_0_1px_2px_rgba(255,255,255,0.85),0_2px_4px_rgba(31,22,56,0.08)] ${card.iconBoxClass}`}
                      >
                        {card.icon}
                      </div>
                      <span
                        className={`font-display text-[22px] font-extrabold leading-none tabular-nums ${card.countClass}`}
                      >
                        {card.count}
                      </span>
                    </div>

                    <div className="mt-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${card.dotClass} ${
                            card.pulseDot ? 'animate-pulse' : ''
                          }`}
                        />
                        <span className="font-display font-bold text-[14px] text-[#1f1638] dark:text-white truncate">
                          {card.label}
                        </span>
                      </div>
                      <p
                        className={`text-[11px] mt-0.5 truncate ${
                          card.subtitleWarn
                            ? 'text-amber-800 dark:text-amber-300 font-semibold'
                            : 'text-[#4b4452] dark:text-[#CEC0E8]'
                        }`}
                      >
                        {card.subtitle}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 6. DAFTAR TIKET HARI INI */}
          <section ref={ticketListRef} className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 px-0.5 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <h2 className="font-display font-bold text-[15px] sm:text-base text-[#1f1638] dark:text-white">
                  Daftar Tiket Hari Ini
                </h2>
                {selectedStatusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setSelectedStatusFilter('all')}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#eedbff] dark:bg-[#35105E] text-[#58149c] dark:text-[#DAB9FF] text-[10.5px] font-bold cursor-pointer"
                  >
                    <span>{SIX_STATUS_LABELS[selectedStatusFilter]}</span>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setSortMode(prev => (prev === 'priority' ? 'slot' : 'priority'))}
                className="inline-flex items-center gap-1 text-[11.5px] font-bold text-[#58149c] dark:text-[#DAB9FF] cursor-pointer hover:underline"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span>{sortMode === 'priority' ? 'Urutkan Status' : 'Urutkan Slot'}</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {displayedTickets.length === 0 ? (
              <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#e8ddff] dark:border-[#3b1d78] p-7 text-center space-y-3 shadow-xs">
                <div className="w-11 h-11 rounded-2xl bg-[#f3eaff] dark:bg-[#2A1647] text-[#58149c] dark:text-[#DAB9FF] flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-display text-sm font-bold text-[#1f1638] dark:text-white">
                    {myTickets.length === 0
                      ? 'Belum Ada Penugasan WO Hari Ini'
                      : 'Tidak Ada Tiket Sesuai Filter'}
                  </h3>
                  <p className="text-xs text-[#4b4452] dark:text-[#CEC0E8] max-w-sm mx-auto">
                    {myTickets.length === 0
                      ? `Work Order yang ditugaskan Leader untuk tanggal ${
                          formatAppointmentDateDisplay(todayWIB) || todayWIB
                        } akan muncul otomatis di sini.`
                      : 'Coba ubah atau reset filter status untuk melihat Work Order lainnya hari ini.'}
                  </p>
                </div>
                {selectedStatusFilter !== 'all' || searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedStatusFilter('all');
                      setSearchQuery('');
                    }}
                    className="mj-tactile-btn-primary inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs cursor-pointer"
                  >
                    <span>Tampilkan Semua Tiket ({myTickets.length})</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onNavigateTab('installer_tasks', 'all')}
                    className="mj-tactile-btn-primary inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs cursor-pointer"
                  >
                    <span>Buka Halaman Tugas Saya</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {displayedTickets.map(ticket => {
                  const six = classifySixStatus(ticket);
                  const approval = getTicketCanonicalApprovalStatus(ticket);
                  const thumbUrl = extractTicketThumbnail(ticket);
                  const opm = extractTicketOpm(ticket);
                  const notStarted =
                    !ticket.workStartedAt &&
                    !ticket.checkInAt &&
                    (!ticket.statusWOInstaller || ticket.statusWOInstaller === 'Assigned');
                  const isCheckedIn = isTicketCheckedIn(ticket);
                  const revisionReason =
                    ticket.rejectionReason ||
                    ticket.dispatchRejectionNotes ||
                    ticket.progressReports?.[0]?.revisionReason ||
                    ticket.progressReports?.[0]?.rejectionReason;

                  const badgeSpec = (() => {
                    switch (six) {
                      case 'complete':
                        return {
                          label: 'COMPLETE',
                          cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
                          icon: <CheckCircle2 className="w-3.5 h-3.5" />
                        };
                      case 'requested':
                        return {
                          label: approval === 'REVISION' ? 'REVISI QC' : 'REQUESTED QC',
                          cls: 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
                          icon: <RefreshCw className="w-3.5 h-3.5" />
                        };
                      case 'checkin':
                        return {
                          label: 'CHECK-IN (PROSES)',
                          cls: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
                          icon: <RotateCw className="w-3.5 h-3.5 animate-spin" />
                        };
                      case 'reschedule':
                        return {
                          label: 'RESCHEDULE',
                          cls: 'bg-[#e9ddff] text-[#22005c] dark:bg-[#2E1459] dark:text-[#D8B4FE]',
                          icon: <CalendarClock className="w-3.5 h-3.5" />
                        };
                      case 'cancel':
                        return {
                          label: 'CANCEL',
                          cls: 'bg-[#ffdad6] text-[#93000a] dark:bg-rose-950/60 dark:text-rose-300',
                          icon: <Ban className="w-3.5 h-3.5" />
                        };
                      default:
                        return {
                          label: 'PENDING / BARU',
                          cls: 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/50 dark:text-yellow-300',
                          icon: <Clock className="w-3.5 h-3.5" />
                        };
                    }
                  })();

                  const addressSummary = [
                    ticket.streetName || ticket.address || ticket.clusterName,
                    ticket.area,
                    ticket.fatCode || ticket.fdtCode
                  ]
                    .filter(Boolean)
                    .join(' · ');

                  return (
                    <article
                      key={ticket.id}
                      onClick={() => setFullviewTicket(ticket)}
                      className={`w-full bg-white dark:bg-[#1E1238] rounded-xl p-3.5 border transition-all cursor-pointer space-y-2.5 relative ${
                        approval === 'REVISION'
                          ? 'border-amber-300 dark:border-amber-700/70 shadow-[0_1px_3px_rgba(33,24,58,0.04),0_8px_16px_-4px_rgba(217,119,6,0.12)]'
                          : 'border-[#e8ddff] dark:border-[#3b1d78] shadow-[0_1px_3px_rgba(33,24,58,0.04),0_6px_12px_-3px_rgba(53,16,94,0.05)] hover:border-[#cec3d4]'
                      }`}
                    >
                      {/* Top Header: WO Number + Semantic Status Badge */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs sm:text-[13px] font-bold text-[#1f1638] dark:text-white tracking-tight">
                          {ticket.woNumber}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold shrink-0 ${badgeSpec.cls}`}
                        >
                          {badgeSpec.icon}
                          <span>{badgeSpec.label}</span>
                        </span>
                      </div>

                      {/* Middle Body: Real Evidence/House Thumbnail + Customer + Address */}
                      <div className="flex items-start gap-2.5">
                        {thumbUrl ? (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setZoomImageUrl(thumbUrl);
                            }}
                            className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-[#e8ddff] dark:border-[#35105E] group cursor-pointer"
                            aria-label={`Perbesar foto ${ticket.woNumber}`}
                          >
                            <img
                              src={thumbUrl}
                              alt={`Evidence ${ticket.woNumber}`}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            <span className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Maximize2 className="w-3.5 h-3.5 text-white" />
                            </span>
                          </button>
                        ) : (
                          <div className="w-11 h-11 rounded-lg bg-[#f3eaff] dark:bg-[#2A1647] border border-[#e8ddff] dark:border-[#3b1d78] flex items-center justify-center shrink-0 text-[#58149c] dark:text-[#DAB9FF]">
                            <Wrench className="w-4 h-4" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <h3 className="font-display font-bold text-[14.5px] text-[#1f1638] dark:text-white truncate">
                            {ticket.customerName || 'Pelanggan'}
                            {ticket.plan || ticket.serviceType ? (
                              <span className="font-medium text-xs text-[#58149c] dark:text-[#DAB9FF] ml-1">
                                ({ticket.plan || ticket.serviceType})
                              </span>
                            ) : null}
                          </h3>
                          <p className="text-xs text-[#4b4452] dark:text-[#CEC0E8] truncate mt-0.5">
                            {addressSummary || 'Alamat & ODP belum dilengkapi'}
                          </p>
                        </div>
                      </div>

                      {/* Revision Warning Callout if Dispatch returned for revision */}
                      {approval === 'REVISION' && (
                        <div className="bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 flex items-start gap-2 text-amber-900 dark:text-amber-200">
                          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          <div className="text-left text-xs min-w-0">
                            <span className="font-bold block">Catatan QC Dispatcher:</span>
                            <span className="block leading-relaxed">
                              {revisionReason || 'Harap perbaiki data & lampiran laporan teknis lalu kirim ulang.'}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Footer Telemetry Row */}
                      <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-[#4b4452] dark:text-[#CEC0E8] tabular-nums flex-wrap">
                        {six === 'complete' ? (
                          <>
                            <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
                              {approval === 'APPROVED' ? 'QC Approved' : 'Laporan Terkirim'}
                              {opm.raw ? ` · Redaman: ${opm.raw} dBm` : ''}
                            </span>
                            <span className="font-mono">
                              {ticket.checkOutAt
                                ? `Selesai ${formatJakartaTimeOnly(ticket.checkOutAt)} WIB`
                                : ticket.slotTime || 'Hari Ini'}
                            </span>
                          </>
                        ) : six === 'checkin' ? (
                          <>
                            <span className="text-sky-700 dark:text-sky-300 font-semibold flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" />
                              <span>Durasi: {computeTicketDuration(ticket)}</span>
                            </span>
                            <span
                              className={`font-semibold ${
                                ticket.houseLocation?.latitude
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : 'text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {ticket.houseLocation?.latitude
                                ? ticket.houseLocation.accuracyMeters
                                  ? `Geotag Valid (${Math.round(ticket.houseLocation.accuracyMeters)}m)`
                                  : 'Geotag Valid'
                                : 'Belum Geotag Rumah'}
                            </span>
                          </>
                        ) : six === 'reschedule' ? (
                          <>
                            <span className="text-[#6a46c1] dark:text-[#D8B4FE] font-semibold truncate max-w-[200px]">
                              {ticket.remarksWOInstaller || ticket.remarks || `Slot: ${ticket.slotTime || '-'}`}
                            </span>
                            <span>{formatWaTelemetryLabel(ticket.statusWhatsApp)}</span>
                          </>
                        ) : (
                          <>
                            <span className="font-medium">
                              Slot: <strong className="text-[#1f1638] dark:text-white">{ticket.slotTime || 'Fleksibel'}</strong>
                            </span>
                            <span>{formatWaTelemetryLabel(ticket.statusWhatsApp)}</span>
                          </>
                        )}
                      </div>

                      {/* Quick Operational Actions Footer */}
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#e8ddff]/70 dark:border-[#35105E]">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              openCustomerAddressInGoogleMaps(ticket, () => {
                                toast.warning('Alamat pelanggan belum tersedia untuk Google Maps.', 'Google Maps');
                              });
                            }}
                            aria-label="Buka Google Maps"
                            title="Buka Google Maps"
                            className="w-9 h-9 rounded-lg bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] text-[#58149c] dark:text-[#DAB9FF] flex items-center justify-center hover:bg-[#f3eaff] cursor-pointer"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              onOpenWhatsApp(ticket);
                            }}
                            aria-label="Hubungi via WhatsApp"
                            title="Hubungi via WhatsApp"
                            className="w-9 h-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 flex items-center justify-center hover:bg-emerald-100 cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {approval === 'REVISION' ? (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setFullviewTicket(ticket);
                              }}
                              className="px-3 py-2 min-h-[38px] rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-[0_2px_4px_rgba(217,119,6,0.3)] active:scale-95 transition-all cursor-pointer whitespace-nowrap"
                            >
                              Upload Revisi OPM
                            </button>
                          ) : notStarted ? (
                            <button
                              type="button"
                              disabled={isStartingId === ticket.id}
                              onClick={e => handleStartWork(e, ticket, true)}
                              className="mj-tactile-btn-primary px-3.5 py-2 min-h-[38px] rounded-lg text-[11px] uppercase tracking-wide flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-60 whitespace-nowrap"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>{isStartingId === ticket.id ? 'MEMULAI...' : 'MULAI KERJAKAN'}</span>
                            </button>
                          ) : !isCheckedIn && six !== 'complete' && six !== 'cancel' ? (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setCheckInCameraTicket(ticket);
                              }}
                              className="btn-3d-amber px-3 py-2 min-h-[38px] rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              <span>Check-In GPS</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                setFullviewTicket(ticket);
                              }}
                              className="mj-tactile-btn-secondary px-3 py-2 min-h-[38px] rounded-lg border border-[#cec3d4] dark:border-[#4b386b] text-[#58149c] dark:text-[#DAB9FF] text-xs flex items-center gap-1.5 cursor-pointer shrink-0 whitespace-nowrap"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                              <span>Buka Tiket</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {/* 7. BOTTOM TACTILE 3D ACTION TRIGGERS */}
          <section className="pt-1 space-y-2.5">
            <button
              type="button"
              onClick={() => {
                if (featuredTicket) {
                  setFullviewTicket(featuredTicket);
                } else {
                  onNavigateTab('installer_tasks', 'all');
                }
              }}
              className="w-full py-3.5 px-4 min-h-[48px] rounded-xl bg-gradient-to-b from-[#7135b5] to-[#58149c] text-white font-display text-sm font-bold shadow-[inset_0_1px_0_0_rgba(216,180,254,0.4),0_4px_12px_rgba(88,20,156,0.3)] border-b-2 border-[#35105E] active:translate-y-[1px] active:shadow-none flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <FileCheck2 className="w-5 h-5 shrink-0" />
              <span>Buka Checklist QC Harian (Formulir WO)</span>
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setShowFilterModal(true)}
                className="w-full py-3 px-4 min-h-[46px] rounded-xl bg-white dark:bg-[#1E1238] text-[#1f1638] dark:text-white border border-[#e8ddff] dark:border-[#3b1d78] font-display text-xs sm:text-sm font-bold shadow-[0_2px_8px_rgba(53,16,94,0.06)] active:translate-y-[1px] flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <SlidersHorizontal className="w-4 h-4 text-[#58149c] dark:text-[#DAB9FF]" />
                <span>Filter Berdasarkan 6 Status WO</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (featuredTicket) {
                    setModalTargetTicketId(featuredTicket.id);
                    setHelpMode('korlap');
                    setShowHelpModal(true);
                  } else {
                    onNavigateTab('installer_chat', 'all');
                  }
                }}
                className="w-full py-3 px-4 min-h-[46px] rounded-xl bg-white dark:bg-[#1E1238] text-[#1f1638] dark:text-white border border-[#e8ddff] dark:border-[#3b1d78] font-display text-xs sm:text-sm font-bold shadow-[0_2px_8px_rgba(53,16,94,0.06)] active:translate-y-[1px] flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <HelpCircle className="w-4 h-4 text-[#58149c] dark:text-[#DAB9FF]" />
                <span>Bantuan Korlap / Reschedule</span>
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* ================================================================= */}
      {/* MODAL: FILTER & CARI 6 STATUS WORK ORDER                          */}
      {/* ================================================================= */}
      <ResponsiveModal
        isOpen={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<SlidersHorizontal className="w-5 h-5 text-[#58149c]" />}
        title="Filter 6 Status Work Order"
        subtitle={`${myTickets.length} Penugasan Hari Ini (${shortTodayLabel})`}
      >
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-[#7d7484] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari nomor WO, nama pelanggan, alamat, atau FAT..."
              className="w-full min-h-[44px] pl-9 pr-8 rounded-xl bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] text-xs text-[#1f1638] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#58149c]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7d7484] hover:text-[#1f1638] cursor-pointer"
                aria-label="Hapus pencarian"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSelectedStatusFilter('all')}
              className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer ${
                selectedStatusFilter === 'all'
                  ? 'bg-[#58149c] border-[#58149c] text-white'
                  : 'bg-[#f8f1ff] dark:bg-[#160D29] border-[#e8ddff] dark:border-[#35105E] text-[#1f1638] dark:text-white'
              }`}
            >
              <span>Semua Status</span>
              <span className="font-mono tabular-nums">{myTickets.length}</span>
            </button>

            {matrixCards.map(c => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelectedStatusFilter(c.key)}
                className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-bold flex items-center justify-between cursor-pointer ${
                  selectedStatusFilter === c.key
                    ? 'bg-[#58149c] border-[#58149c] text-white'
                    : 'bg-[#f8f1ff] dark:bg-[#160D29] border-[#e8ddff] dark:border-[#35105E] text-[#1f1638] dark:text-white'
                }`}
              >
                <span>{c.label}</span>
                <span className="font-mono tabular-nums">{c.count}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setSelectedStatusFilter('all');
                setSearchQuery('');
              }}
              className="flex-1 min-h-[44px] rounded-xl border border-[#e8ddff] dark:border-[#35105E] text-xs font-bold text-[#4b4452] dark:text-[#CEC0E8] cursor-pointer"
            >
              Reset Filter
            </button>
            <button
              type="button"
              onClick={() => {
                setShowFilterModal(false);
                ticketListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className="flex-1 min-h-[44px] rounded-xl bg-[#58149c] hover:bg-[#7135b5] text-white text-xs font-bold cursor-pointer"
            >
              Terapkan ({displayedTickets.length} WO)
            </button>
          </div>
        </div>
      </ResponsiveModal>

      {/* ================================================================= */}
      {/* MODAL: DARURAT & ESKALASI LAPANGAN                                */}
      {/* ================================================================= */}
      <ResponsiveModal
        isOpen={Boolean(showEmergencyModal && modalTargetTicket)}
        onClose={() => setShowEmergencyModal(false)}
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<ShieldAlert className="w-5 h-5 text-[#ba1a1a]" />}
        title="Darurat & Eskalasi Lapangan"
        subtitle={modalTargetTicket?.woNumber}
      >
        {modalTargetTicket && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {derivedLeader.phone ? (
                <a
                  href={`tel:${derivedLeader.phone}`}
                  className="flex items-center gap-2 p-3 rounded-xl bg-[#f3eaff] dark:bg-[#261942] border border-[#d8ccf3] dark:border-[#4B386B] text-xs font-bold text-[#58149c] dark:text-[#DAB9FF]"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate">Telepon Korlap</div>
                    <div className="font-mono text-[10.5px] font-normal truncate">{derivedLeader.phone}</div>
                  </div>
                </a>
              ) : (
                <div className="p-3 rounded-xl bg-[#f8f1ff] dark:bg-[#160D29] border border-[#e8ddff] dark:border-[#35105E] text-xs text-[#4b4452] dark:text-[#CEC0E8]">
                  <div className="font-bold text-[#1f1638] dark:text-white">Korlap</div>
                  <div className="truncate">{derivedLeader.name}</div>
                </div>
              )}

              {modalTargetTicket.customerPhone && (
                <a
                  href={`tel:${modalTargetTicket.customerPhone}`}
                  className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-300"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate">Telepon Pelanggan</div>
                    <div className="font-mono text-[10.5px] font-normal truncate">
                      {modalTargetTicket.customerPhone}
                    </div>
                  </div>
                </a>
              )}
            </div>

            <form onSubmit={handleSendEmergency} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#1f1638] dark:text-white mb-1">
                  Kirim Sinyal Darurat ke Dispatch &amp; Korlap (Tag: ISSUE)
                </label>
                <textarea
                  rows={3}
                  value={emergencyText}
                  onChange={e => setEmergencyText(e.target.value)}
                  placeholder="Jelaskan kondisi darurat (akses ditolak, kabel putus berbahaya, ODP rusak, dll)..."
                  className="w-full p-3 rounded-xl border border-[#e8ddff] dark:border-[#35105E] bg-[#f8f1ff] dark:bg-[#160D29] text-xs text-[#1f1638] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#ba1a1a]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmergencyModal(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-[#e8ddff] dark:border-[#35105E] text-xs font-bold text-[#4b4452] dark:text-[#CEC0E8] cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSendingEmergency}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#ba1a1a] hover:bg-[#93000a] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>{isSendingEmergency ? 'Mengirim...' : 'Kirim Eskalasi Darurat'}</span>
                </button>
              </div>
            </form>
          </div>
        )}
      </ResponsiveModal>

      {/* ================================================================= */}
      {/* MODAL: MINTA BANTUAN KORLAP / RESCHEDULE                          */}
      {/* ================================================================= */}
      <ResponsiveModal
        isOpen={Boolean(showHelpModal && modalTargetTicket)}
        onClose={() => setShowHelpModal(false)}
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<HelpCircle className="w-5 h-5 text-[#58149c]" />}
        title="Bantuan Korlap & Reschedule"
        subtitle={
          modalTargetTicket
            ? `${modalTargetTicket.woNumber} · ${modalTargetTicket.customerName}`
            : undefined
        }
      >
        {modalTargetTicket && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#f3eaff] dark:bg-[#160D29]">
              <button
                type="button"
                onClick={() => setHelpMode('korlap')}
                className={`min-h-[40px] py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  helpMode === 'korlap'
                    ? 'bg-white dark:bg-[#2A1647] text-[#58149c] dark:text-[#D8B4FE] shadow-2xs'
                    : 'text-[#4b4452] dark:text-[#CEC0E8]'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Bantuan Korlap</span>
              </button>
              <button
                type="button"
                onClick={() => setHelpMode('reschedule')}
                className={`min-h-[40px] py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  helpMode === 'reschedule'
                    ? 'bg-white dark:bg-[#2A1647] text-amber-700 dark:text-amber-300 shadow-2xs'
                    : 'text-[#4b4452] dark:text-[#CEC0E8]'
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Ajukan Reschedule</span>
              </button>
            </div>

            <form onSubmit={handleSubmitHelpOrReschedule} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#1f1638] dark:text-white mb-1">
                  {helpMode === 'korlap'
                    ? 'Pesan Kendala / Permintaan Bantuan (LiveChat ISSUE)'
                    : 'Alasan Reschedule Wajib (Akan mengubah status ke Pending Technical)'}
                </label>
                <textarea
                  rows={3}
                  required
                  value={helpNote}
                  onChange={e => setHelpNote(e.target.value)}
                  placeholder={
                    helpMode === 'korlap'
                      ? 'Contoh: Mohon arahan FAT penuh / butuh bantuan tarik kabel dari tiang...'
                      : 'Contoh: Pelanggan meminta jadwal ulang ke besok pagi karena rumah kosong...'
                  }
                  className="w-full p-3 rounded-xl border border-[#e8ddff] dark:border-[#35105E] bg-[#f8f1ff] dark:bg-[#160D29] text-xs text-[#1f1638] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#58149c]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-[#e8ddff] dark:border-[#35105E] text-xs font-bold text-[#4b4452] dark:text-[#CEC0E8] cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingHelp || helpNote.trim().length < 5}
                  className={`flex-1 min-h-[44px] rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                    helpMode === 'korlap'
                      ? 'bg-[#58149c] hover:bg-[#7135b5]'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>
                    {isSubmittingHelp
                      ? 'Memproses...'
                      : helpMode === 'korlap'
                      ? 'Kirim ke Korlap'
                      : 'Konfirmasi Reschedule'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        )}
      </ResponsiveModal>

      {/* ================================================================= */}
      {/* MODAL: IMAGE ZOOM LIGHTBOX                                        */}
      {/* ================================================================= */}
      <ResponsiveModal
        isOpen={Boolean(zoomImageUrl)}
        onClose={() => setZoomImageUrl(null)}
        size="xl"
        mobileVariant="sheet"
        zIndexClass="z-70"
        title="Preview Evidence Lapangan"
      >
        {zoomImageUrl && (
          <div className="flex items-center justify-center bg-[#160D29] rounded-xl p-2">
            <img
              src={zoomImageUrl}
              alt="Preview Evidence Lapangan"
              referrerPolicy="no-referrer"
              className="max-w-full max-h-[72vh] rounded-lg object-contain"
            />
          </div>
        )}
      </ResponsiveModal>

      {checkInCameraTicket && (
        <GeoTagCameraCheckInModal
          isOpen={Boolean(checkInCameraTicket)}
          onClose={() => setCheckInCameraTicket(null)}
          ticket={checkInCameraTicket}
          onCheckInSuccess={() => {
            setCheckInCameraTicket(null);
          }}
        />
      )}
    </div>
  );
};
