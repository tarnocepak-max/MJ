import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { useToast } from '../../context/ToastContext';
import { Ticket } from '../../types/index.ts';
import {
  classifyInstallerWoBucket,
  getContinueWorkGuidance,
  getTicketPhotoEvidenceCount,
  InstallerWoBucket
} from './InstallerPortal';
import { InstallerTicketFullview, FullviewFocusSection } from './InstallerTicketFullview';
import { StatusInstallerBadge, StatusApprovalBadge, StatusBadge } from '../common/Badge';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { GeoTagCameraCheckInModal } from '../camera/GeoTagCameraCheckInModal';
import {
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus,
  isTicketCheckedIn,
  computeFieldDispatchCounts
} from '../../services/woLifecycleService';
import { getTicketAppointmentDate, formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { openCustomerAddressInGoogleMaps, openCoordinatesInGoogleMaps, isValidCoordinatePair } from '../../services/mapsService';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import { PHOTO_SLOT_DEFINITIONS } from './fullview/types';
import { WOKpiFilterKey } from '../../types/index.ts';
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
  AlertTriangle,
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
  Hourglass
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
    updateTicketStatus
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

  // All tickets assigned to logged-in Installer
  const myAllAssignedTickets = useMemo(() => {
    const myName = (currentUser.name || '').toLowerCase().trim();
    const myUsername = (currentUser.username || '').toLowerCase().trim();
    const myId = currentUser.id || '';

    return (tickets || []).filter(t => {
      if (t.isArchived || t.isDeleted) return false;
      if (!t.installerName && !t.assignedTo && !t.installerId) return false;

      if (myId && (t.assignedTo === myId || t.installerId === myId)) return true;
      if (myUsername && t.assignedTo && t.assignedTo.toLowerCase().trim() === myUsername) return true;
      if (myName && isInstallerMatch(t.installerName, myName)) return true;
      if (myUsername && isInstallerMatch(t.installerName, myUsername)) return true;
      return false;
    });
  }, [tickets, currentUser]);

  // Today's appointments + any active Dalam Proses / Revision work orders
  const todayTickets = useMemo(() => {
    return myAllAssignedTickets.filter(t => {
      const appDate = getTicketAppointmentDate(t);
      const bucket = classifyInstallerWoBucket(t);
      return !appDate || appDate === todayWIB || bucket === 'dalam_proses';
    });
  }, [myAllAssignedTickets, todayWIB]);

  // Realtime synced ticket for FullView
  const activeFullviewTicket = useMemo(() => {
    if (!fullviewTicket) return null;
    return (tickets || []).find(t => t.id === fullviewTicket.id) || fullviewTicket;
  }, [tickets, fullviewTicket]);

  // Authoritative Field Dispatch 6-KPI counts (synchronized with backend kpiSummary & client date scope)
  const todayExactScopedTickets = useMemo(() => {
    return myAllAssignedTickets.filter(t => {
      const appDate = getTicketAppointmentDate(t);
      return appDate === todayWIB;
    });
  }, [myAllAssignedTickets, todayWIB]);

  const fieldDispatchCounts = useMemo(() => {
    if (
      kpiSummary &&
      kpiSummary.dateWIB === todayWIB &&
      kpiSummary.fieldDispatchCounts
    ) {
      return kpiSummary.fieldDispatchCounts;
    }
    return computeFieldDispatchCounts(todayExactScopedTickets);
  }, [kpiSummary, todayWIB, todayExactScopedTickets]);

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
      if (bucket !== 'selesai' && opmVal !== null && opmVal < -24) {
        highAttenuationList.push(t);
      }
    });

    // Total selesai across all dates for Completed counter consistency
    const totalSelesaiAll = myAllAssignedTickets.filter(t => classifyInstallerWoBucket(t) === 'selesai').length;
    const totalToday = todayTickets.length;
    const progressPct = totalToday > 0 ? Math.round((selesai / totalToday) * 100) : 0;

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
      highAttenuationList
    };
  }, [todayTickets, myAllAssignedTickets]);

  const prioritizedTodayTickets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = todayTickets.filter(t => {
      if (!q) return true;
      const addr = [t.streetName, t.address, t.clusterName, t.area].filter(Boolean).join(' ').toLowerCase();
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

  const modalTargetTicket = useMemo(() => {
    if (modalTargetTicketId) {
      const found = myAllAssignedTickets.find(t => t.id === modalTargetTicketId);
      if (found) return found;
    }
    return primaryActionableTicket;
  }, [modalTargetTicketId, myAllAssignedTickets, primaryActionableTicket]);

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
    summary.revisionList.length > 0 || summary.highAttenuationList.length > 0 || !isOnline || pendingCount > 0;

  return (
    <div className="max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto space-y-3.5 pb-20 sm:pb-6">
      {/* =============================================================== */}
      {/* 1. COMPACT TECHNICIAN HEADER + AVAILABILITY                     */}
      {/* =============================================================== */}
      <section className="mj-enterprise-card rounded-2xl p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-[#58149c] text-white font-display font-extrabold text-sm flex items-center justify-center shrink-0">
              {getInitials(currentUser.name)}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h1 className="font-display font-bold text-[15px] sm:text-base text-[#1f1638] truncate">
                  {currentUser.name}
                </h1>
                <span className="px-1.5 py-0.5 rounded bg-[#f3eaff] text-[#58149c] border border-[#e8ddff] font-mono text-[10px] font-bold shrink-0">
                  @{currentUser.username}
                </span>
              </div>
              <p className="text-[11.5px] text-[#4b4452] truncate mt-0.5">
                {getWibGreeting()} · {derivedArea}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsOfflineModalOpen(true)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold border cursor-pointer ${
                isOnline
                  ? 'bg-[#ECFDF5] text-[#15803D] border-[#86EFAC]'
                  : 'bg-[#FEF3C7] text-[#B45309] border-[#FCD34D]'
              }`}
              title="Status Availability & Jaringan"
            >
              {isOnline ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
              <span>{isOnline ? 'Siap Tugas · Online' : 'Mode Offline'}</span>
            </button>
            <span className="text-[10.5px] text-[#7d7484] font-medium">
              {shortTodayLabel}
            </span>
          </div>
        </div>
      </section>

      {/* =============================================================== */}
      {/* 2. FIELD DISPATCH KPI MATRIX (MATRIKS 6 STATUS WORK ORDER)      */}
      {/* =============================================================== */}
      <section aria-label="Field Dispatch Matriks 6 Status Work Order" className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="font-display font-extrabold text-sm sm:text-base text-[#1f1638] leading-tight">
                Field Dispatch
              </h2>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wider border ${
                  !isOnline
                    ? 'bg-[#FEF3C7] text-[#B45309] border-[#FCD34D]'
                    : isKpiLoading
                    ? 'bg-[#f3eaff] text-[#58149c] border-[#d8ccf3]'
                    : 'bg-[#ECFDF5] text-[#15803D] border-[#86EFAC]'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    !isOnline
                      ? 'bg-[#B45309]'
                      : isKpiLoading
                      ? 'bg-[#58149c] animate-pulse'
                      : 'bg-[#15803D] animate-pulse'
                  }`}
                />
                <span>{!isOnline ? 'Offline' : isKpiLoading ? 'Syncing' : 'Live'}</span>
              </span>
            </div>
            <p className="text-[11px] text-[#7d7484] mt-0.5">
              Matriks 6 Status Work Order · {shortTodayLabel}
            </p>
          </div>

          <button
            type="button"
            onClick={() => refreshKpiSummary().catch(() => {})}
            disabled={isKpiLoading}
            aria-label="Muat Ulang KPI Field Dispatch"
            className="mj-btn-secondary px-2.5 py-1.5 rounded-xl text-[11px] inline-flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#58149c] ${isKpiLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {kpiError && !kpiSummary && (
          <div className="rounded-xl bg-[#FEF3C7] border border-[#FCD34D] px-3 py-2 flex items-center justify-between gap-2 text-xs text-[#B45309]">
            <span className="truncate font-semibold">Sinkronisasi server tertunda: {kpiError}</span>
            <button
              type="button"
              onClick={() => refreshKpiSummary().catch(() => {})}
              className="px-2.5 py-1 rounded-lg bg-white border border-[#FCD34D] text-[11px] font-bold text-[#B45309] shrink-0 cursor-pointer"
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
              accentBg: 'bg-[#EFF6FF]',
              accentBorder: 'border-[#93C5FD]',
              accentText: 'text-[#1D4ED8]',
              dotBg: 'bg-[#1D4ED8]'
            },
            {
              key: 'field_complete' as WOKpiFilterKey,
              label: 'Complete',
              sublabel: 'Teknisi Report = Done',
              value: fieldDispatchCounts.complete,
              icon: CheckCircle2,
              accentBg: 'bg-[#ECFDF5]',
              accentBorder: 'border-[#86EFAC]',
              accentText: 'text-[#15803D]',
              dotBg: 'bg-[#15803D]'
            },
            {
              key: 'field_requested' as WOKpiFilterKey,
              label: 'Requested',
              sublabel: 'Status: Assigned',
              value: fieldDispatchCounts.requested,
              icon: ClipboardList,
              accentBg: 'bg-[#F5F1FF]',
              accentBorder: 'border-[#D8B4FE]',
              accentText: 'text-[#6D28D9]',
              dotBg: 'bg-[#6D28D9]'
            },
            {
              key: 'field_reschedule' as WOKpiFilterKey,
              label: 'Reschedule',
              sublabel: 'Report: Reschedule',
              value: fieldDispatchCounts.reschedule,
              icon: CalendarClock,
              accentBg: 'bg-[#EEF2FF]',
              accentBorder: 'border-[#A5B4FC]',
              accentText: 'text-[#4338CA]',
              dotBg: 'bg-[#4338CA]'
            },
            {
              key: 'field_pending' as WOKpiFilterKey,
              label: 'Pending',
              sublabel: 'Report: Pending',
              value: fieldDispatchCounts.pending,
              icon: Hourglass,
              accentBg: 'bg-[#FEF3C7]',
              accentBorder: 'border-[#FCD34D]',
              accentText: 'text-[#B45309]',
              dotBg: 'bg-[#B45309]'
            },
            {
              key: 'field_cancel' as WOKpiFilterKey,
              label: 'Cancel',
              sublabel: 'Report: Cancel',
              value: fieldDispatchCounts.cancel,
              icon: XCircle,
              accentBg: 'bg-[#FEF2F2]',
              accentBorder: 'border-[#FCA5A5]',
              accentText: 'text-[#B91C1C]',
              dotBg: 'bg-[#B91C1C]'
            }
          ].map(card => {
            const IconComp = card.icon;
            const showSkeleton = isKpiLoading && !kpiSummary && myAllAssignedTickets.length === 0;
            return (
              <button
                key={card.key}
                type="button"
                onClick={() => handleFieldKpiDrillDown(card.key)}
                className="mj-enterprise-card rounded-2xl p-3 sm:p-3.5 text-left hover:border-[#7135b5]/45 active:scale-[0.99] transition-all cursor-pointer flex flex-col justify-between gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${card.dotBg}`} />
                    <span className="font-display font-bold text-xs sm:text-[13px] text-[#1f1638] truncate">
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
                    <span className="inline-block h-7 w-10 rounded-lg bg-[#f3eaff] animate-pulse" />
                  ) : (
                    <span
                      className={`font-display text-2xl sm:text-[26px] font-extrabold tabular-nums leading-none ${card.accentText}`}
                    >
                      {card.value}
                    </span>
                  )}
                  <span className="text-[10px] font-semibold text-[#7d7484] truncate">
                    WO
                  </span>
                </div>

                <span className="text-[10.5px] font-medium text-[#4b4452] truncate block">
                  {card.sublabel}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* =============================================================== */}
      {/* 3. OPERATIONAL BUCKET SUMMARY + PROGRESS PEKERJAAN HARI INI     */}
      {/* =============================================================== */}
      <section className="mj-enterprise-card rounded-2xl p-3.5 space-y-2.5">
        <div className="grid grid-cols-3 gap-2 pb-2.5 border-b border-[#e8ddff]">
          <button
            type="button"
            onClick={() => handleNavigateBucket('tugas_baru')}
            className="rounded-xl bg-[#f8f1ff] hover:bg-[#f3eaff] border border-[#e8ddff] px-2.5 py-2 text-left transition-colors cursor-pointer"
          >
            <span className="text-[10px] font-bold text-[#4b4452] uppercase block truncate">
              Tugas Baru
            </span>
            <span className="font-display text-lg font-extrabold text-[#1D4ED8] tabular-nums">
              {summary.tugasBaru}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigateBucket('dalam_proses')}
            className="rounded-xl bg-[#f8f1ff] hover:bg-[#f3eaff] border border-[#e8ddff] px-2.5 py-2 text-left transition-colors cursor-pointer"
          >
            <span className="text-[10px] font-bold text-[#4b4452] uppercase block truncate">
              Dalam Proses
            </span>
            <span className="font-display text-lg font-extrabold text-[#B45309] tabular-nums">
              {summary.dalamProses}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigateBucket('selesai')}
            className="rounded-xl bg-[#f8f1ff] hover:bg-[#f3eaff] border border-[#e8ddff] px-2.5 py-2 text-left transition-colors cursor-pointer"
          >
            <span className="text-[10px] font-bold text-[#4b4452] uppercase block truncate">
              WO Selesai
            </span>
            <span className="font-display text-lg font-extrabold text-[#15803D] tabular-nums">
              {summary.totalSelesaiAll}
            </span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="font-display font-bold text-[#1f1638] flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-[#58149c]" />
            <span>Progress Pekerjaan Hari Ini</span>
          </div>
          <span className="font-mono font-extrabold text-[#58149c] tabular-nums">
            {summary.selesai}/{summary.totalToday} WO ({summary.progressPct}%)
          </span>
        </div>

        <div className="w-full h-2.5 bg-[#f3eaff] rounded-full overflow-hidden border border-[#e8ddff]">
          <div
            className="h-full rounded-full bg-[#7135b5] transition-all duration-300"
            style={{ width: `${summary.progressPct}%` }}
          />
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px] text-[#4b4452] flex-wrap pt-0.5">
          <span>
            Appointment Hari Ini: <strong className="text-[#1f1638]">{summary.totalToday}</strong> · Check-In Foto:{' '}
            <strong className="text-[#1f1638]">{fieldDispatchCounts.checkIn}</strong>
          </span>
          {summary.awaitingApproval > 0 && (
            <button
              type="button"
              onClick={() => handleNavigateBucket('selesai')}
              className="font-bold text-[#58149c] hover:underline cursor-pointer"
            >
              {summary.awaitingApproval} Menunggu QC Dispatch →
            </button>
          )}
        </div>
      </section>

      {/* =============================================================== */}
      {/* 4. NOTIFIKASI PENTING (ONLY SHOWN WHEN RELEVANT)                */}
      {/* =============================================================== */}
      {hasImportantNotifications && (
        <section className="mj-enterprise-card rounded-2xl p-3.5 space-y-2 border-[#FCD34D]">
          <div className="flex items-center gap-1.5 text-xs font-bold text-[#1f1638]">
            <Bell className="w-4 h-4 text-[#B45309]" />
            <span>Notifikasi Penting</span>
          </div>

          <div className="space-y-2">
            {summary.revisionList.map(t => (
              <div
                key={`rev_${t.id}`}
                className="flex items-center justify-between gap-2 rounded-xl bg-[#FEF2F2] border border-[#FCA5A5] px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-bold text-[#B91C1C] block truncate">
                    Revisi Report: {t.woNumber} · {t.customerName}
                  </span>
                  <span className="text-[11px] text-[#B91C1C] block truncate">
                    {t.rejectionReason || t.progressReports?.[0]?.revisionReason || 'Perlu perbaikan laporan oleh teknisi'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenFullview(t, 'report')}
                  className="mj-btn-secondary px-2.5 py-1.5 rounded-lg text-[11px] text-[#B91C1C] border-[#FCA5A5] shrink-0 cursor-pointer"
                >
                  Perbaiki
                </button>
              </div>
            ))}

            {summary.highAttenuationList.map(t => (
              <div
                key={`opm_${t.id}`}
                className="flex items-center justify-between gap-2 rounded-xl bg-[#FEF3C7] border border-[#FCD34D] px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-bold text-[#B45309] block truncate">
                    Redaman OPM Tinggi ({t.technicalReport?.opticalPowerDbm || t.rosetRedamanDbm} dBm)
                  </span>
                  <span className="text-[11px] text-[#B45309] block truncate">
                    {t.woNumber} · {t.customerName}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenFullview(t, 'installation')}
                  className="mj-btn-secondary px-2.5 py-1.5 rounded-lg text-[11px] shrink-0 cursor-pointer"
                >
                  Cek Teknis
                </button>
              </div>
            ))}

            {(!isOnline || pendingCount > 0) && (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-[#f8f1ff] border border-[#e8ddff] px-3 py-2 text-xs">
                <span className="text-[#1f1638] font-medium truncate">
                  {!isOnline
                    ? `Offline (${pendingCount} antrean tersimpan lokal)`
                    : `${pendingCount} antrean sinkronisasi menunggu koneksi`}
                </span>
                <button
                  type="button"
                  onClick={() => setIsOfflineModalOpen(true)}
                  className="font-bold text-[#58149c] shrink-0 cursor-pointer"
                >
                  Cek Sync
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {/* =============================================================== */}
      {/* 5. APPOINTMENT HARI INI (COMPACT PRIORITIZED WO LIST)           */}
      {/* =============================================================== */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-2 px-0.5">
          <div className="flex items-center gap-1.5">
            <Calendar className="w-4 h-4 text-[#58149c]" />
            <h2 className="font-display font-bold text-sm sm:text-base text-[#1f1638]">
              Appointment Hari Ini ({prioritizedTodayTickets.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => handleNavigateBucket('tugas_baru')}
            className="text-xs font-bold text-[#58149c] hover:underline inline-flex items-center gap-1 cursor-pointer"
          >
            <span>Semua WO</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Compact Search */}
        {todayTickets.length > 0 && (
          <div className="relative">
            <Search className="w-4 h-4 text-[#7d7484] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari No. WO, Customer, Alamat, ID Pelanggan..."
              className="w-full min-h-[40px] pl-9 pr-8 py-1.5 bg-white border border-[#e8ddff] rounded-xl text-xs text-[#1f1638] placeholder:text-[#7d7484] focus:outline-none focus:ring-2 focus:ring-[#7135b5]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Hapus pencarian"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7d7484] hover:text-[#1f1638] cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {prioritizedTodayTickets.length === 0 ? (
          <div className="mj-enterprise-card rounded-2xl p-6 text-center space-y-2.5">
            <div className="w-11 h-11 mx-auto rounded-xl bg-[#f3eaff] text-[#58149c] flex items-center justify-center border border-[#e8ddff]">
              <Wrench className="w-5 h-5" />
            </div>
            <h3 className="font-display text-sm font-bold text-[#1f1638]">
              {todayTickets.length === 0 ? 'Belum Ada Appointment Hari Ini' : 'Tidak Ada WO yang Cocok'}
            </h3>
            <p className="text-xs text-[#4b4452] max-w-sm mx-auto">
              {todayTickets.length === 0
                ? 'WO yang didistribusikan Leader untuk hari ini akan muncul otomatis di sini.'
                : 'Ubah kata kunci pencarian atau buka daftar lengkap Work Order.'}
            </p>
            <button
              type="button"
              onClick={() => handleNavigateBucket('tugas_baru')}
              className="mj-tactile-btn-primary inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs cursor-pointer"
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
              const addressDisplay =
                [ticket.clusterName, ticket.streetName || ticket.address, ticket.area]
                  .filter(Boolean)
                  .join(' · ') || 'Alamat belum tersedia';
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
                  className="mj-enterprise-card rounded-2xl p-3.5 space-y-2.5 hover:border-[#cec3d4] transition-colors cursor-pointer"
                >
                  {/* Row 1: WO Number + Status */}
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#e8ddff]">
                    <span className="font-mono text-xs font-extrabold text-[#58149c]">
                      {ticket.woNumber}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <StatusInstallerBadge status={ticket.statusWOInstaller || 'Assigned'} />
                      {canonicalApproval === 'REVISION' && <StatusApprovalBadge status="REVISION" />}
                      {bucket === 'selesai' && canonicalReport !== 'NONE' && (
                        <StatusBadge status={canonicalReport} variant="report" />
                      )}
                    </div>
                  </div>

                  {/* Row 2: Customer + Address */}
                  <div>
                    <h3 className="font-display text-sm font-bold text-[#1f1638] truncate">
                      {ticket.customerName}
                    </h3>
                    <p className="text-xs text-[#4b4452] line-clamp-1 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-[#58149c] shrink-0" />
                      <span className="truncate">{addressDisplay}</span>
                    </p>
                  </div>

                  {/* Row 3: Slot / Tech Info */}
                  <div className="flex items-center justify-between gap-2 bg-[#f8f1ff] border border-[#e8ddff] rounded-xl px-2.5 py-1.5 text-[11px] text-[#4b4452]">
                    <span className="truncate font-semibold text-[#1f1638]">
                      {ticket.slotTime || 'Hari Ini'} · {workTypeLabel}
                    </span>
                    <span className="font-mono shrink-0 text-[#58149c] font-bold">
                      {bucket === 'dalam_proses'
                        ? `Foto ${photoCount}/${PHOTO_SLOT_DEFINITIONS.length}`
                        : bucket === 'selesai' && ticket.checkOutAt
                        ? `Selesai ${formatJakartaTimeOnly(ticket.checkOutAt)}`
                        : ticket.fatCode || 'FAT -'}
                    </span>
                  </div>

                  {/* Row 4: Action Footer */}
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
                        className="w-9 h-9 rounded-xl bg-[#f8f1ff] border border-[#e8ddff] text-[#58149c] flex items-center justify-center hover:bg-[#f3eaff] cursor-pointer"
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
                        className="w-9 h-9 rounded-xl bg-[#ECFDF5] border border-[#86EFAC] text-[#15803D] flex items-center justify-center hover:bg-emerald-100 disabled:opacity-45 cursor-pointer"
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
                        className="mj-tactile-btn-secondary px-3.5 py-2 min-h-[38px] rounded-xl border border-[#cec3d4] text-xs text-[#58149c] inline-flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>LIHAT DETAIL</span>
                      </button>
                    ) : bucket === 'tugas_baru' || !ticket.checkInAt ? (
                      <button
                        type="button"
                        onClick={e => handleTriggerCheckIn(e, ticket)}
                        className="mj-tactile-btn-primary px-4 py-2 min-h-[38px] rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer shrink-0"
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
                        className="mj-tactile-btn-primary px-3.5 py-2 min-h-[38px] rounded-xl text-xs inline-flex items-center gap-1.5 cursor-pointer shrink-0"
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
      {/* 6. COMPACT QUICK ACTIONS (TUGAS SAYA & BANTUAN KORLAP)          */}
      {/* =============================================================== */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => handleNavigateBucket('tugas_baru')}
          className="mj-tactile-btn-primary w-full min-h-[44px] px-4 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer"
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
          className="mj-tactile-btn-secondary w-full min-h-[44px] px-4 py-2.5 rounded-xl border border-[#cec3d4] text-[#58149c] text-xs flex items-center justify-center gap-2 cursor-pointer"
        >
          <HelpCircle className="w-4 h-4 shrink-0" />
          <span>Bantuan Korlap / Kendala</span>
        </button>
      </section>

      {/* ================================================================= */}
      {/* MODAL: BANTUAN KORLAP / RESCHEDULE / DARURAT (LIGHT THEME)        */}
      {/* ================================================================= */}
      <ResponsiveModal
        isOpen={Boolean(showHelpModal && modalTargetTicket)}
        onClose={() => setShowHelpModal(false)}
        size="sm"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<HelpCircle className="w-5 h-5 text-[#58149c]" />}
        title="Bantuan Korlap & Kendala"
        subtitle={
          modalTargetTicket
            ? `${modalTargetTicket.woNumber} · ${modalTargetTicket.customerName}`
            : undefined
        }
      >
        {modalTargetTicket && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#f3eaff] border border-[#e8ddff]">
              <button
                type="button"
                onClick={() => setHelpMode('korlap')}
                className={`min-h-[38px] py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  helpMode === 'korlap' ? 'bg-white text-[#58149c] shadow-2xs' : 'text-[#4b4452]'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Korlap</span>
              </button>
              <button
                type="button"
                onClick={() => setHelpMode('reschedule')}
                className={`min-h-[38px] py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  helpMode === 'reschedule' ? 'bg-white text-[#B45309] shadow-2xs' : 'text-[#4b4452]'
                }`}
              >
                <CalendarClock className="w-3.5 h-3.5" />
                <span>Reschedule</span>
              </button>
              <button
                type="button"
                onClick={() => setHelpMode('darurat')}
                className={`min-h-[38px] py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer ${
                  helpMode === 'darurat' ? 'bg-white text-[#B91C1C] shadow-2xs' : 'text-[#4b4452]'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Darurat</span>
              </button>
            </div>

            {derivedLeader.phone && (
              <a
                href={`tel:${derivedLeader.phone}`}
                className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#f8f1ff] border border-[#e8ddff] text-xs font-bold text-[#58149c]"
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
                <label className="block text-xs font-bold text-[#1f1638] mb-1">
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
                  className="w-full p-3 rounded-xl border border-[#e8ddff] bg-[#f8f1ff] text-xs text-[#1f1638] focus:outline-none focus:ring-2 focus:ring-[#58149c]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHelpModal(false)}
                  className="mj-btn-secondary flex-1 min-h-[42px] rounded-xl text-xs cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingHelp || helpNote.trim().length < 5}
                  className={`flex-1 min-h-[42px] rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                    helpMode === 'darurat'
                      ? 'bg-[#ba1a1a] hover:bg-[#93000a]'
                      : 'mj-tactile-btn-primary'
                  }`}
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
