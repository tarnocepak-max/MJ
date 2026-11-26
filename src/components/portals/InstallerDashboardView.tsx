import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { useToast } from '../../context/ToastContext';
import { Ticket, WOKpiFilterKey } from '../../types/index.ts';
import {
  classifyInstallerWoBucket,
  getContinueWorkGuidance,
  getTicketPhotoEvidenceCount,
  InstallerWoBucket
} from './InstallerPortal';
import { InstallerTicketFullview, FullviewFocusSection } from './InstallerTicketFullview';
import { WorkOrderAddressBlock } from './WorkOrderAddressBlock';
import { buildTicketAddressSearchHaystack } from '../../utils/addressFormatter';
import { StatusInstallerBadge, StatusApprovalBadge, StatusBadge } from '../common/Badge';
import { GeoTagCameraCheckInModal } from '../camera/GeoTagCameraCheckInModal';
import { ResponsiveModal } from '../common/ResponsiveModal';
import {
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus,
  isTicketCheckedIn,
  computeFieldDispatchCounts,
  isTicketVisibleToInstallerToday
} from '../../services/woLifecycleService';
import { getTicketAppointmentDate, formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { openCustomerAddressInGoogleMaps, openCoordinatesInGoogleMaps, isValidCoordinatePair } from '../../services/mapsService';
import {
  calculateDurationMinutes,
  formatJakartaTimeOnly,
  formatWorkDuration
} from '../../services/workSessionService';
import { PHOTO_SLOT_DEFINITIONS } from './fullview/types';
import {
  CheckCircle2,
  MapPin,
  Phone,
  MessageSquare,
  ArrowRight,
  Navigation,
  Camera,
  Send,
  HelpCircle,
  ShieldAlert,
  X,
  CalendarClock,
  Wrench,
  Wifi,
  WifiOff,
  Search,
  Eye,
  Bell,
  Calendar,
  RefreshCw,
  XCircle,
  ClipboardList,
  Hourglass,
  QrCode,
  Gauge,
  ChevronRight,
  Clock,
  Sparkles,
  KeyRound
} from 'lucide-react';

interface InstallerDashboardViewProps {
  onNavigateTab: (tab: string, filter?: string) => void;
  onSelectTicket: (ticket: Ticket) => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
}

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
  return Number.isNaN(val) ? null : val;
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
    kpiSummary,
    isKpiLoading,
    kpiError,
    refreshKpiSummary,
    setActiveKpiDrilldown,
    sendTicketMessage,
    updateTicketStatus,
    setIsChangePasswordModalOpen
  } = useApp();
  const { isOnline, pendingCount, setIsOfflineModalOpen } = useOfflineSync();
  const { toast } = useToast();

  const [fullviewTicket, setFullviewTicket] = useState<Ticket | null>(null);
  const [fullviewFocusSection, setFullviewFocusSection] = useState<FullviewFocusSection | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState('');
  const [checkInCameraTicket, setCheckInCameraTicket] = useState<Ticket | null>(null);

  // Help / Emergency Modal
  const [modalTargetTicketId, setModalTargetTicketId] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpMode, setHelpMode] = useState<'korlap' | 'reschedule' | 'darurat'>('korlap');
  const [helpNote, setHelpNote] = useState('');
  const [isSubmittingHelp, setIsSubmittingHelp] = useState(false);

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

  // Today-only tickets assigned to logged-in Installer (Asia/Jakarta WIB + active unfinished Check-In exception)
  const myAllAssignedTickets = useMemo(() => {
    const myName = (currentUser.name || '').toLowerCase().trim();
    const myUsername = (currentUser.username || '').toLowerCase().trim();
    const myId = currentUser.id || '';

    return (tickets || []).filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (!isTicketVisibleToInstallerToday(t, todayWIB)) return false;
      if (!t.installerName && !t.assignedTo && !t.installerId) return false;

      if (myId && (t.assignedTo === myId || t.installerId === myId)) return true;
      if (myUsername && t.assignedTo && t.assignedTo.toLowerCase().trim() === myUsername) return true;
      if (myName && isInstallerMatch(t.installerName, myName)) return true;
      if (myUsername && isInstallerMatch(t.installerName, myUsername)) return true;
      return false;
    });
  }, [tickets, currentUser, todayWIB]);

  // Today's appointments + active checked-in unfinished WO past midnight
  const todayTickets = myAllAssignedTickets;

  // Realtime synced ticket for FullView (strictly scoped to todayTickets)
  const activeFullviewTicket = useMemo(() => {
    if (!fullviewTicket) return null;
    return todayTickets.find(t => t.id === fullviewTicket.id) || (isTicketVisibleToInstallerToday(fullviewTicket, todayWIB) ? fullviewTicket : null);
  }, [todayTickets, fullviewTicket, todayWIB]);

  const fieldDispatchCounts = useMemo(() => {
    if (
      kpiSummary &&
      kpiSummary.dateWIB === todayWIB &&
      kpiSummary.fieldDispatchCounts
    ) {
      return kpiSummary.fieldDispatchCounts;
    }
    return computeFieldDispatchCounts(todayTickets);
  }, [kpiSummary, todayWIB, todayTickets]);

  const handleFieldKpiDrillDown = (filterKey: WOKpiFilterKey) => {
    setActiveKpiDrilldown({
      filterKey,
      dateWIB: todayWIB
    });
    onNavigateTab('installer_tasks', filterKey);
  };

  const handleNavigateBucket = (bucketFilter: string) => {
    setActiveKpiDrilldown(null);
    onNavigateTab('installer_tasks', bucketFilter);
  };

  const summary = useMemo(() => {
    let tugasBaru = 0;
    let dalamProses = 0;
    let selesai = 0;
    let checkedInToday = 0;
    let awaitingApproval = 0;
    const revisionList: Ticket[] = [];
    const highAttenuationList: Ticket[] = [];
    const slaMinutesList: number[] = [];
    const opmReadings: number[] = [];

    todayTickets.forEach(t => {
      const bucket = classifyInstallerWoBucket(t);
      if (bucket === 'tugas_baru') tugasBaru++;
      else if (bucket === 'dalam_proses') dalamProses++;
      else selesai++;

      if (isTicketCheckedIn(t) || Boolean(t.checkInAt)) checkedInToday++;

      const approval = getTicketCanonicalApprovalStatus(t);
      if (approval === 'BUTUH APPROVAL') awaitingApproval++;
      if (approval === 'REVISION') revisionList.push(t);

      const opmVal = parseNumericDbm(t.technicalReport?.opticalPowerDbm || t.rosetRedamanDbm);
      if (opmVal !== null) {
        opmReadings.push(opmVal);
      }
      if (bucket !== 'selesai' && opmVal !== null && opmVal < -24) {
        highAttenuationList.push(t);
      }

      if (t.workDurationMinutes && t.workDurationMinutes > 0) {
        slaMinutesList.push(t.workDurationMinutes);
      } else if (t.checkInAt && t.checkOutAt) {
        const dur = calculateDurationMinutes(t.checkInAt, t.checkOutAt);
        if (dur > 0) slaMinutesList.push(dur);
      }
    });

    const totalSelesaiAll = selesai;
    const totalToday = todayTickets.length;
    const progressPct = totalToday > 0 ? Math.round((selesai / totalToday) * 100) : 0;

    const avgSlaMinutes =
      slaMinutesList.length > 0
        ? Math.round(slaMinutesList.reduce((acc, v) => acc + v, 0) / slaMinutesList.length)
        : null;
    const avgSlaLabel = avgSlaMinutes ? formatWorkDuration(avgSlaMinutes) : '—';

    const avgOpmLabel =
      opmReadings.length > 0
        ? `${(opmReadings.reduce((acc, v) => acc + v, 0) / opmReadings.length).toFixed(1)} dBm`
        : '—';

    return {
      tugasBaru,
      dalamProses,
      selesai,
      totalSelesaiAll,
      totalToday,
      checkedInToday,
      awaitingApproval,
      progressPct,
      revisionList,
      highAttenuationList,
      avgSlaLabel,
      avgOpmLabel
    };
  }, [todayTickets, myAllAssignedTickets]);

  const prioritizedTodayTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = todayTickets.filter(t => {
      if (!q) return true;
      const addr = buildTicketAddressSearchHaystack(t);
      return (
        String(t.woNumber || '').toLowerCase().includes(q) ||
        String(t.customerName || '').toLowerCase().includes(q) ||
        String(t.idCustomer || t.customerId || '').toLowerCase().includes(q) ||
        addr.includes(q)
      );
    });

    const bucketOrder: Record<InstallerWoBucket, number> = {
      dalam_proses: 0,
      tugas_baru: 1,
      selesai: 2
    };

    return [...filtered].sort((a, b) => {
      const revA = getTicketCanonicalApprovalStatus(a) === 'REVISION' ? 0 : 1;
      const revB = getTicketCanonicalApprovalStatus(b) === 'REVISION' ? 0 : 1;
      if (revA !== revB) return revA - revB;

      const ba = bucketOrder[classifyInstallerWoBucket(a)];
      const bb = bucketOrder[classifyInstallerWoBucket(b)];
      if (ba !== bb) return ba - bb;

      return String(a.slotTime || '').localeCompare(String(b.slotTime || ''));
    });
  }, [todayTickets, searchQuery]);

  const primaryActionableTicket = useMemo(() => {
    return (
      prioritizedTodayTickets.find(t => classifyInstallerWoBucket(t) !== 'selesai') ||
      prioritizedTodayTickets[0] ||
      null
    );
  }, [prioritizedTodayTickets]);

  const newestAssignedTicket = useMemo(() => {
    return (
      prioritizedTodayTickets.find(
        t =>
          classifyInstallerWoBucket(t) === 'tugas_baru' &&
          (!primaryActionableTicket || t.id !== primaryActionableTicket.id || !primaryActionableTicket.checkInAt)
      ) || null
    );
  }, [prioritizedTodayTickets, primaryActionableTicket]);

  const derivedArea = useMemo(() => {
    if (currentUser.area) return currentUser.area;
    const areas = Array.from(new Set(todayTickets.map(t => t.clusterName || t.area).filter(Boolean)));
    return areas.slice(0, 2).join(' · ') || 'Area Penugasan';
  }, [currentUser.area, todayTickets]);

  const derivedLeader = useMemo(() => {
    const leaderName =
      primaryActionableTicket?.leaderName ||
      primaryActionableTicket?.corlapName ||
      todayTickets.find(t => t.leaderName || t.corlapName)?.leaderName ||
      '';
    const leaderObj = users.find(
      u =>
        u.role === 'leader' &&
        ((leaderName && u.name.toLowerCase() === leaderName.toLowerCase()) ||
          (currentUser.contractor && u.contractor?.toLowerCase() === currentUser.contractor.toLowerCase()))
    );
    return {
      name: leaderName || leaderObj?.name || 'Koordinator Lapangan',
      phone: leaderObj?.phone || ''
    };
  }, [primaryActionableTicket, todayTickets, users, currentUser.contractor]);

  const shortTodayLabel = useMemo(() => {
    return formatAppointmentDateDisplay(todayWIB) || todayWIB;
  }, [todayWIB]);

  const firstName = useMemo(() => {
    const raw = (currentUser.name || 'Teknisi').trim();
    return raw.split(/\s+/)[0] || raw;
  }, [currentUser.name]);

  const modalTargetTicket = useMemo(() => {
    if (modalTargetTicketId) {
      const found = todayTickets.find(t => t.id === modalTargetTicketId);
      if (found) return found;
    }
    return primaryActionableTicket;
  }, [modalTargetTicketId, todayTickets, primaryActionableTicket]);

  const handleOpenFullview = (ticket: Ticket, focus?: FullviewFocusSection) => {
    setFullviewFocusSection(focus);
    setFullviewTicket(ticket);
  };

  // Validate assignment & installer login before triggering existing Camera+GPS Check-In flow
  const handleTriggerCheckIn = (e: React.MouseEvent, ticket: Ticket) => {
    e.stopPropagation();
    if (!currentUser || !currentUser.id) {
      toast.error('Sesi login teknisi tidak valid. Silakan login ulang.', 'Validasi Login');
      return;
    }

    if (currentUser.role === 'installer') {
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const myName = (currentUser.name || '').toLowerCase().trim();
      const isAssigned =
        (myId && (ticket.assignedTo === myId || ticket.installerId === myId)) ||
        (myUsername && ticket.assignedTo && ticket.assignedTo.toLowerCase().trim() === myUsername) ||
        (myName && isInstallerMatch(ticket.installerName, myName)) ||
        (myUsername && isInstallerMatch(ticket.installerName, myUsername));

      if (!isAssigned) {
        toast.error('WO ini tidak ditugaskan ke akun Anda.', 'Validasi Assignment');
        return;
      }
    }

    setCheckInCameraTicket(ticket);
  };

  const handleSubmitHelp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalTargetTicket || isSubmittingHelp) return;
    const cleanNote = helpNote.trim();
    if (cleanNote.length < 5) {
      toast.warning('Tuliskan keterangan minimal 5 karakter.', 'Keterangan Wajib');
      return;
    }

    setIsSubmittingHelp(true);
    try {
      if (helpMode === 'reschedule') {
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
        toast.success(`Permintaan reschedule WO ${modalTargetTicket.woNumber} dikirim ke Dispatch.`, 'Terkirim');
      } else {
        const tag = helpMode === 'darurat' ? '[DARURAT LAPANGAN]' : '[BANTUAN KORLAP]';
        await sendTicketMessage(modalTargetTicket.id, `${tag} ${cleanNote}`, [], 'ISSUE');
        toast.success(`Pesan eskalasi WO ${modalTargetTicket.woNumber} terkirim via LiveChat.`, 'Terkirim');
      }
      setHelpNote('');
      setShowHelpModal(false);
    } finally {
      setIsSubmittingHelp(false);
    }
  };

  if (activeFullviewTicket) {
    return (
      <InstallerTicketFullview
        ticket={activeFullviewTicket}
        onBack={() => {
          setFullviewTicket(null);
          setFullviewFocusSection(undefined);
        }}
        onOpenWhatsApp={onOpenWhatsApp}
        initialFocusSection={fullviewFocusSection}
      />
    );
  }

  const hasImportantNotifications =
    summary.revisionList.length > 0 ||
    summary.highAttenuationList.length > 0 ||
    !isOnline ||
    pendingCount > 0;

  // Derived data for highlighted Pekerjaan Aktif card
  const activeHeroTicket =
    primaryActionableTicket && classifyInstallerWoBucket(primaryActionableTicket) !== 'selesai'
      ? primaryActionableTicket
      : null;

  const heroGuidance = activeHeroTicket ? getContinueWorkGuidance(activeHeroTicket) : null;
  const heroPhotosCount = activeHeroTicket ? getTicketPhotoEvidenceCount(activeHeroTicket) : 0;
  const heroOpmVal = activeHeroTicket
    ? parseNumericDbm(activeHeroTicket.technicalReport?.opticalPowerDbm || activeHeroTicket.rosetRedamanDbm)
    : null;
  const heroStepChecks = activeHeroTicket
    ? [
        { label: '1. Check-In', done: isTicketCheckedIn(activeHeroTicket) || Boolean(activeHeroTicket.checkInAt) },
        { label: '2. Foto', done: heroPhotosCount >= 3 },
        { label: '3. OPM & ONT', done: Boolean(heroOpmVal !== null && activeHeroTicket.ontSerialNumber) },
        { label: '4. BAST', done: Boolean(activeHeroTicket.checkOutAt || activeHeroTicket.customerSignatureUrl) }
      ]
    : [];

  return (
    <div className="max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto space-y-4 pb-24 sm:pb-8">
      {/* =============================================================== */}
      {/* 1. TECHNICIAN GREETING HERO + 3-TILE PERFORMANCE STRIP          */}
      {/* =============================================================== */}
      <section className="card-3d-lavender mj-banner-glossy-3d rounded-2xl p-4 sm:p-5 space-y-3.5 relative overflow-hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-[#5145A6] via-[#6657C8] to-[#2E7D8B] dark:from-[#58149C] dark:to-[#2D115B] text-white font-display font-extrabold text-sm flex items-center justify-center shrink-0 shadow-sm border border-[#BDE4E8]/60 dark:border-[#A380FE]/30">
              {getInitials(currentUser.name)}
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-[#1E1238] ${
                  isOnline ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="font-display font-extrabold text-base sm:text-lg text-[#26364A] dark:text-[#f5eeff] truncate">
                  Halo, {firstName}
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DCE3F2] dark:border-[#4B386B] font-mono text-[10px] font-bold shrink-0">
                  @{currentUser.username}
                </span>
              </div>
              <p className="text-xs text-[#52647A] dark:text-[#C4B5D6] truncate mt-0.5 font-medium">
                {getWibGreeting()} · {derivedArea}
                {currentUser.contractor ? ` · ${currentUser.contractor}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsChangePasswordModalOpen(true)}
                className="mj-btn-xs px-2 py-1 text-[10.5px] font-bold gap-1 cursor-pointer bg-[#F0EDFF] text-[#5145A6] border border-[#6657C8]/25 hover:bg-[#E4DFFF] dark:bg-[#22123F] dark:text-[#DAB9FF] dark:border-[#7135B5]/40"
                title="Ganti Password Akun"
              >
                <KeyRound className="w-3 h-3" />
                <span>Password</span>
              </button>
              <button
                type="button"
                onClick={() => setIsOfflineModalOpen(true)}
                className={`mj-btn-xs px-2.5 py-1 text-[10.5px] font-bold gap-1.5 cursor-pointer ${
                  isOnline ? 'mj-btn-installer-success' : 'mj-btn-installer-warning'
                }`}
                title="Status Availability & Jaringan"
              >
                {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
                <span>{isOnline ? 'SIAP KERJA · ONLINE' : 'MODE OFFLINE'}</span>
              </button>
            </div>
            <span className="text-[10.5px] text-[#8492A5] dark:text-[#A79BC0] font-mono font-semibold">
              {shortTodayLabel}
            </span>
          </div>
        </div>

        {/* 3-Tile Compact Field Performance Strip */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-1">
          <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-2.5 sm:p-3 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0] truncate">
                Target Hari Ini
              </span>
              <span className="font-mono text-[10px] font-extrabold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                {summary.progressPct}%
              </span>
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-[#f5eeff] tabular-nums">
              {summary.selesai}/{summary.totalToday} <span className="text-[11px] font-semibold text-[#8492A5] dark:text-[#A79BC0]">WO</span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-[#EDF3F8] dark:bg-[#2A194B] overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#65B8C4] to-[#6657C8] dark:from-[#58149C] dark:to-[#A380FE] transition-all duration-300"
                style={{ width: `${summary.progressPct}%` }}
              />
            </div>
          </div>

          <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-2.5 sm:p-3 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0] flex items-center gap-1 truncate">
              <Clock className="w-3 h-3 text-[#2E7D8B] dark:text-[#A380FE] shrink-0" />
              <span>Rata SLA</span>
            </span>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-[#f5eeff] tabular-nums truncate mt-1">
              {summary.avgSlaLabel}
            </div>
            <span className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] truncate">
              Target ≤ 90m
            </span>
          </div>

          <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-2.5 sm:p-3 flex flex-col justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0] flex items-center gap-1 truncate">
              <Gauge className="w-3 h-3 text-[#5145A6] dark:text-[#A380FE] shrink-0" />
              <span>OPM Avg</span>
            </span>
            <div className="font-mono font-extrabold text-sm sm:text-base text-[#218A63] dark:text-emerald-400 tabular-nums truncate mt-1">
              {summary.avgOpmLabel}
            </div>
            <span className="text-[10px] text-[#8492A5] dark:text-[#A79BC0] truncate">
              SOP -15..-24
            </span>
          </div>
        </div>
      </section>

      {/* =============================================================== */}
      {/* 2. HIGHLIGHTED PEKERJAAN AKTIF HERO CARD                        */}
      {/* =============================================================== */}
      {activeHeroTicket && heroGuidance && (
        <section
          aria-label="Pekerjaan Aktif"
          className="card-3d-lavender rounded-2xl overflow-hidden"
        >
          {/* Crystal Aqua-Violet / Dark Purple Header Strip */}
          <div className="bg-gradient-to-r from-[#5145A6] via-[#6657C8] to-[#2E7D8B] dark:from-[#160D29] dark:via-[#2D115B] dark:to-[#35105E] text-white px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full bg-[#DDF4F4] dark:bg-[#DAB9FF] animate-pulse shrink-0" />
              <span className="font-mono text-[10.5px] font-extrabold uppercase tracking-wider text-[#DDF4F4] dark:text-[#EEDBFF]">
                PEKERJAAN AKTIF
              </span>
              <span className="text-white/40">·</span>
              <span className="font-mono text-xs font-extrabold text-white truncate">
                {activeHeroTicket.woNumber}
              </span>
            </div>
            <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/20 font-mono text-[10px] font-bold text-[#DDF4F4] dark:text-[#EEDBFF] shrink-0">
              {activeHeroTicket.slotTime || 'Hari Ini'}
            </span>
          </div>

          <div className="p-4 space-y-3.5">
            {/* Customer & Category Row + Full-width Formatted Address */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-display font-extrabold text-base sm:text-lg text-[#26364A] dark:text-[#f5eeff] truncate min-w-0">
                  {activeHeroTicket.customerName}
                </h2>
                <span className="px-2.5 py-1 rounded-lg bg-[#EAE8FF] dark:bg-[#2A194B] border border-[#DCE3F2] dark:border-[#4B386B] text-[#5145A6] dark:text-[#DAB9FF] font-mono text-[10px] font-bold shrink-0">
                  {activeHeroTicket.ticketCategory || activeHeroTicket.appointmentType || 'PSB'}
                </span>
              </div>
              <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-2.5">
                <WorkOrderAddressBlock
                  ticket={activeHeroTicket}
                  variant="card"
                  fallbackText="Alamat belum tersedia"
                />
              </div>
            </div>

            {/* 4-Step Progres Lapangan Tracker */}
            <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-3 space-y-2">
              <div className="flex items-center justify-between text-[10.5px] font-bold">
                <span className="uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                  Progres Lapangan
                </span>
                <span className="font-mono text-[#52647A] dark:text-[#C4B5D6]">
                  {heroGuidance.stageLabel}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {heroStepChecks.map(step => (
                  <div
                    key={step.label}
                    className={`px-1.5 py-1.5 rounded-lg border text-center text-[10px] font-bold truncate ${
                      step.done
                        ? 'bg-[#E4F5EC] dark:bg-emerald-950/50 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-700/60'
                        : 'bg-white dark:bg-[#1E1238] text-[#52647A] dark:text-[#A79BC0] border-[#DDE6F0] dark:border-[#35105E]'
                    }`}
                  >
                    {step.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Distribution Point + DW Strip */}
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0] block">
                  Titik Distribusi (ODP/FAT)
                </span>
                <span className="font-mono font-extrabold text-xs text-[#26364A] dark:text-[#f5eeff] truncate block mt-0.5">
                  {activeHeroTicket.fatCode || activeHeroTicket.fdtCode || 'Belum Diset'}
                  {activeHeroTicket.fatPort ? ` · P${activeHeroTicket.fatPort}` : ''}
                </span>
              </div>
              <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0] block">
                  Est. DW / Redaman
                </span>
                <span className="font-mono font-extrabold text-xs text-[#5145A6] dark:text-[#DAB9FF] truncate block mt-0.5">
                  {activeHeroTicket.dropcoreLength ? `${activeHeroTicket.dropcoreLength}m DW` : 'DW -'}
                  {heroOpmVal !== null ? ` · ${heroOpmVal} dBm` : ''}
                </span>
              </div>
            </div>

            {/* Primary & Secondary 3D Actions */}
            <div className="space-y-2 pt-0.5">
              {!isTicketCheckedIn(activeHeroTicket) && !activeHeroTicket.checkInAt ? (
                <button
                  type="button"
                  onClick={e => handleTriggerCheckIn(e, activeHeroTicket)}
                  className="mj-btn-installer-primary w-full px-4 py-2.5 text-xs sm:text-sm font-extrabold gap-2 cursor-pointer"
                >
                  <Camera className="w-4 h-4 shrink-0" />
                  <span>Check-In Lokasi GPS Sekarang</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleOpenFullview(activeHeroTicket, heroGuidance.section)}
                  className="mj-btn-installer-primary w-full px-4 py-2.5 text-xs sm:text-sm font-extrabold gap-2 cursor-pointer"
                >
                  <span>Lanjutkan Pekerjaan ({heroGuidance.buttonLabel})</span>
                  <ArrowRight className="w-4 h-4 shrink-0" />
                </button>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      isValidCoordinatePair(
                        activeHeroTicket.houseLocation?.latitude,
                        activeHeroTicket.houseLocation?.longitude
                      )
                    ) {
                      openCoordinatesInGoogleMaps(
                        activeHeroTicket.houseLocation!.latitude,
                        activeHeroTicket.houseLocation!.longitude
                      );
                    } else {
                      openCustomerAddressInGoogleMaps(activeHeroTicket, () => {
                        toast.warning('Alamat pelanggan belum tersedia untuk Google Maps.', 'Google Maps');
                      });
                    }
                  }}
                  className="mj-btn-installer-neutral w-full px-3 py-2 text-xs font-bold gap-1.5 cursor-pointer"
                >
                  <Navigation className="w-3.5 h-3.5 shrink-0" />
                  <span>Maps Rute</span>
                </button>

                <button
                  type="button"
                  disabled={!activeHeroTicket.customerPhone}
                  onClick={() => onOpenWhatsApp(activeHeroTicket)}
                  className="mj-btn-installer-success w-full px-3 py-2 text-xs font-bold gap-1.5 cursor-pointer"
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span>WhatsApp</span>
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* =============================================================== */}
      {/* 3. ALERT PENUGASAN BARU MASUK (IF UNSTARTED TASK EXISTS)        */}
      {/* =============================================================== */}
      {newestAssignedTicket && (
        <section className="rounded-2xl bg-gradient-to-r from-[#5145A6] via-[#6657C8] to-[#2E7D8B] dark:from-[#2D115B] dark:via-[#35105E] dark:to-[#480123] text-white p-4 shadow-md border border-[#BDE4E8]/40 dark:border-[#A380FE]/30 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 border border-white/25 text-[10px] font-mono font-extrabold uppercase tracking-wider text-[#DDF4F4] dark:text-[#EEDBFF]">
              <Sparkles className="w-3 h-3" />
              <span>Penugasan Baru Masuk ({summary.tugasBaru} WO)</span>
            </div>
            <span className="font-mono text-[11px] font-bold text-[#DDF4F4] dark:text-[#DAB9FF]">
              {newestAssignedTicket.slotTime || 'Hari Ini'}
            </span>
          </div>

          <div className="min-w-0">
            <div className="font-mono text-xs font-bold text-[#DDF4F4] dark:text-[#DAB9FF]">
              {newestAssignedTicket.woNumber}
            </div>
            <h3 className="font-display font-extrabold text-sm sm:text-base text-white truncate">
              {newestAssignedTicket.customerName}
            </h3>
            <div className="mt-1">
              <WorkOrderAddressBlock
                ticket={newestAssignedTicket}
                variant="banner"
                showIcon={false}
                fallbackText="Alamat siap dicek di detail WO"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={e => handleTriggerCheckIn(e, newestAssignedTicket)}
              className="mj-btn-installer-primary mj-btn-compact flex-1 px-3 py-2 text-xs font-extrabold gap-1.5 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5 shrink-0" />
              <span>Terima &amp; Mulai Kerjakan</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenFullview(newestAssignedTicket)}
              className="mj-btn-installer-neutral mj-btn-compact px-3.5 py-2 text-xs font-bold gap-1.5 cursor-pointer shrink-0"
            >
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>Detail</span>
            </button>
          </div>
        </section>
      )}

      {/* =============================================================== */}
      {/* 4. FIELD DISPATCH KPI MATRIX (MATRIKS 6 STATUS WORK ORDER)      */}
      {/* =============================================================== */}
      <section aria-label="Field Dispatch Matriks 6 Status Work Order" className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-[#f5eeff] leading-tight">
                Field Dispatch
              </h2>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wider border ${
                  !isOnline
                    ? 'bg-[#FFF2D9] dark:bg-amber-950/50 text-[#9D661F] dark:text-amber-300 border-[#F2CF95] dark:border-amber-700/60'
                    : isKpiLoading
                    ? 'bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] border-[#DCE3F2] dark:border-[#4B386B]'
                    : 'bg-[#E4F5EC] dark:bg-emerald-950/50 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-700/60'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    !isOnline
                      ? 'bg-[#D4933E] dark:bg-[#B45309]'
                      : isKpiLoading
                      ? 'bg-[#6657C8] dark:bg-[#DAB9FF] animate-pulse'
                      : 'bg-[#218A63] dark:bg-emerald-400 animate-pulse'
                  }`}
                />
                <span>{!isOnline ? 'Offline' : isKpiLoading ? 'Syncing' : 'Live'}</span>
              </span>
            </div>
            <p className="text-[11px] text-[#8492A5] dark:text-[#A79BC0] mt-0.5">
              Matriks 6 Status Work Order · {shortTodayLabel}
            </p>
          </div>

          <button
            type="button"
            onClick={() => refreshKpiSummary().catch(() => {})}
            disabled={isKpiLoading}
            aria-label="Muat Ulang KPI Field Dispatch"
            className={`mj-btn-installer-neutral mj-btn-xs px-2.5 py-1.5 text-[11px] font-bold gap-1.5 shrink-0 cursor-pointer ${
              isKpiLoading ? 'mj-btn-loading' : ''
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF] ${isKpiLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {kpiError && !kpiSummary && (
          <div className="rounded-xl bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-700/60 px-3 py-2 flex items-center justify-between gap-2 text-xs text-[#9D661F] dark:text-amber-300">
            <span className="truncate font-semibold">Sinkronisasi server tertunda: {kpiError}</span>
            <button
              type="button"
              onClick={() => refreshKpiSummary().catch(() => {})}
              className="mj-btn-installer-warning mj-btn-xs px-2.5 py-1 text-[11px] font-bold shrink-0 cursor-pointer"
            >
              Coba Lagi
            </button>
          </div>
        )}

        {/* 6 KPI Cards — Strictly 2 columns on mobile (grid-cols-2 sm:grid-cols-3) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {[
            {
              key: 'field_checkin' as WOKpiFilterKey,
              label: 'Check-in',
              sublabel: 'Foto Rumah + GPS Valid',
              value: fieldDispatchCounts.checkIn,
              icon: Camera,
              accentBg: 'bg-[#DDF4F4] dark:bg-[#2A194B]',
              accentBorder: 'border-[#BDE4E8] dark:border-[#4B386B]',
              accentText: 'text-[#2E7D8B] dark:text-[#DAB9FF]',
              dotBg: 'bg-[#2E7D8B] dark:bg-[#7135B5]'
            },
            {
              key: 'field_complete' as WOKpiFilterKey,
              label: 'Complete',
              sublabel: 'Teknisi Report = Done',
              value: fieldDispatchCounts.complete,
              icon: CheckCircle2,
              accentBg: 'bg-[#E4F5EC] dark:bg-emerald-950/50',
              accentBorder: 'border-[#B7E4CC] dark:border-emerald-700/60',
              accentText: 'text-[#218A63] dark:text-emerald-300',
              dotBg: 'bg-[#218A63] dark:bg-[#16A36A]'
            },
            {
              key: 'field_requested' as WOKpiFilterKey,
              label: 'Requested',
              sublabel: 'Status: REQUESTED',
              value: fieldDispatchCounts.requested,
              icon: ClipboardList,
              accentBg: 'bg-[#EAE8FF] dark:bg-[#2A194B]',
              accentBorder: 'border-[#DCE3F2] dark:border-[#5B35B1]',
              accentText: 'text-[#5145A6] dark:text-[#DAB9FF]',
              dotBg: 'bg-[#6657C8] dark:bg-[#6D28D9]'
            },
            {
              key: 'field_reschedule' as WOKpiFilterKey,
              label: 'Reschedule',
              sublabel: 'Report: Reschedule',
              value: fieldDispatchCounts.reschedule,
              icon: CalendarClock,
              accentBg: 'bg-[#F0EDFF] dark:bg-[#2A194B]',
              accentBorder: 'border-[#DCE3F2] dark:border-[#4B386B]',
              accentText: 'text-[#5145A6] dark:text-[#EEDBFF]',
              dotBg: 'bg-[#5145A6] dark:bg-[#A380FE]'
            },
            {
              key: 'field_pending' as WOKpiFilterKey,
              label: 'Pending',
              sublabel: 'Report: Pending',
              value: fieldDispatchCounts.pending,
              icon: Hourglass,
              accentBg: 'bg-[#FFF2D9] dark:bg-amber-950/50',
              accentBorder: 'border-[#F2CF95] dark:border-amber-700/60',
              accentText: 'text-[#9D661F] dark:text-amber-300',
              dotBg: 'bg-[#D4933E] dark:bg-[#D97706]'
            },
            {
              key: 'field_cancel' as WOKpiFilterKey,
              label: 'Cancel',
              sublabel: 'Report: Cancel',
              value: fieldDispatchCounts.cancel,
              icon: XCircle,
              accentBg: 'bg-[#FCE9EB] dark:bg-rose-950/50',
              accentBorder: 'border-[#F3C5CA] dark:border-rose-800/60',
              accentText: 'text-[#9B2C37] dark:text-rose-300',
              dotBg: 'bg-[#D45B66] dark:bg-[#BA1A1A]'
            }
          ].map(card => {
            const IconComp = card.icon;
            const showSkeleton = isKpiLoading && !kpiSummary && myAllAssignedTickets.length === 0;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => handleFieldKpiDrillDown(card.key)}
                className="card-3d-lavender rounded-2xl p-3 sm:p-3.5 text-left hover:border-[#65B8C4]/70 dark:hover:border-[#A380FE]/60 active:scale-[0.985] transition-all cursor-pointer flex flex-col justify-between gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${card.dotBg}`} />
                    <span className="font-display font-bold text-xs sm:text-[13px] text-[#26364A] dark:text-[#f5eeff] truncate">
                      {card.label}
                    </span>
                  </div>
                  <div
                    className={`w-7 h-7 rounded-xl border flex items-center justify-center shrink-0 ${card.accentBg} ${card.accentBorder} ${card.accentText}`}
                  >
                    <IconComp className="w-3.5 h-3.5" />
                  </div>
                </div>

                <div className="flex items-baseline justify-between gap-1.5">
                  {showSkeleton ? (
                    <span className="inline-block h-7 w-10 rounded-lg bg-[#EDF3F8] dark:bg-[#2A194B] animate-pulse" />
                  ) : (
                    <span
                      className={`font-display text-2xl sm:text-[26px] font-extrabold tabular-nums leading-none ${card.accentText}`}
                    >
                      {card.value}
                    </span>
                  )}
                  <span className="text-[10px] font-semibold text-[#8492A5] dark:text-[#A79BC0] truncate">
                    WO
                  </span>
                </div>

                <span className="text-[10.5px] font-medium text-[#52647A] dark:text-[#C4B5D6] truncate block">
                  {card.sublabel}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* =============================================================== */}
      {/* 5. OPERATIONAL BUCKET SUMMARY + PROGRESS PEKERJAAN HARI INI     */}
      {/* =============================================================== */}
      <section className="card-3d-lavender rounded-2xl p-3.5 space-y-2.5">
        <div className="grid grid-cols-3 gap-2 pb-2.5 border-b border-[#DDE6F0] dark:border-[#35105E]">
          <button
            type="button"
            onClick={() => handleNavigateBucket('tugas_baru')}
            className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] hover:bg-[#EDF3F8] dark:hover:bg-[#2A194B] border border-[#DDE6F0] dark:border-[#35105E] px-2.5 py-2 text-left transition-colors cursor-pointer"
          >
            <span className="text-[10px] font-bold text-[#52647A] dark:text-[#A79BC0] uppercase block truncate">
              Tugas Baru
            </span>
            <span className="font-display text-lg font-extrabold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
              {summary.tugasBaru}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigateBucket('dalam_proses')}
            className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] hover:bg-[#EDF3F8] dark:hover:bg-[#2A194B] border border-[#DDE6F0] dark:border-[#35105E] px-2.5 py-2 text-left transition-colors cursor-pointer"
          >
            <span className="text-[10px] font-bold text-[#52647A] dark:text-[#A79BC0] uppercase block truncate">
              Dalam Proses
            </span>
            <span className="font-display text-lg font-extrabold text-[#9D661F] dark:text-amber-300 tabular-nums">
              {summary.dalamProses}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigateBucket('selesai')}
            className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] hover:bg-[#EDF3F8] dark:hover:bg-[#2A194B] border border-[#DDE6F0] dark:border-[#35105E] px-2.5 py-2 text-left transition-colors cursor-pointer"
          >
            <span className="text-[10px] font-bold text-[#52647A] dark:text-[#A79BC0] uppercase block truncate">
              WO Selesai
            </span>
            <span className="font-display text-lg font-extrabold text-[#218A63] dark:text-emerald-400 tabular-nums">
              {summary.totalSelesaiAll}
            </span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="font-display font-bold text-[#26364A] dark:text-[#f5eeff] flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-[#2E7D8B] dark:text-[#DAB9FF]" />
            <span>Progress Pekerjaan Hari Ini</span>
          </div>
          <span className="font-mono font-extrabold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
            {summary.selesai}/{summary.totalToday} WO ({summary.progressPct}%)
          </span>
        </div>

        <div className="w-full h-2.5 bg-[#EDF3F8] dark:bg-[#160D29] rounded-full overflow-hidden border border-[#DDE6F0] dark:border-[#35105E]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#65B8C4] to-[#6657C8] dark:from-[#58149C] dark:to-[#A380FE] transition-all duration-300"
            style={{ width: `${summary.progressPct}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-[#52647A] dark:text-[#C4B5D6] flex-wrap pt-0.5">
          <span>
            Appointment Hari Ini: <strong className="text-[#26364A] dark:text-[#f5eeff]">{summary.totalToday}</strong> · Check-In Foto:{' '}
            <strong className="text-[#26364A] dark:text-[#f5eeff]">{fieldDispatchCounts.checkIn}</strong>
          </span>
          {summary.awaitingApproval > 0 && (
            <button
              type="button"
              onClick={() => handleNavigateBucket('selesai')}
              className="font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline cursor-pointer"
            >
              {summary.awaitingApproval} Menunggu QC Dispatch →
            </button>
          )}
        </div>
      </section>

      {/* =============================================================== */}
      {/* 6. NOTIFIKASI PENTING (ONLY SHOWN WHEN RELEVANT)                */}
      {/* =============================================================== */}
      {hasImportantNotifications && (
        <section className="card-3d-lavender rounded-2xl p-3.5 space-y-2 border-[#F2CF95] dark:border-amber-700/60">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#26364A] dark:text-[#f5eeff]">
            <Bell className="w-4 h-4 text-[#9D661F] dark:text-amber-300" />
            <span>Notifikasi Penting</span>
          </div>

          <div className="space-y-2">
            {summary.revisionList.map(t => (
              <div
                key={`rev_${t.id}`}
                className="flex items-center justify-between gap-2 rounded-xl bg-[#FCE9EB] dark:bg-rose-950/40 border border-[#F3C5CA] dark:border-rose-800/60 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-bold text-[#9B2C37] dark:text-rose-300 block truncate">
                    Revisi Report: {t.woNumber} · {t.customerName}
                  </span>
                  <span className="text-[11px] text-[#9B2C37]/90 dark:text-rose-200 block truncate">
                    {t.rejectionReason || t.progressReports?.[0]?.revisionReason || 'Perlu perbaikan laporan oleh teknisi'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenFullview(t, 'report')}
                  className="mj-btn-installer-danger mj-btn-xs px-2.5 py-1.5 text-[11px] font-bold shrink-0 cursor-pointer"
                >
                  Perbaiki
                </button>
              </div>
            ))}

            {summary.highAttenuationList.map(t => (
              <div
                key={`opm_${t.id}`}
                className="flex items-center justify-between gap-2 rounded-xl bg-[#FFF2D9] dark:bg-amber-950/40 border border-[#F2CF95] dark:border-amber-700/60 px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-bold text-[#9D661F] dark:text-amber-300 block truncate">
                    Redaman OPM Tinggi ({t.technicalReport?.opticalPowerDbm || t.rosetRedamanDbm} dBm)
                  </span>
                  <span className="text-[11px] text-[#9D661F] dark:text-amber-200 block truncate">
                    {t.woNumber} · {t.customerName}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenFullview(t, 'installation')}
                  className="mj-btn-installer-warning mj-btn-xs px-2.5 py-1.5 text-[11px] font-bold shrink-0 cursor-pointer"
                >
                  Cek Teknis
                </button>
              </div>
            ))}

            {(!isOnline || pendingCount > 0) && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-3 py-2 text-xs">
                <span className="text-[#26364A] dark:text-[#f5eeff] font-medium truncate">
                  {!isOnline
                    ? `Offline (${pendingCount} antrean tersimpan lokal)`
                    : `${pendingCount} antrean sinkronisasi menunggu koneksi`}
                </span>
                <button
                  type="button"
                  onClick={() => setIsOfflineModalOpen(true)}
                  className="mj-btn-installer-neutral mj-btn-xs px-2.5 py-1 text-[11px] font-bold shrink-0 cursor-pointer"
                >
                  Cek Sync
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* =============================================================== */}
      {/* 7. JADWAL TUGAS HARI INI (COMPACT SLOT LIST + QUICK TOOLS)      */}
      {/* =============================================================== */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-[#2E7D8B] dark:text-[#DAB9FF]" />
            <h2 className="font-display font-bold text-sm sm:text-base text-[#26364A] dark:text-[#f5eeff]">
              Jadwal Tugas Hari Ini ({prioritizedTodayTickets.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => handleNavigateBucket('tugas_baru')}
            className="text-xs font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>Daftar Tugas</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Debossed Search */}
        {todayTickets.length > 0 && (
          <div className="relative">
            <Search className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari No. WO, Customer, Alamat, ID Pelanggan..."
              className="tactile-debossed-input w-full min-h-[42px] pl-9 pr-8 py-1.5 bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Hapus pencarian"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8492A5] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {prioritizedTodayTickets.length === 0 ? (
          <div className="card-3d-lavender rounded-2xl p-6 text-center space-y-2.5">
            <div className="w-11 h-11 mx-auto rounded-xl bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center border border-[#DCE3F2] dark:border-[#4B386B]">
              <Wrench className="w-5 h-5" />
            </div>
            <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-[#f5eeff]">
              {todayTickets.length === 0 ? 'Belum Ada Appointment Hari Ini' : 'Tidak Ada WO yang Cocok'}
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#C4B5D6] max-w-sm mx-auto">
              {todayTickets.length === 0
                ? 'WO yang didistribusikan Leader untuk hari ini akan muncul otomatis di sini.'
                : 'Ubah kata kunci pencarian atau buka daftar lengkap Work Order.'}
            </p>
            <button
              type="button"
              onClick={() => handleNavigateBucket('tugas_baru')}
              className="mj-btn-installer-primary gap-1.5 px-4 py-2 text-xs font-bold cursor-pointer"
            >
              <span>Buka Daftar Tugas</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {prioritizedTodayTickets.map(ticket => {
              const bucket = classifyInstallerWoBucket(ticket);
              const guidance = getContinueWorkGuidance(ticket);
              const canonicalApproval = getTicketCanonicalApprovalStatus(ticket);
              const canonicalReport = getTicketCanonicalReportStatus(ticket);
              const photoCount = getTicketPhotoEvidenceCount(ticket);
              const opmMeasured = parseNumericDbm(ticket.technicalReport?.opticalPowerDbm || ticket.rosetRedamanDbm);
              const workTypeLabel = ticket.ticketCategory || ticket.appointmentType || 'New Installation';
              const hasHouseGps = isValidCoordinatePair(
                ticket.houseLocation?.latitude,
                ticket.houseLocation?.longitude
              );

              return (
                <article
                  key={ticket.id}
                  onClick={() =>
                    handleOpenFullview(ticket, bucket === 'dalam_proses' ? guidance.section : undefined)
                  }
                  className="card-3d-lavender rounded-2xl p-3.5 space-y-2.5 hover:border-[#65B8C4] dark:hover:border-[#A380FE] transition-colors cursor-pointer"
                >
                  {/* Top Row: Left Slot Time / Checkmark Block + Main WO Meta + Right Chevron */}
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-14 shrink-0 rounded-xl px-1.5 py-2 text-center border ${
                        bucket === 'selesai'
                          ? 'bg-[#E4F5EC] dark:bg-emerald-950/50 border-[#B7E4CC] dark:border-emerald-700/60 text-[#218A63] dark:text-emerald-300'
                          : bucket === 'dalam_proses'
                          ? 'bg-gradient-to-br from-[#5145A6] to-[#2E7D8B] dark:bg-none dark:bg-[#2D115B] border-[#6657C8] dark:border-[#58149C] text-white'
                          : 'bg-[#F8FAFD] dark:bg-[#160D29] border-[#DDE6F0] dark:border-[#35105E] text-[#5145A6] dark:text-[#DAB9FF]'
                      }`}
                    >
                      {bucket === 'selesai' ? (
                        <CheckCircle2 className="w-4 h-4 mx-auto" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 mx-auto opacity-80" />
                      )}
                      <span className="font-mono text-[10px] font-extrabold block mt-0.5 truncate tabular-nums">
                        {ticket.slotTime ? ticket.slotTime.split('-')[0].trim() : 'HARI INI'}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="font-mono text-xs font-extrabold text-[#5145A6] dark:text-[#DAB9FF] truncate">
                          {ticket.woNumber}
                        </span>
                        <div className="flex items-center gap-1 shrink-0">
                          {opmMeasured !== null && (
                            <span
                              className={`px-1.5 py-0.5 rounded font-mono text-[9.5px] font-bold border ${
                                opmMeasured < -24 || opmMeasured > -15
                                  ? 'bg-[#FCE9EB] dark:bg-rose-950/50 text-[#9B2C37] dark:text-rose-300 border-[#F3C5CA] dark:border-rose-800/60'
                                  : 'bg-[#E4F5EC] dark:bg-emerald-950/50 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-800/60'
                              }`}
                            >
                              {opmMeasured} dBm
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0]" />
                        </div>
                      </div>

                      <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-[#f5eeff] truncate">
                        {ticket.customerName}
                      </h3>
                    </div>
                  </div>

                  {/* Full-width Structured Address Well */}
                  <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] px-2.5 py-2">
                    <WorkOrderAddressBlock
                      ticket={ticket}
                      variant="card"
                      fallbackText="Alamat belum tersedia"
                    />
                  </div>

                  {/* Status Badges + Tech Strip */}
                  <div className="flex items-center justify-between gap-2 bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl px-2.5 py-1.5 text-[11px] text-[#52647A] dark:text-[#C4B5D6]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <StatusInstallerBadge status={ticket.statusWOInstaller || 'Assigned'} displayRole="installer" />
                      {canonicalApproval === 'REVISION' && <StatusApprovalBadge status="REVISION" />}
                      {bucket === 'selesai' && canonicalReport !== 'NONE' && (
                        <StatusBadge status={canonicalReport} variant="report" />
                      )}
                      <span className="truncate font-medium hidden sm:inline">· {workTypeLabel}</span>
                    </div>
                    <span className="font-mono shrink-0 text-[#5145A6] dark:text-[#DAB9FF] font-bold">
                      {bucket === 'dalam_proses'
                        ? `Foto ${photoCount}/${PHOTO_SLOT_DEFINITIONS.length}`
                        : bucket === 'selesai' && ticket.checkOutAt
                        ? `Selesai ${formatJakartaTimeOnly(ticket.checkOutAt)}`
                        : ticket.fatCode || 'FAT -'}
                    </span>
                  </div>

                  {/* Action Footer */}
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          if (hasHouseGps) {
                            openCoordinatesInGoogleMaps(
                              ticket.houseLocation!.latitude,
                              ticket.houseLocation!.longitude
                            );
                          } else {
                            openCustomerAddressInGoogleMaps(ticket, () => {
                              toast.warning('Alamat pelanggan belum tersedia untuk Google Maps.', 'Google Maps');
                            });
                          }
                        }}
                        aria-label="Google Maps"
                        className="mj-btn-icon-3d-installer w-10 h-10 cursor-pointer"
                      >
                        <Navigation className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        disabled={!ticket.customerPhone}
                        onClick={e => {
                          e.stopPropagation();
                          onOpenWhatsApp(ticket);
                        }}
                        aria-label="WhatsApp Pelanggan"
                        className="mj-btn-icon-3d-wa w-10 h-10 cursor-pointer"
                      >
                        <MessageSquare className="w-4 h-4" />
                      </button>
                    </div>

                    {bucket === 'selesai' ? (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleOpenFullview(ticket);
                        }}
                        className="mj-btn-installer-neutral mj-btn-compact px-3.5 py-2 text-xs font-bold gap-1.5 cursor-pointer shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>LIHAT DETAIL</span>
                      </button>
                    ) : bucket === 'tugas_baru' || !ticket.checkInAt ? (
                      <button
                        type="button"
                        onClick={e => handleTriggerCheckIn(e, ticket)}
                        className="mj-btn-installer-primary mj-btn-compact px-4 py-2 text-xs font-bold gap-1.5 cursor-pointer shrink-0"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>CHECK-IN</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleOpenFullview(ticket, guidance.section);
                        }}
                        className="mj-btn-installer-primary mj-btn-compact px-3.5 py-2 text-xs font-bold gap-1.5 cursor-pointer shrink-0"
                      >
                        <span>{guidance.buttonLabel}</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* =============================================================== */}
      {/* 8. QUICK FIELD TOOLS + BANTUAN KORLAP                           */}
      {/* =============================================================== */}
      <section className="space-y-2.5 pt-1">
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (primaryActionableTicket) {
                handleOpenFullview(primaryActionableTicket, 'installation');
              } else {
                handleNavigateBucket('dalam_proses');
              }
            }}
            className="mj-btn-installer-neutral px-3.5 py-2.5 text-xs font-bold gap-2 cursor-pointer"
          >
            <QrCode className="w-4 h-4 shrink-0 text-[#5145A6] dark:text-[#DAB9FF]" />
            <span className="truncate">Scan Serial ONT</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (primaryActionableTicket) {
                handleOpenFullview(primaryActionableTicket, 'installation');
              } else {
                handleNavigateBucket('dalam_proses');
              }
            }}
            className="mj-btn-installer-neutral px-3.5 py-2.5 text-xs font-bold gap-2 cursor-pointer"
          >
            <Gauge className="w-4 h-4 shrink-0 text-[#2E7D8B] dark:text-[#DAB9FF]" />
            <span className="truncate">Kalibrasi OPM</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => handleNavigateBucket('tugas_baru')}
            className="mj-btn-installer-primary w-full px-4 py-2.5 text-xs font-bold gap-2 cursor-pointer"
          >
            <Wrench className="w-4 h-4 shrink-0" />
            <span>Buka Daftar Tugas Saya</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (primaryActionableTicket) {
                setModalTargetTicketId(primaryActionableTicket.id);
                setHelpMode('korlap');
                setShowHelpModal(true);
              } else {
                onNavigateTab('installer_chat', 'all');
              }
            }}
            className="mj-btn-installer-secondary w-full px-4 py-2.5 text-xs font-bold gap-2 cursor-pointer"
          >
            <HelpCircle className="w-4 h-4 shrink-0" />
            <span>Bantuan Korlap / Kendala</span>
          </button>
        </div>
      </section>

      {/* ================================================================= */}
      {/* MODAL: BANTUAN KORLAP / RESCHEDULE / DARURAT                      */}
      {/* ================================================================= */}
      <ResponsiveModal
        isOpen={Boolean(showHelpModal && modalTargetTicket)}
        onClose={() => setShowHelpModal(false)}
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<HelpCircle className="w-5 h-5 text-[#5145A6] dark:text-[#DAB9FF]" />}
        title="Bantuan Korlap & Kendala"
        subtitle={
          modalTargetTicket
            ? `${modalTargetTicket.woNumber} · ${modalTargetTicket.customerName}`
            : undefined
        }
      >
        {modalTargetTicket && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#EDF3F8] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
              <button
                type="button"
                onClick={() => setHelpMode('korlap')}
                className={`min-h-[38px] py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  helpMode === 'korlap'
                    ? 'bg-white dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] shadow-2xs'
                    : 'text-[#52647A] dark:text-[#A79BC0]'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Korlap</span>
              </button>
              <button
                type="button"
                onClick={() => setHelpMode('reschedule')}
                className={`min-h-[38px] py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  helpMode === 'reschedule'
                    ? 'bg-white dark:bg-[#2A194B] text-[#9D661F] dark:text-amber-300 shadow-2xs'
                    : 'text-[#52647A] dark:text-[#A79BC0]'
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Reschedule</span>
              </button>
              <button
                type="button"
                onClick={() => setHelpMode('darurat')}
                className={`min-h-[38px] py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  helpMode === 'darurat'
                    ? 'bg-white dark:bg-[#2A194B] text-[#9B2C37] dark:text-rose-300 shadow-2xs'
                    : 'text-[#52647A] dark:text-[#A79BC0]'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Darurat</span>
              </button>
            </div>

            {derivedLeader.phone && (
              <a
                href={`tel:${derivedLeader.phone}`}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] text-xs font-bold text-[#5145A6] dark:text-[#DAB9FF]"
              >
                <span className="inline-flex items-center gap-2 truncate">
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>Telepon Korlap ({derivedLeader.name})</span>
                </span>
                <span className="font-mono text-[11px] shrink-0">{derivedLeader.phone}</span>
              </a>
            )}

            <form onSubmit={handleSubmitHelp} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#26364A] dark:text-[#f5eeff] mb-1">
                  {helpMode === 'darurat'
                    ? 'Laporan Darurat (Kirim ke Dispatch & Korlap)'
                    : helpMode === 'reschedule'
                    ? 'Alasan Reschedule Pelanggan'
                    : 'Pesan Kendala / Bantuan Korlap'}
                </label>
                <textarea
                  rows={3}
                  required
                  value={helpNote}
                  onChange={e => setHelpNote(e.target.value)}
                  placeholder="Tuliskan detail kondisi lapangan secara jelas..."
                  className="w-full p-3 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#EDF3F8] dark:bg-[#160D29] text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#58149c]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="mj-btn-installer-neutral flex-1 text-xs font-bold cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingHelp || helpNote.trim().length < 5}
                  className={`flex-1 text-xs font-bold gap-1.5 cursor-pointer ${
                    helpMode === 'darurat'
                      ? 'mj-btn-installer-danger'
                      : 'mj-btn-installer-primary'
                  } ${isSubmittingHelp ? 'mj-btn-loading' : ''}`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmittingHelp ? 'Mengirim...' : 'Kirim Laporan'}</span>
                </button>
              </div>
            </form>
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
            refreshKpiSummary();
          }}
        />
      )}
    </div>
  );
};
