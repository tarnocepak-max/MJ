import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { useToast } from '../../context/ToastContext';
import { Ticket, ChatAttachment, WOKpiFilterKey } from '../../types/index.ts';
import { classifyInstallerStatus } from './InstallerPortal';
import { InstallerTicketFullview } from './InstallerTicketFullview';
import { DashboardKpiSummaryCards } from '../dashboard/DashboardKpiSummaryCards';
import { StatusBadge } from '../common/Badge';
import {
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus,
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
  Wrench
} from 'lucide-react';

interface InstallerDashboardViewProps {
  onNavigateTab: (tab: string, filter?: string) => void;
  onSelectTicket: (ticket: Ticket) => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
}

const formatWaTelemetryLabel = (status: string | undefined): string => {
  switch (status) {
    case 'confirmed':
      return 'CONFIRMED';
    case 'awaiting_confirmation':
      return 'AWAITING';
    case 'opened_in_whatsapp':
      return 'OPENED WA';
    case 'ready':
      return 'READY';
    case 'reschedule_requested':
      return 'RESCHEDULE';
    case 'unreachable':
      return 'UNREACHABLE';
    case 'invalid_number':
      return 'INVALID NO';
    case 'cancelled':
      return 'CANCELLED';
    default:
      return 'NOT PREPARED';
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
    setActiveKpiDrilldown,
    startWorkOnTicket,
    sendTicketMessage,
    updateTicketStatus,
    getMessagesForTicket
  } = useApp();
  const { pendingCount, setIsOfflineModalOpen } = useOfflineSync();
  const { toast } = useToast();

  const [fullviewTicket, setFullviewTicket] = useState<Ticket | null>(null);
  const [quickNote, setQuickNote] = useState('');
  const [quickAttachments, setQuickAttachments] = useState<ChatAttachment[]>([]);
  const [isSendingQuick, setIsSendingQuick] = useState(false);
  const [isStartingId, setIsStartingId] = useState<string | null>(null);
  const [zoomImageUrl, setZoomImageUrl] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Modals: Darurat & Bantuan Korlap / Reschedule
  const [showEmergencyModal, setShowEmergencyModal] = useState(false);
  const [emergencyText, setEmergencyText] = useState('');
  const [isSendingEmergency, setIsSendingEmergency] = useState(false);

  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpMode, setHelpMode] = useState<'korlap' | 'reschedule'>('korlap');
  const [helpNote, setHelpNote] = useState('');
  const [isSubmittingHelp, setIsSubmittingHelp] = useState(false);

  const quickFileRef = useRef<HTMLInputElement>(null);

  // Live duration refresh every 30s
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
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

  // KPI counters & Active WO resolution
  const { stats, activeWorkOrder, featuredTicket, queueTickets } = useMemo(() => {
    let belumDikerjakan = 0;
    let sedangDikerjakan = 0;
    let butuhApproval = 0;
    let selesai = 0;
    let rescheduleOrCancel = 0;

    const inProgressList: Ticket[] = [];
    const notStartedList: Ticket[] = [];
    const approvalList: Ticket[] = [];
    const otherList: Ticket[] = [];

    myTickets.forEach(t => {
      if (t.approvalStatus === 'BUTUH APPROVAL') {
        butuhApproval++;
        approvalList.push(t);
      }

      const cat = classifyInstallerStatus(t);
      if (cat === 'done' || t.approvalStatus === 'APPROVED' || t.statusWOAgent === 'Closed') {
        selesai++;
        if (t.approvalStatus !== 'BUTUH APPROVAL') otherList.push(t);
      } else if (cat === 'reschedule' || cat === 'cancel') {
        rescheduleOrCancel++;
        if (t.approvalStatus !== 'BUTUH APPROVAL') otherList.push(t);
      } else {
        const s = (t.statusWOInstaller || '').toLowerCase();
        const isStarted = Boolean(
          t.workStartedAt ||
          t.checkInAt ||
          s === 'on site' ||
          s === 'en route' ||
          s.includes('progress') ||
          s.includes('working')
        );
        if (isStarted) {
          sedangDikerjakan++;
          if (t.approvalStatus !== 'BUTUH APPROVAL') inProgressList.push(t);
        } else {
          belumDikerjakan++;
          if (t.approvalStatus !== 'BUTUH APPROVAL') notStartedList.push(t);
        }
      }
    });

    const sortBySlot = (a: Ticket, b: Ticket) =>
      String(a.slotTime || '').localeCompare(String(b.slotTime || ''));

    inProgressList.sort(sortBySlot);
    notStartedList.sort(sortBySlot);
    approvalList.sort(sortBySlot);
    otherList.sort(sortBySlot);

    const primaryActive = inProgressList[0] || null;
    const featured = primaryActive || notStartedList[0] || approvalList[0] || otherList[0] || null;

    const queue = [...notStartedList, ...inProgressList, ...approvalList, ...otherList].filter(
      t => !featured || t.id !== featured.id
    );

    return {
      stats: {
        total: myTickets.length,
        belumDikerjakan,
        sedangDikerjakan,
        butuhApproval,
        selesai,
        rescheduleOrCancel
      },
      activeWorkOrder: primaryActive,
      featuredTicket: featured,
      queueTickets: queue
    };
  }, [myTickets]);

  // Progress bar math (submitted / completed out of total assigned today)
  const completedOrSubmittedCount = Math.min(stats.total, stats.selesai + stats.butuhApproval);
  const remainingSlots = Math.max(0, stats.total - completedOrSubmittedCount);
  const quotaPct = stats.total > 0 ? Math.round((completedOrSubmittedCount / stats.total) * 100) : 0;

  // Derived area & korlap name from current user or featured/assigned tickets
  const derivedArea = useMemo(() => {
    if (currentUser.area) return currentUser.area;
    const areas = Array.from(new Set(myTickets.map(t => t.clusterName || t.area).filter(Boolean)));
    return areas.slice(0, 2).join(' & ') || 'Area Penugasan';
  }, [currentUser.area, myTickets]);

  const derivedLeader = useMemo(() => {
    const leaderName = featuredTicket?.leaderName || featuredTicket?.corlapName || myTickets.find(t => t.leaderName || t.corlapName)?.leaderName || myTickets.find(t => t.corlapName)?.corlapName || '';
    const leaderObj = users.find(
      u => u.role === 'leader' && (
        (leaderName && u.name.toLowerCase() === leaderName.toLowerCase()) ||
        (featuredTicket?.leaderId && u.id === featuredTicket.leaderId) ||
        (currentUser.contractor && u.contractor?.toLowerCase() === currentUser.contractor.toLowerCase())
      )
    );
    return {
      name: leaderName || leaderObj?.name || 'Koordinator Lapangan',
      phone: leaderObj?.phone || ''
    };
  }, [featuredTicket, myTickets, users, currentUser.contractor]);

  // Featured ticket messages (latest PROGRESS message prioritized, else latest message)
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

  // Live duration string for featured ticket
  const featuredDurationText = useMemo(() => {
    if (!featuredTicket) return '-';
    if (featuredTicket.workDurationFormatted) return featuredTicket.workDurationFormatted;
    const startRef = featuredTicket.checkInAt || featuredTicket.workStartedAt;
    if (!startRef) return '-';
    const endRef = featuredTicket.checkOutAt || new Date(nowTick).toISOString();
    const mins = calculateDurationMinutes(startRef, endRef);
    return mins > 0 ? formatWorkDuration(mins) : '1 menit';
  }, [featuredTicket, nowTick]);

  // Short date label for Antrean header e.g. "15 Nov"
  const shortTodayLabel = useMemo(() => {
    const full = formatAppointmentDateDisplay(todayWIB);
    if (!full) return todayWIB;
    const parts = full.split(' ');
    return parts.length >= 2 ? `${parts[0]} ${parts[1]}` : full;
  }, [todayWIB]);

  const handleStartWork = async (e: React.MouseEvent, ticket: Ticket, openFullviewAfter = true) => {
    e.stopPropagation();
    if (isStartingId) return;
    setIsStartingId(ticket.id);
    try {
      const res = await startWorkOnTicket(ticket.id);
      if (res.success && res.ticket) {
        toast.success(`Tiket WO ${ticket.woNumber} dimulai. Silakan kirim LiveChat PROGRESS untuk Check-in.`, 'Mulai Dikerjakan');
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
    if (!featuredTicket || isSendingEmergency) return;
    const msgBody = emergencyText.trim() || 'Darurat lapangan: membutuhkan eskalasi segera dari Korlap/Dispatch.';
    setIsSendingEmergency(true);
    try {
      const res = await sendTicketMessage(
        featuredTicket.id,
        `[DARURAT LAPANGAN] ${msgBody}`,
        [],
        'ISSUE'
      );
      if (res.success) {
        setEmergencyText('');
        setShowEmergencyModal(false);
        toast.success(`Laporan darurat untuk WO ${featuredTicket.woNumber} dikirim ke Dispatch & Korlap.`, 'Eskalasi Terkirim');
      }
    } finally {
      setIsSendingEmergency(false);
    }
  };

  const handleSubmitHelpOrReschedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!featuredTicket || isSubmittingHelp) return;
    const cleanNote = helpNote.trim();
    if (cleanNote.length < 5) {
      toast.warning('Tuliskan keterangan/alasan minimal 5 karakter.', 'Keterangan Wajib');
      return;
    }

    setIsSubmittingHelp(true);
    try {
      if (helpMode === 'korlap') {
        const res = await sendTicketMessage(
          featuredTicket.id,
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
          featuredTicket.id,
          undefined,
          'Pending Technical',
          `Reschedule: ${cleanNote}`
        );
        await sendTicketMessage(
          featuredTicket.id,
          `[PERMINTAAN RESCHEDULE] ${cleanNote}`,
          [],
          'REQUEST'
        );
        setHelpNote('');
        setShowHelpModal(false);
        toast.success(`Permintaan reschedule WO ${featuredTicket.woNumber} dicatat dan dikirim ke Dispatch.`, 'Reschedule Diajukan');
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
      ['On Site', 'En Route', 'In Progress', 'Completed', 'Installed'].includes(featuredTicket.statusWOInstaller))
  );
  const isFeaturedCheckedIn = Boolean(featuredTicket?.checkInAt);
  const isFeaturedReported = Boolean(
    featuredTicket &&
    ((featuredTicket.progressReports && featuredTicket.progressReports.length > 0) || featuredTicket.checkOutAt)
  );

  const isFeaturedExpress = Boolean(
    featuredTicket &&
    (`${featuredTicket.appointmentType || ''} ${featuredTicket.ticketCategory || ''}`.toLowerCase().includes('sameday') ||
      `${featuredTicket.appointmentType || ''} ${featuredTicket.ticketCategory || ''}`.toLowerCase().includes('express'))
  );

  return (
    <div className="max-w-lg lg:max-w-5xl mx-auto space-y-4 pb-6">
      {/* ================================================================= */}
      {/* 1. HERO GREETING & PROGRES KUOTA HARIAN CARD                      */}
      {/* ================================================================= */}
      <section className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-4 sm:p-5 space-y-3.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#16A36A] shrink-0" />
            <span className="text-[10.5px] font-extrabold tracking-wider uppercase text-[#58149c] dark:text-[#dab9ff]">
              TEKNISI LAPANGAN FTTH
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsOfflineModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f3eaff] hover:bg-[#eee4ff] dark:bg-[#2A1647] border border-[#d8ccf3] dark:border-[#5B35B1] text-[#58149c] dark:text-[#dab9ff] text-[10.5px] font-bold transition-colors cursor-pointer tabular-nums"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
            <span>Offline Siap ({pendingCount} Antrean)</span>
          </button>
        </div>

        <div>
          <h1 className="font-display text-xl sm:text-2xl font-extrabold text-[#1f1638] dark:text-white tracking-tight leading-snug">
            {getWibGreeting()}, {currentUser.name}
          </h1>
          <p className="text-xs text-[#4b4452] dark:text-[#cabde8] mt-0.5">
            {derivedArea} · Korlap: <span className="font-semibold text-[#1f1638] dark:text-white">{derivedLeader.name}</span>
          </p>
        </div>

        {/* Progres Kuota Harian Box */}
        <div className="mj-tactile-well border border-[#e8ddff] dark:border-[#35105E] p-3.5 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-[#494453] dark:text-[#E9D5FF]">
              Progres Kuota Harian
            </span>
            <span className="font-display font-extrabold text-[#431599] dark:text-[#D8B4FE] tabular-nums">
              {completedOrSubmittedCount} / {stats.total} WO ({quotaPct}%)
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-[#E9E5F0] dark:bg-[#2C184D] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#431599] to-[#7135B5] transition-all duration-500"
              style={{ width: `${quotaPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-[11px] pt-0.5">
            <span className="text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
              Sisa {remainingSlots} slot WO hari ini
            </span>
            <button
              type="button"
              onClick={() => onNavigateTab('installer_tasks', 'butuh_approval')}
              className="font-bold text-[#D97706] dark:text-amber-300 hover:underline cursor-pointer tabular-nums"
            >
              {stats.butuhApproval} Menunggu Approval
            </button>
          </div>
        </div>
      </section>

      {/* Revision Required Alert Strip (if any today ticket needs revision) */}
      {(() => {
        const revisionTickets = myTickets.filter(t => getTicketCanonicalApprovalStatus(t) === 'REVISION');
        if (revisionTickets.length === 0) return null;
        return (
          <section className="rounded-2xl bg-[#FEF2F2] dark:bg-rose-950/50 border border-[#FCA5A5] dark:border-rose-800 p-4 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-[#B91C1C] dark:text-rose-200">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wide">
                  {revisionTickets.length} WO Memerlukan Revisi Laporan dari Dispatch
                </span>
              </div>
              <StatusBadge status="REVISION / REJECTED" variant="approval" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {revisionTickets.slice(0, 4).map(rt => {
                const reason =
                  rt.rejectionReason ||
                  rt.progressReports?.[0]?.revisionReason ||
                  rt.progressReports?.[0]?.rejectionReason ||
                  'Dispatch meminta perbaikan laporan.';
                return (
                  <button
                    key={rt.id}
                    type="button"
                    onClick={() => setFullviewTicket(rt)}
                    className="text-left min-h-[44px] px-3 py-2 rounded-xl bg-white dark:bg-[#1E1135] border border-[#FCA5A5] dark:border-rose-800 hover:border-[#B91C1C] transition-colors flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <div className="min-w-0">
                      <div className="font-mono text-xs font-extrabold text-[#B91C1C] dark:text-rose-300">
                        {rt.woNumber} · {rt.customerName}
                      </div>
                      <div className="text-[11px] text-[#7F1D1D] dark:text-rose-200/90 truncate">
                        Alasan: {reason}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#B91C1C] shrink-0" />
                  </button>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* ================================================================= */}
      {/* 2. LIVE KPI SUMMARY CARDS (11 METRIC CARDS + DRILL-DOWN)          */}
      {/* ================================================================= */}
      <DashboardKpiSummaryCards
        compact={true}
        defaultPerspective="overview"
        onDrillDown={(filterKey: WOKpiFilterKey) => {
          setActiveKpiDrilldown({ filterKey, dateWIB: todayWIB });
          onNavigateTab('installer_tasks', 'all');
        }}
      />

      {/* ================================================================= */}
      {/* 3 & 4. FEATURED WORK ORDER + SOP CHECK-IN & PELAPORAN             */}
      {/* ================================================================= */}
      {!featuredTicket ? (
        <section className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-7 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-[#f3eaff] dark:bg-[#2A1647] text-[#58149c] dark:text-[#dab9ff] flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 text-[#16A36A]" />
          </div>
          <div className="space-y-1">
            <h2 className="font-display text-base font-bold text-[#1f1638] dark:text-white">
              Belum Ada WO Aktif Hari Ini
            </h2>
            <p className="text-xs text-[#4b4452] dark:text-[#cabde8] max-w-sm mx-auto">
              Work Order yang ditugaskan Leader untuk tanggal {formatAppointmentDateDisplay(todayWIB) || todayWIB} akan tampil otomatis di sini.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('installer_tasks', 'all')}
            className="mj-tactile-btn-primary inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs cursor-pointer"
          >
            <span>Lihat Semua Tugas Saya</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* LEFT: FEATURED WORK ORDER CARD */}
          <section className="lg:col-span-6 mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-4 sm:p-5 space-y-3.5">
            {/* Header WO Number + Badge + Slot */}
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setFullviewTicket(featuredTicket)}
                    className="font-mono text-xs sm:text-sm font-extrabold text-[#431599] dark:text-[#D8B4FE] hover:underline cursor-pointer"
                  >
                    {featuredTicket.woNumber}
                  </button>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide ${
                      isFeaturedExpress
                        ? 'bg-[#DC4C5A] text-white'
                        : 'bg-[#F0E3FF] text-[#431599] dark:bg-[#35105E] dark:text-[#D8B4FE]'
                    }`}
                  >
                    {isFeaturedExpress ? 'SAMEDAY EXPRESS' : featuredTicket.ticketCategory || 'FTTH SERVICE'}
                  </span>
                </div>
                <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
                  {featuredTicket.slotTime || 'Hari ini'} · {featuredTicket.appointmentDate || todayWIB}
                </p>
              </div>
              <span
                title={isFeaturedStarted ? 'Pengerjaan aktif' : 'Menunggu mulai'}
                className={`w-3 h-3 rounded-full shrink-0 mt-1 ${
                  isFeaturedStarted ? 'bg-[#431599] ring-4 ring-[#F0E3FF] dark:ring-[#35105E]' : 'bg-[#E59A27] ring-4 ring-[#FEF3C7]'
                }`}
              />
            </div>

            {/* Customer & Address Box */}
            <div className="mj-tactile-well border border-[#e8ddff] dark:border-[#35105E] p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display font-bold text-base text-[#1f1638] dark:text-white truncate">
                  {featuredTicket.customerName || 'Pelanggan'}
                </h2>
                <span className="font-mono text-[11px] font-semibold text-[#4b4452] dark:text-[#cabde8] shrink-0">
                  ID: {featuredTicket.idCustomer || featuredTicket.customerId || '-'}
                </span>
              </div>

              <div className="flex items-start gap-2 text-xs text-[#4b4452] dark:text-[#cabde8]">
                <MapPin className="w-4 h-4 text-[#58149c] dark:text-[#dab9ff] shrink-0 mt-0.5" />
                <div className="space-y-0.5 leading-relaxed">
                  <p>
                    {[featuredTicket.clusterName, featuredTicket.streetName || featuredTicket.address, featuredTicket.area]
                      .filter(Boolean)
                      .join(', ') || 'Alamat belum tersedia'}
                  </p>
                  {featuredTicket.streetAlternatif && (
                    <p className="text-[11px] text-[#B45309] dark:text-amber-300 font-medium">
                      Patokan: {featuredTicket.streetAlternatif}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* 3 Action Grid Buttons: Google Maps | WhatsApp | Darurat */}
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() =>
                  openCustomerAddressInGoogleMaps(featuredTicket, () => {
                    toast.warning('Alamat pelanggan belum tersedia untuk Google Maps.', 'Google Maps');
                  })
                }
                className="mj-tactile-btn-secondary min-h-[54px] rounded-xl border border-[#cec3d4] dark:border-[#4b386b] text-[#58149c] dark:text-[#dab9ff] flex flex-col items-center justify-center gap-1 py-2 px-2 text-xs cursor-pointer"
              >
                <Navigation className="w-4 h-4" />
                <span>Google Maps</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenWhatsApp(featuredTicket)}
                className="mj-tactile-btn-success min-h-[54px] rounded-xl flex flex-col items-center justify-center gap-1 py-2 px-2 text-xs cursor-pointer"
              >
                <MessageSquare className="w-4 h-4" />
                <span>WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={() => setShowEmergencyModal(true)}
                className="mj-tactile-btn-danger min-h-[54px] rounded-xl flex flex-col items-center justify-center gap-1 py-2 px-2 text-xs cursor-pointer"
              >
                <ShieldAlert className="w-4 h-4" />
                <span>Darurat</span>
              </button>
            </div>

            {/* 4-Dimension Telemetry Badges */}
            <div className="space-y-1.5 pt-0.5">
              <div className="text-[10px] font-extrabold tracking-wider uppercase text-[#8B8495] dark:text-[#CEC0E8]/70">
                4-DIMENSION TELEMETRY BADGES
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] text-[10.5px]">
                  <span className="font-semibold text-[#766B83] dark:text-[#CEC0E8] shrink-0">AGENT</span>
                  <span className="font-extrabold uppercase text-[#2563EB] dark:text-sky-300 truncate">
                    {featuredTicket.statusWOAgent || 'Assigned'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] text-[10.5px]">
                  <span className="font-semibold text-[#766B83] dark:text-[#CEC0E8] shrink-0">TEKNISI</span>
                  <span className="font-extrabold uppercase text-[#431599] dark:text-[#D8B4FE] truncate">
                    {featuredTicket.statusWOInstaller || 'Assigned'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] text-[10.5px]">
                  <span className="font-semibold text-[#766B83] dark:text-[#CEC0E8] shrink-0">WA STATUS</span>
                  <span
                    className={`font-extrabold uppercase truncate ${
                      featuredTicket.statusWhatsApp === 'confirmed'
                        ? 'text-[#16A36A] dark:text-emerald-300'
                        : 'text-[#B45309] dark:text-amber-300'
                    }`}
                  >
                    {formatWaTelemetryLabel(featuredTicket.statusWhatsApp)}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E] text-[10.5px]">
                  <span className="font-semibold text-[#766B83] dark:text-[#CEC0E8] shrink-0">APPROVAL</span>
                  {isTicketClosed(featuredTicket) ? (
                    <StatusBadge status="CLOSED" variant="wo_agent" />
                  ) : featuredTicket.approvalStatus && featuredTicket.approvalStatus !== 'NONE' ? (
                    <StatusBadge status={featuredTicket.approvalStatus} variant="approval" />
                  ) : (
                    <StatusBadge
                      status={isFeaturedCheckedIn ? 'CHECK-IN' : 'BELUM CHECK-IN'}
                      variant="checkin"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Footer Timing */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E9E5F0] dark:border-[#35105E] text-[11px] tabular-nums">
              <div className="flex items-center gap-1.5 text-[#766B83] dark:text-[#CEC0E8]">
                <Clock className="w-3.5 h-3.5" />
                <span className="font-mono">
                  Mulai:{' '}
                  {featuredTicket.workStartedAt
                    ? formatJakartaTimeOnly(featuredTicket.workStartedAt)
                    : featuredTicket.checkInAt
                    ? formatJakartaTimeOnly(featuredTicket.checkInAt)
                    : 'Belum Mulai'}
                </span>
              </div>
              <span className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE]">
                Durasi: {featuredDurationText}
              </span>
            </div>
          </section>

          {/* RIGHT: SOP CHECK-IN & PELAPORAN CARD */}
          <section className="lg:col-span-6 mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-4 sm:p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-extrabold text-[#1f1638] dark:text-white">
                  SOP Check-in &amp; Pelaporan
                </h2>
                <p className="text-[11px] text-[#4b4452] dark:text-[#cabde8]">
                  Kepatuhan alur teknisi lapangan MORAJAWS
                </p>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#f3eaff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff] text-[10px] font-extrabold uppercase tracking-wider shrink-0">
                WAJIB
              </span>
            </div>

            {/* 3-Step Checklist */}
            <div className="space-y-3">
              {/* Step 1: Mulai Kerjakan */}
              <div className="flex items-start gap-3">
                {isFeaturedStarted ? (
                  <div className="w-6 h-6 rounded-full bg-[#16A36A] text-white flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-[#7135b5] text-white font-display font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </div>
                )}
                <div className="flex-1 min-w-0 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[#1f1638] dark:text-white">
                      Step 1: Mulai Kerjakan
                    </div>
                    <p
                      className={`text-[11px] mt-0.5 ${
                        isFeaturedStarted ? 'text-[#16A36A] dark:text-emerald-300 font-medium' : 'text-[#4b4452] dark:text-[#cabde8]'
                      }`}
                    >
                      {isFeaturedStarted
                        ? `Tervalidasi pukul ${formatJakartaTimeOnly(featuredTicket.workStartedAt || featuredTicket.checkInAt)}`
                        : 'Tekan Mulai Kerjakan saat tiba atau menuju lokasi pelanggan'}
                    </p>
                  </div>
                  {!isFeaturedStarted && (
                    <button
                      type="button"
                      disabled={isStartingId === featuredTicket.id}
                      onClick={e => handleStartWork(e, featuredTicket, false)}
                      className="mj-tactile-btn-primary px-3 py-1.5 rounded-lg text-[11px] shrink-0 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                    >
                      {isStartingId === featuredTicket.id ? 'Memulai...' : 'Mulai Sekarang'}
                    </button>
                  )}
                </div>
              </div>

              {/* Step 2: Check-in LiveChat Tag PROGRESS */}
              <div className="flex items-start gap-3">
                {isFeaturedCheckedIn ? (
                  <div className="w-6 h-6 rounded-full bg-[#16A36A] text-white flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                ) : (
                  <div className="w-6 h-6 rounded-full bg-[#431599] text-white font-display font-bold text-xs flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[#211A2E] dark:text-white">
                    Step 2: Check-in LiveChat Tag 'PROGRESS'
                  </div>
                  <p
                    className={`text-[11px] mt-0.5 ${
                      isFeaturedCheckedIn ? 'text-[#16A36A] dark:text-emerald-300 font-medium' : 'text-[#766B83] dark:text-[#CEC0E8]'
                    }`}
                  >
                    {isFeaturedCheckedIn
                      ? `Check-in terverifikasi pukul ${formatJakartaTimeOnly(featuredTicket.checkInAt)}`
                      : 'Wajib kirim min. 1 update telemetry lapangan sebelum checkout'}
                  </p>
                </div>
              </div>

              {/* Step 3: Laporan 3-Tingkat Selesai */}
              <div className="flex items-start gap-3">
                {isFeaturedReported ? (
                  <div className="w-6 h-6 rounded-full bg-[#16A36A] text-white flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                ) : (
                  <div
                    className={`w-6 h-6 rounded-full font-display font-bold text-xs flex items-center justify-center shrink-0 mt-0.5 ${
                      isFeaturedCheckedIn
                        ? 'bg-[#431599] text-white'
                        : 'bg-[#E9E5F0] dark:bg-[#2C184D] text-[#8B8495]'
                    }`}
                  >
                    3
                  </div>
                )}
                <div className="min-w-0">
                  <div
                    className={`text-xs font-bold ${
                      isFeaturedCheckedIn || isFeaturedReported
                        ? 'text-[#211A2E] dark:text-white'
                        : 'text-[#8B8495]'
                    }`}
                  >
                    Step 3: Laporan 3-Tingkat Selesai
                  </div>
                  <p className="text-[11px] text-[#766B83] dark:text-[#CEC0E8] mt-0.5">
                    {isFeaturedReported
                      ? `Check-out tercatat (${featuredTicket.workDurationFormatted || 'Selesai'})`
                      : isFeaturedCheckedIn
                      ? 'Formulir siap dibuka setelah validasi check-in'
                      : 'Formulir terbuka otomatis setelah Check-in PROGRESS'}
                  </p>
                </div>
              </div>
            </div>

            {/* Check-in LiveChat Verification Box */}
            <div className="mj-tactile-well border border-[#d8ccf3] dark:border-[#35105E] p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 font-bold min-w-0">
                  {isFeaturedCheckedIn ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
                      <span className="text-[#15803D] dark:text-emerald-300 truncate">
                        Check-in LiveChat Terverifikasi ({formatJakartaTimeOnly(featuredTicket.checkInAt)})
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="w-2 h-2 rounded-full bg-[#E59A27] shrink-0" />
                      <span className="text-[#B45309] dark:text-amber-300 truncate">
                        Belum Check-in · Kirim Tag [PROGRESS]
                      </span>
                    </>
                  )}
                </div>
                <span className="font-mono font-bold text-[#494453] dark:text-[#CEC0E8] shrink-0">
                  {featuredTicket.fatCode || featuredTicket.fdtCode || '-'}
                </span>
              </div>

              {/* Latest Telemetry Preview Card */}
              <div className="rounded-xl bg-white dark:bg-[#1E1135] border border-[#E9E5F0] dark:border-[#35105E] p-3 space-y-2">
                {latestTelemetryMessage ? (
                  <>
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-mono font-extrabold text-[#431599] dark:text-[#D8B4FE]">
                        [{(latestTelemetryMessage.category || 'PROGRESS').toUpperCase()}]
                      </span>
                      <span className="font-mono text-[#8B8495] tabular-nums">
                        {formatJakartaTimeOnly(latestTelemetryMessage.timestamp)}
                      </span>
                    </div>
                    {latestTelemetryMessage.text && (
                      <p className="text-xs text-[#211A2E] dark:text-white leading-relaxed">
                        {latestTelemetryMessage.text}
                      </p>
                    )}
                    {Array.isArray(latestTelemetryMessage.attachments) &&
                      latestTelemetryMessage.attachments.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {latestTelemetryMessage.attachments.map(att => {
                            const safeUrl = getSafePreviewUrl(att.url);
                            return (
                              <div
                                key={att.id}
                                className="flex items-center gap-2.5 p-1.5 rounded-lg bg-[#F7F6FA] dark:bg-[#160D29] border border-[#E9E5F0] dark:border-[#35105E]"
                              >
                                {safeUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => setZoomImageUrl(safeUrl)}
                                    className="relative w-14 h-12 rounded-lg overflow-hidden shrink-0 border border-[#E9E5F0] cursor-pointer group"
                                  >
                                    <img
                                      src={safeUrl}
                                      alt={att.fileName}
                                      referrerPolicy="no-referrer"
                                      className="w-full h-full object-cover"
                                    />
                                    <span className="absolute inset-0 bg-black/25 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                      <Maximize2 className="w-3.5 h-3.5 text-white" />
                                    </span>
                                  </button>
                                ) : (
                                  <div className="w-14 h-12 rounded-lg bg-[#EFE9FA] flex items-center justify-center shrink-0">
                                    <Camera className="w-4 h-4 text-[#431599]" />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-bold text-[#211A2E] dark:text-white truncate">
                                    {att.fileName}
                                  </div>
                                  <div className="font-mono text-[10.5px] text-[#766B83] dark:text-[#CEC0E8]">
                                    {formatBytesShort(att.fileSize)} · Upload Berhasil
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                  </>
                ) : (
                  <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] leading-relaxed">
                    Belum ada update telemetry untuk WO ini. Kirim catatan atau foto lapangan di bawah untuk memicu Check-in otomatis.
                  </p>
                )}
              </div>

              {/* Quick Telemetry Update Form */}
              <form onSubmit={handleSendQuickProgress} className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold text-[#494453] dark:text-[#E9D5FF]">
                    Kirim Update Tambahan Cepat
                  </span>
                  <span className="font-mono font-bold text-[#431599] dark:text-[#D8B4FE]">
                    Kategori: PROGRESS
                  </span>
                </div>

                {/* Selected photo attachment chips */}
                {quickAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {quickAttachments.map(att => (
                      <div
                        key={att.id}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white dark:bg-[#1E1135] border border-[#D8CCF3] text-[11px]"
                      >
                        <img
                          src={att.url}
                          alt={att.fileName}
                          className="w-5 h-5 rounded object-cover"
                        />
                        <span className="max-w-[120px] truncate font-medium text-[#211A2E] dark:text-white">
                          {att.fileName}
                        </span>
                        <button
                          type="button"
                          onClick={() => setQuickAttachments(prev => prev.filter(x => x.id !== att.id))}
                          className="text-[#DC4C5A] hover:opacity-80 cursor-pointer"
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
                    className="min-w-[44px] min-h-[44px] rounded-xl bg-white dark:bg-[#1E1135] border border-[#D8CCF3] dark:border-[#5B35B1] text-[#431599] dark:text-[#D8B4FE] flex items-center justify-center hover:bg-[#F5F1FF] transition-colors cursor-pointer shrink-0"
                  >
                    <Camera className="w-5 h-5" />
                  </button>

                  <input
                    type="text"
                    value={quickNote}
                    onChange={e => setQuickNote(e.target.value)}
                    placeholder="Tulis catatan lapangan..."
                    className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl bg-white dark:bg-[#1E1135] border border-[#D8CCF3] dark:border-[#5B35B1] text-xs text-[#211A2E] dark:text-white placeholder:text-[#8B8495] focus:outline-none focus:ring-2 focus:ring-[#431599]"
                  />

                  <button
                    type="submit"
                    disabled={isSendingQuick || (!quickNote.trim() && quickAttachments.length === 0)}
                    aria-label="Kirim update PROGRESS"
                    className="min-w-[44px] min-h-[44px] rounded-xl bg-[#431599] hover:bg-[#5B35B1] disabled:opacity-50 text-white flex items-center justify-center shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </div>

            {/* Bottom 2 Action Buttons */}
            <div className="space-y-2.5 pt-1">
              <button
                type="button"
                onClick={() => setFullviewTicket(featuredTicket)}
                className="mj-tactile-btn-primary w-full min-h-[48px] px-4 rounded-xl font-display text-sm flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <span>Buka Form Laporan 3-Tingkat</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setHelpMode('korlap');
                  setShowHelpModal(true);
                }}
                className="mj-tactile-btn-secondary w-full min-h-[44px] px-4 rounded-xl border border-[#cec3d4] dark:border-[#4b386b] text-xs flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
              >
                <HelpCircle className="w-4 h-4 text-[#58149c] dark:text-[#dab9ff]" />
                <span>Minta Bantuan Korlap / Reschedule</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* ================================================================= */}
      {/* 5. ANTREAN WO BERIKUTNYA                                          */}
      {/* ================================================================= */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <h2 className="font-display text-base font-extrabold text-[#211A2E] dark:text-white">
            Antrean WO Berikutnya
          </h2>
          <span className="text-xs font-medium text-[#766B83] dark:text-[#CEC0E8] tabular-nums">
            Hari Ini ({shortTodayLabel})
          </span>
        </div>

        {queueTickets.length === 0 ? (
          <div className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] p-5 text-center text-xs text-[#4b4452] dark:text-[#cabde8]">
            {myTickets.length <= 1
              ? 'Tidak ada antrean WO tambahan lainnya untuk hari ini.'
              : 'Semua WO hari ini sedang ditangani.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {queueTickets.map(t => {
              const notStarted = !t.workStartedAt && (!t.statusWOInstaller || t.statusWOInstaller === 'Assigned');
              const closed = isTicketClosed(t);
              const approval = getTicketCanonicalApprovalStatus(t);
              const repStatus = getTicketCanonicalReportStatus(t);
              const queueBadge = closed
                ? 'CLOSED'
                : approval !== 'NONE'
                ? approval === 'REVISION'
                  ? 'REVISION'
                  : approval
                : repStatus !== 'NONE'
                ? repStatus
                : t.checkInAt
                ? 'CHECK-IN'
                : t.statusWOInstaller || 'ASSIGNED';

              return (
                <div
                  key={t.id}
                  onClick={() => setFullviewTicket(t)}
                  className="mj-tactile-card border border-[#e8ddff] dark:border-[#3b1d78] hover:border-[#cec3d4] p-4 space-y-2.5 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-extrabold text-[#58149c] dark:text-[#dab9ff]">
                      {t.woNumber}
                    </span>
                    <StatusBadge
                      status={queueBadge}
                      variant={closed ? 'wo_agent' : approval !== 'NONE' ? 'approval' : 'auto'}
                    />
                  </div>

                  <div>
                    <h3 className="font-display font-bold text-sm text-[#1f1638] dark:text-white truncate">
                      {t.customerName || 'Pelanggan'}
                    </h3>
                    <p className="text-xs text-[#4b4452] dark:text-[#cabde8] truncate mt-0.5">
                      {t.slotTime || 'Hari ini'} · {t.streetName || t.clusterName || t.area || 'Alamat'}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[#e8ddff]/80 dark:border-[#35105E]">
                    <span className="font-mono text-[11px] text-[#4b4452] dark:text-[#cabde8] truncate">
                      FAT: {t.fatCode || '-'} · {t.area || '-'}
                    </span>

                    {notStarted ? (
                      <button
                        type="button"
                        disabled={isStartingId === t.id}
                        onClick={e => handleStartWork(e, t, true)}
                        className="mj-tactile-btn-primary px-3.5 py-2 min-h-[38px] rounded-xl text-[11px] uppercase tracking-wide flex items-center gap-1.5 cursor-pointer shrink-0 disabled:opacity-60 whitespace-nowrap"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{isStartingId === t.id ? 'MEMULAI...' : 'MULAI KERJAKAN'}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setFullviewTicket(t);
                        }}
                        className="mj-tactile-btn-secondary px-3 py-1.5 rounded-xl border border-[#cec3d4] dark:border-[#4b386b] text-[#58149c] dark:text-[#dab9ff] text-[11px] flex items-center gap-1 cursor-pointer shrink-0 whitespace-nowrap"
                      >
                        <Wrench className="w-3 h-3" />
                        <span>Buka Tiket</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ================================================================= */}
      {/* MODAL: DARURAT & ESKALASI LAPANGAN                                */}
      {/* ================================================================= */}
      {showEmergencyModal && featuredTicket && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-[#1E1135] w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[#E9E5F0] dark:border-[#3B1D78] p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-[#FFF1F2] text-[#DC4C5A] flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-bold text-base text-[#211A2E] dark:text-white">
                    Darurat & Eskalasi Lapangan
                  </h3>
                  <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] font-mono">
                    {featuredTicket.woNumber}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowEmergencyModal(false)}
                className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#F7F6FA] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {derivedLeader.phone ? (
                <a
                  href={`tel:${derivedLeader.phone}`}
                  className="flex items-center gap-2 p-3 rounded-xl bg-[#F5F1FF] border border-[#D8CCF3] text-xs font-bold text-[#431599]"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate">Telepon Korlap</div>
                    <div className="font-mono text-[10.5px] font-normal truncate">{derivedLeader.phone}</div>
                  </div>
                </a>
              ) : (
                <div className="p-3 rounded-xl bg-[#F7F6FA] border border-[#E9E5F0] text-xs text-[#766B83]">
                  <div className="font-bold text-[#211A2E]">Korlap</div>
                  <div className="truncate">{derivedLeader.name}</div>
                </div>
              )}

              {featuredTicket.customerPhone && (
                <a
                  href={`tel:${featuredTicket.customerPhone}`}
                  className="flex items-center gap-2 p-3 rounded-xl bg-[#ECFDF5] border border-[#A7F3D0] text-xs font-bold text-[#15803D]"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate">Telepon Pelanggan</div>
                    <div className="font-mono text-[10.5px] font-normal truncate">{featuredTicket.customerPhone}</div>
                  </div>
                </a>
              )}
            </div>

            <form onSubmit={handleSendEmergency} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#211A2E] dark:text-white mb-1">
                  Kirim Sinyal Darurat ke Dispatch & Korlap (Tag: ISSUE)
                </label>
                <textarea
                  rows={3}
                  value={emergencyText}
                  onChange={e => setEmergencyText(e.target.value)}
                  placeholder="Jelaskan kondisi darurat (akses ditolak, kabel putus berbahaya, ODP rusak, dll)..."
                  className="w-full p-3 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#160D29] text-xs text-[#211A2E] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#DC4C5A]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmergencyModal(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-[#E9E5F0] text-xs font-bold text-[#494453] dark:text-[#CEC0E8] cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSendingEmergency}
                  className="flex-1 min-h-[44px] rounded-xl bg-[#DC4C5A] hover:bg-[#B91C1C] text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                >
                  <AlertTriangle className="w-4 h-4" />
                  <span>{isSendingEmergency ? 'Mengirim...' : 'Kirim Eskalasi Darurat'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: MINTA BANTUAN KORLAP / RESCHEDULE                          */}
      {/* ================================================================= */}
      {showHelpModal && featuredTicket && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white dark:bg-[#1E1135] w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-[#E9E5F0] dark:border-[#3B1D78] p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display font-bold text-base text-[#211A2E] dark:text-white">
                  Bantuan Korlap & Reschedule
                </h3>
                <p className="text-xs text-[#766B83] dark:text-[#CEC0E8] font-mono">
                  {featuredTicket.woNumber} · {featuredTicket.customerName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="p-1.5 rounded-lg text-[#766B83] hover:bg-[#F7F6FA] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#F7F6FA] dark:bg-[#160D29]">
              <button
                type="button"
                onClick={() => setHelpMode('korlap')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  helpMode === 'korlap'
                    ? 'bg-white dark:bg-[#2A1647] text-[#431599] dark:text-[#D8B4FE] shadow-2xs'
                    : 'text-[#766B83]'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Bantuan Korlap</span>
              </button>
              <button
                type="button"
                onClick={() => setHelpMode('reschedule')}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  helpMode === 'reschedule'
                    ? 'bg-white dark:bg-[#2A1647] text-[#B45309] dark:text-amber-300 shadow-2xs'
                    : 'text-[#766B83]'
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Ajukan Reschedule</span>
              </button>
            </div>

            <form onSubmit={handleSubmitHelpOrReschedule} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#211A2E] dark:text-white mb-1">
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
                  className="w-full p-3 rounded-xl border border-[#E9E5F0] dark:border-[#35105E] bg-[#F7F6FA] dark:bg-[#160D29] text-xs text-[#211A2E] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#431599]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="flex-1 min-h-[44px] rounded-xl border border-[#E9E5F0] text-xs font-bold text-[#494453] dark:text-[#CEC0E8] cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingHelp || helpNote.trim().length < 5}
                  className={`flex-1 min-h-[44px] rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                    helpMode === 'korlap' ? 'bg-[#431599] hover:bg-[#5B35B1]' : 'bg-[#D97706] hover:bg-[#B45309]'
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
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL: IMAGE ZOOM LIGHTBOX                                        */}
      {/* ================================================================= */}
      {zoomImageUrl && (
        <div
          onClick={() => setZoomImageUrl(null)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setZoomImageUrl(null)}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/15 text-white hover:bg-white/25 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={zoomImageUrl}
            alt="Preview Evidence Lapangan"
            referrerPolicy="no-referrer"
            onClick={e => e.stopPropagation()}
            className="max-w-full max-h-[85vh] rounded-xl shadow-2xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
