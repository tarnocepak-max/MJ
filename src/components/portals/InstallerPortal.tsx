import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { Ticket, WOKpiFilterKey } from '../../types/index.ts';
import { StatusInstallerBadge, StatusWhatsAppBadge, StatusApprovalBadge, StatusBadge } from '../common/Badge';
import { TicketLiveChat } from '../chat/TicketLiveChat';
import { InstallerTicketFullview, FullviewFocusSection } from './InstallerTicketFullview';
import { TactileAlertBanner } from '../common/TactileAlertBanner';
import { KendalaReportModal } from '../tickets/KendalaReportModal';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { GeoTagCameraCheckInModal } from '../camera/GeoTagCameraCheckInModal';
import {
  matchesKpiFilter,
  KPI_FILTER_LABELS,
  isTicketClosed,
  isTicketCheckedIn,
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus,
  dedupeTicketsByCanonicalId,
  computeFieldDispatchCounts
} from '../../services/woLifecycleService';
import { getTicketAppointmentDate, formatAppointmentDateDisplay } from '../../services/appointmentDateParser';
import { openCustomerAddressInGoogleMaps, openCoordinatesInGoogleMaps, isValidCoordinatePair } from '../../services/mapsService';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import { PHOTO_SLOT_DEFINITIONS } from './fullview/types';
import {
  Wrench,
  Phone,
  MessageSquare,
  MapPin,
  CheckCircle2,
  Navigation,
  FileText,
  Clock,
  Camera,
  Search,
  X,
  AlertCircle,
  RefreshCw,
  WifiOff,
  ShieldAlert,
  ArrowUpDown,
  Calendar,
  Eye,
  ArrowRight,
  ShieldCheck,
  Gauge
} from 'lucide-react';

export type InstallerWoBucket = 'tugas_baru' | 'dalam_proses' | 'selesai';

export type StatusFilterCategory =
  | InstallerWoBucket
  | 'all'
  | 'pending'
  | 'butuh_approval'
  | 'revision'
  | 'done'
  | 'reschedule'
  | 'cancel';

interface InstallerPortalProps {
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
  initialFilter?: StatusFilterCategory;
}

function parseNumericDbm(raw?: string | number | null): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getTicketPhotoEvidenceCount(ticket: Ticket): number {
  if (Array.isArray(ticket.technicalReport?.photoSlots) && ticket.technicalReport!.photoSlots.length > 0) {
    return ticket.technicalReport!.photoSlots.filter(s => Boolean(s.url)).length;
  }
  if (typeof ticket.photoEvidenceCount === 'number' && ticket.photoEvidenceCount > 0) {
    return ticket.photoEvidenceCount;
  }
  if (Array.isArray(ticket.technicalReport?.photos)) {
    return ticket.technicalReport!.photos.length;
  }
  return 0;
}

/**
 * Legacy helper kept for compatibility with App.tsx pending count badge & analytics.
 */
export const classifyInstallerStatus = (ticket: Ticket): 'done' | 'pending' | 'reschedule' | 'cancel' => {
  const isCancel =
    ticket.statusWOInstaller === 'Failed / Cancelled' ||
    ticket.statusWOAgent === 'Cancelled' ||
    ticket.statusWhatsApp === 'cancelled' ||
    (ticket as any).statusWOInstaller === 'Cancel' ||
    (ticket as any).statusWOAgent === 'Cancel';

  if (isCancel) return 'cancel';

  const remarksInst = String(ticket.remarksWOInstaller ?? '').toLowerCase();
  const remarksAg = String(ticket.remarksAgent ?? '').toLowerCase();
  const appType = String(ticket.appointmentType ?? '').toLowerCase();
  const ticketCat = String(ticket.ticketCategory ?? '').toLowerCase();
  const isReschedule =
    ticket.statusWhatsApp === 'reschedule_requested' ||
    (ticket.statusWOInstaller === 'Pending Technical' &&
      (remarksInst.includes('reschedule') || remarksAg.includes('reschedule'))) ||
    remarksAg.includes('reschedule') ||
    remarksInst.includes('reschedule') ||
    appType.includes('reschedule') ||
    ticketCat.includes('reschedule') ||
    (ticket as any).statusWOInstaller === 'Reschedule';

  if (isReschedule) return 'reschedule';

  const isDone =
    ticket.statusWOInstaller === 'Completed' ||
    ticket.statusWOInstaller === 'Installed' ||
    ticket.statusWOAgent === 'Resolved' ||
    ticket.statusWOAgent === 'Closed' ||
    ticket.approvalStatus === 'APPROVED';

  if (isDone) return 'done';

  return 'pending';
};

/**
 * Splits Installer WOs strictly into 3 operational buckets:
 * 1. tugas_baru   (Requested / Newly assigned / Belum Check-In)
 * 2. dalam_proses (Sudah Check-In / In Progress / Belum Check-Out / Revisi)
 * 3. selesai      (Report selesai & Check-Out valid / Closed / Approved)
 */
export const classifyInstallerWoBucket = (ticket: Ticket): InstallerWoBucket => {
  const canonicalApproval = getTicketCanonicalApprovalStatus(ticket);
  const canonicalReport = getTicketCanonicalReportStatus(ticket);
  const closed = isTicketClosed(ticket);

  const isCompletedStatus =
    closed ||
    canonicalApproval === 'APPROVED' ||
    (canonicalApproval !== 'REVISION' &&
      (Boolean(ticket.checkOutAt) ||
        (Array.isArray(ticket.progressReports) && ticket.progressReports.length > 0) ||
        ['Completed', 'Installed', 'Failed / Cancelled', 'Cancel', 'Cancelled'].includes(
          String(ticket.statusWOInstaller || '')
        ) ||
        ['Resolved', 'Closed', 'Cancelled', 'Cancel'].includes(String(ticket.statusWOAgent || '')) ||
        canonicalReport === 'COMPLETE' ||
        canonicalReport === 'CANCEL'));

  if (isCompletedStatus) {
    return 'selesai';
  }

  const isCheckedInOrActive =
    canonicalApproval === 'REVISION' ||
    Boolean(ticket.checkInAt) ||
    Boolean(ticket.workStartedAt) ||
    isTicketCheckedIn(ticket) ||
    ['On Site', 'En Route', 'In Progress', 'Progress', 'Pending Technical'].includes(
      String(ticket.statusWOInstaller || '')
    ) ||
    ticket.workSessionStatus === 'Sedang Dikerjakan';

  if (isCheckedInOrActive) {
    return 'dalam_proses';
  }

  return 'tugas_baru';
};

export interface ContinueWorkGuidance {
  section: FullviewFocusSection;
  buttonLabel: string;
  stageLabel: string;
  installDone: boolean;
  photosDone: boolean;
  reportDone: boolean;
  photoCount: number;
}

export const getContinueWorkGuidance = (ticket: Ticket): ContinueWorkGuidance => {
  const canonicalApproval = getTicketCanonicalApprovalStatus(ticket);
  const photoCount = getTicketPhotoEvidenceCount(ticket);
  const requiredPhotos = 3;

  const hasTechInputs = Boolean(
    (ticket.technicalReport?.opticalPowerDbm || ticket.rosetRedamanDbm) &&
      (ticket.technicalReport?.deviceSerialNumber || ticket.ontSerialNumber || ticket.technicalReport?.fatPort || ticket.fatPort)
  );
  const photosDone = photoCount >= requiredPhotos;
  const reportDone = Boolean(
    Array.isArray(ticket.progressReports) &&
      ticket.progressReports.length > 0 &&
      canonicalApproval !== 'REVISION'
  );

  if (canonicalApproval === 'REVISION') {
    return {
      section: 'report',
      buttonLabel: 'Perbaiki Report',
      stageLabel: 'Revisi Dispatch',
      installDone: hasTechInputs,
      photosDone,
      reportDone: false,
      photoCount
    };
  }

  if (!hasTechInputs) {
    return {
      section: 'installation',
      buttonLabel: 'Lanjut Instalasi',
      stageLabel: 'Instalasi & Teknis',
      installDone: false,
      photosDone,
      reportDone,
      photoCount
    };
  }

  if (!photosDone) {
    return {
      section: 'photos',
      buttonLabel: `Lengkapi Foto (${photoCount}/${requiredPhotos})`,
      stageLabel: `Bukti Foto (${photoCount}/${requiredPhotos})`,
      installDone: true,
      photosDone: false,
      reportDone,
      photoCount
    };
  }

  if (!reportDone) {
    return {
      section: 'report',
      buttonLabel: 'Buat Report',
      stageLabel: 'Siap Report',
      installDone: true,
      photosDone: true,
      reportDone: false,
      photoCount
    };
  }

  return {
    section: 'checkout',
    buttonLabel: 'Check-Out',
    stageLabel: 'Siap Check-Out',
    installDone: true,
    photosDone: true,
    reportDone: true,
    photoCount
  };
};

function formatCompletedDateLabel(raw?: string): string {
  if (!raw) return '-';
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(new Date(raw));
  } catch {
    return raw.slice(0, 10);
  }
}

export const InstallerPortal: React.FC<InstallerPortalProps> = ({
  onOpenWhatsApp,
  initialFilter = 'tugas_baru'
}) => {
  const {
    tickets,
    currentUser,
    users,
    todayWIB,
    activeKpiDrilldown,
    setActiveKpiDrilldown,
    refreshKpiSummary,
    getTicketUnreadCount,
    setTicketChatCategory,
    realtimeConnectionState
  } = useApp();
  const { toast } = useToast();
  const { isOnline, pendingCount, syncNow, isSyncing, setIsOfflineModalOpen } = useOfflineSync();

  const myInstallers = users.filter(u => u.role === 'installer');
  const [selectedInstallerName, setSelectedInstallerName] = useState<string>(
    currentUser.role === 'installer' ? currentUser.name : (myInstallers[0]?.name || '')
  );

  const effectiveInstallerName = currentUser.role === 'installer' ? currentUser.name : selectedInstallerName;

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

  // All non-archived tickets assigned to this Installer (deduplicated by canonical WO ID)
  const myAssignedTickets = useMemo(() => {
    if (currentUser.role === 'installer') {
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const myName = (currentUser.name || '').toLowerCase().trim();

      return dedupeTicketsByCanonicalId(
        (tickets || []).filter(t => {
          if (t.isArchived || t.isDeleted) return false;
          if (!t.installerName && !t.assignedTo && !t.installerId) return false;

          if (myId && (t.assignedTo === myId || t.installerId === myId)) return true;
          if (myUsername && t.assignedTo && t.assignedTo.toLowerCase().trim() === myUsername) return true;
          if (myName && isInstallerMatch(t.installerName, myName)) return true;
          if (myUsername && isInstallerMatch(t.installerName, myUsername)) return true;
          return false;
        })
      );
    }

    return dedupeTicketsByCanonicalId(
      (tickets || []).filter(
        t =>
          !t.isArchived &&
          !t.isDeleted &&
          Boolean(t.installerName) &&
          isInstallerMatch(t.installerName, effectiveInstallerName)
      )
    );
  }, [tickets, currentUser, effectiveInstallerName]);

  const mapInitialToBucket = (filter?: StatusFilterCategory): InstallerWoBucket => {
    if (filter === 'selesai' || filter === 'done') return 'selesai';
    if (filter === 'dalam_proses' || filter === 'revision') return 'dalam_proses';
    if (filter === 'tugas_baru') return 'tugas_baru';
    if (filter === 'butuh_approval') return 'selesai';
    return 'tugas_baru';
  };

  const [activeBucket, setActiveBucket] = useState<InstallerWoBucket>(() => mapInitialToBucket(initialFilter));
  const [dateScope, setDateScope] = useState<'today' | 'all'>(() =>
    initialFilter === 'done' || initialFilter === 'selesai' ? 'all' : 'today'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'slot' | 'status' | 'wo'>('slot');
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!initialFilter) return;
    if (initialFilter === 'done' || initialFilter === 'selesai') {
      setActiveBucket('selesai');
      setDateScope('all');
    } else if (initialFilter === 'dalam_proses' || initialFilter === 'revision') {
      setActiveBucket('dalam_proses');
    } else if (initialFilter === 'tugas_baru') {
      setActiveBucket('tugas_baru');
    } else if (initialFilter === 'butuh_approval') {
      setActiveBucket('selesai');
    } else if (initialFilter === 'pending' || initialFilter === 'all') {
      setActiveBucket('tugas_baru');
    }
  }, [initialFilter]);

  useEffect(() => {
    if (!activeKpiDrilldown) return;
    if (activeKpiDrilldown.dateWIB === todayWIB) {
      setDateScope('today');
    }
    const fk = activeKpiDrilldown.filterKey;
    if (fk === 'field_requested') {
      setActiveBucket('tugas_baru');
    } else if (fk === 'field_checkin') {
      setActiveBucket('dalam_proses');
    } else if (
      fk === 'field_complete' ||
      fk === 'field_reschedule' ||
      fk === 'field_pending' ||
      fk === 'field_cancel' ||
      fk === 'report_complete' ||
      fk === 'report_reschedule' ||
      fk === 'report_pending' ||
      fk === 'report_cancel'
    ) {
      setActiveBucket('selesai');
    }
  }, [activeKpiDrilldown, todayWIB]);

  const [fullviewTicket, setFullviewTicket] = useState<Ticket | null>(null);
  const [fullviewFocusSection, setFullviewFocusSection] = useState<FullviewFocusSection | undefined>(undefined);
  const [chatInitialCategory, setChatInitialCategory] = useState<string | undefined>(undefined);
  const [chatModalTicket, setChatModalTicket] = useState<Ticket | null>(null);
  const [checkInCameraTicket, setCheckInCameraTicket] = useState<Ticket | null>(null);
  const [kendalaTicket, setKendalaTicket] = useState<Ticket | null>(null);

  // Scope operational queue to Today's appointments (plus completed work) when dateScope === 'today'
  const scopedTickets = useMemo(() => {
    return myAssignedTickets.filter(t => {
      if (dateScope === 'all') return true;
      const appDate = getTicketAppointmentDate(t);
      const bucket = classifyInstallerWoBucket(t);
      if (bucket === 'selesai') return true;
      return appDate === todayWIB;
    });
  }, [myAssignedTickets, dateScope, todayWIB]);

  // Exact date-scoped Field Dispatch KPI counts (synced 1:1 with Dashboard Field Dispatch matrix)
  const fieldDispatchDateScopedCounts = useMemo(() => {
    const pool = dateScope === 'all'
      ? myAssignedTickets
      : myAssignedTickets.filter(t => getTicketAppointmentDate(t) === (activeKpiDrilldown?.dateWIB || todayWIB));
    return computeFieldDispatchCounts(pool);
  }, [myAssignedTickets, dateScope, activeKpiDrilldown?.dateWIB, todayWIB]);

  const bucketCounts = useMemo(() => {
    let tugas_baru = 0;
    let dalam_proses = 0;
    let selesai = 0;

    scopedTickets.forEach(t => {
      const bucket = classifyInstallerWoBucket(t);
      if (bucket === 'tugas_baru') tugas_baru++;
      else if (bucket === 'dalam_proses') dalam_proses++;
      else selesai++;
    });

    return { tugas_baru, dalam_proses, selesai };
  }, [scopedTickets]);

  const displayedTickets = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const basePool = activeKpiDrilldown
      ? myAssignedTickets.filter(t => {
          if (dateScope === 'all') return true;
          const targetDate = activeKpiDrilldown.dateWIB || todayWIB;
          return getTicketAppointmentDate(t) === targetDate;
        })
      : scopedTickets;

    const matched = basePool.filter(t => {
      if (activeKpiDrilldown) {
        if (!matchesKpiFilter(t, activeKpiDrilldown.filterKey)) {
          return false;
        }
      } else if (classifyInstallerWoBucket(t) !== activeBucket) {
        return false;
      }

      if (q) {
        const matchWO = String(t.woNumber ?? '').toLowerCase().includes(q);
        const matchCust = String(t.customerName ?? '').toLowerCase().includes(q);
        const matchCustId = String(t.idCustomer || t.customerId || '').toLowerCase().includes(q);
        const matchPhone = String(t.customerPhone ?? '').toLowerCase().includes(q);
        const matchAddr = [t.streetName, t.address, t.clusterName, t.area]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
        return matchWO || matchCust || matchCustId || matchPhone || matchAddr;
      }

      return true;
    });

    return [...matched].sort((a, b) => {
      if (sortBy === 'wo') {
        return String(a.woNumber || '').localeCompare(String(b.woNumber || ''));
      }
      if (sortBy === 'status') {
        return String(a.statusWOInstaller || '').localeCompare(String(b.statusWOInstaller || ''));
      }
      if (activeBucket === 'selesai' && !activeKpiDrilldown) {
        const da = new Date(a.checkOutAt || a.updatedAt || 0).getTime();
        const db = new Date(b.checkOutAt || b.updatedAt || 0).getTime();
        if (da !== db) return db - da;
      }
      return String(a.slotTime || '').localeCompare(String(b.slotTime || ''));
    });
  }, [myAssignedTickets, scopedTickets, dateScope, todayWIB, activeBucket, searchQuery, sortBy, activeKpiDrilldown]);

  // Realtime synced ticket if fullview is open
  const activeFullviewTicket = useMemo(() => {
    if (!fullviewTicket) return null;
    return (tickets || []).find(t => t.id === fullviewTicket.id) || fullviewTicket;
  }, [tickets, fullviewTicket]);

  // Operational critical alerts
  const criticalRevisionTicket = useMemo(
    () => myAssignedTickets.find(t => !isTicketClosed(t) && getTicketCanonicalApprovalStatus(t) === 'REVISION'),
    [myAssignedTickets]
  );

  const highAttenuationTicket = useMemo(() => {
    return myAssignedTickets.find(t => {
      if (isTicketClosed(t)) return false;
      const val = parseNumericDbm(t.technicalReport?.opticalPowerDbm || t.rosetRedamanDbm);
      return val !== null && val < -24;
    });
  }, [myAssignedTickets]);

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

  const handleOpenChat = (ticket: Ticket, category?: string) => {
    setChatInitialCategory(category);
    if (category) {
      setTicketChatCategory(ticket.id, category);
    }
    setChatModalTicket(ticket);
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

  return (
    <div className="max-w-lg md:max-w-3xl lg:max-w-5xl mx-auto space-y-3.5 pb-20 sm:pb-8">
      {/* Operational Alerts */}
      {criticalRevisionTicket && !dismissedAlertIds[`rev_${criticalRevisionTicket.id}`] && (
        <TactileAlertBanner
          variant="critical"
          badge="REVISI DISPATCH"
          metricBadge={criticalRevisionTicket.woNumber}
          title={`Laporan ${criticalRevisionTicket.customerName} perlu revisi`}
          description={
            criticalRevisionTicket.rejectionReason ||
            criticalRevisionTicket.progressReports?.[0]?.revisionReason ||
            'Periksa catatan Dispatch dan kirim ulang revisi laporan.'
          }
          primaryAction={{
            label: 'Perbaiki Report',
            icon: <FileText className="w-3.5 h-3.5" />,
            onClick: () => handleOpenFullview(criticalRevisionTicket, 'report')
          }}
          onDismiss={() =>
            setDismissedAlertIds(prev => ({ ...prev, [`rev_${criticalRevisionTicket.id}`]: true }))
          }
        />
      )}

      {highAttenuationTicket && !dismissedAlertIds[`opm_${highAttenuationTicket.id}`] && (
        <TactileAlertBanner
          variant="critical"
          badge="PERINGATAN REDAMAN"
          metricBadge={`${highAttenuationTicket.technicalReport?.opticalPowerDbm || highAttenuationTicket.rosetRedamanDbm} (${highAttenuationTicket.woNumber})`}
          title={`Redaman > batas toleransi (-24 dBm) pada ${highAttenuationTicket.woNumber}`}
          description={`Pelanggan ${highAttenuationTicket.customerName}. Cek tekukan kabel dropcore dan kebersihan konektor sebelum Check-Out.`}
          primaryAction={{
            label: 'Periksa Teknis',
            icon: <Wrench className="w-3.5 h-3.5" />,
            onClick: () => handleOpenFullview(highAttenuationTicket, 'installation')
          }}
          onDismiss={() =>
            setDismissedAlertIds(prev => ({ ...prev, [`opm_${highAttenuationTicket.id}`]: true }))
          }
        />
      )}

      {/* Offline / Pending Sync Bar */}
      {(!isOnline || pendingCount > 0) && (
        <div className="rounded-xl bg-[#EAE8FF] dark:bg-[#2A194B] border border-[#DCE3F2] dark:border-[#4B386B] px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white dark:bg-[#160D29] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0 border border-[#DDE6F0] dark:border-[#35105E]">
              {!isOnline ? (
                <WifiOff className="w-4 h-4 text-[#C88735] dark:text-amber-300" />
              ) : (
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              )}
            </div>
            <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] truncate">
              {!isOnline
                ? `Mode Offline Aktif (${pendingCount} log tersimpan lokal)`
                : `${pendingCount} antrean data siap disinkronkan`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isOnline && pendingCount > 0 && (
              <button
                type="button"
                onClick={() => syncNow()}
                disabled={isSyncing}
                className={`mj-btn-installer-secondary mj-btn-xs px-3 py-1 text-xs cursor-pointer ${
                  isSyncing ? 'mj-btn-loading' : ''
                }`}
              >
                {isSyncing ? 'Sync...' : 'Sync'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOfflineModalOpen(true)}
              className="mj-btn-installer-neutral mj-btn-xs px-2.5 py-1 text-xs font-bold cursor-pointer"
            >
              Detail
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* HEADER, SHIFT BANNER, TACTILE TABS & DEBOSSED SEARCH BAR     */}
      {/* ============================================================ */}
      <section className="card-3d-lavender mj-banner-glossy-3d rounded-2xl p-3.5 sm:p-4 space-y-3 relative overflow-hidden">
        {/* Top Area / Shift Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#DDE6F0] dark:border-[#35105E]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#DDF4F4] dark:bg-gradient-to-r dark:from-[#160D29] dark:to-[#35105E] text-[#2E7D8B] dark:text-[#EEDBFF] font-mono text-[10px] font-bold border border-[#BDE4E8] dark:border-[#58149C]/40"
                title={`Status SSE: ${realtimeConnectionState}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    realtimeConnectionState === 'connected'
                      ? 'bg-[#218A63] dark:bg-emerald-400 animate-pulse'
                      : realtimeConnectionState === 'reconnecting' || realtimeConnectionState === 'connecting'
                      ? 'bg-amber-500 animate-pulse'
                      : 'bg-rose-500'
                  }`}
                />
                <span>{currentUser.area || 'TIM LAPANGAN'} · {currentUser.contractor || effectiveInstallerName}</span>
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1.5">
              <h2 className="font-display text-base sm:text-lg font-extrabold text-[#26364A] dark:text-[#f5eeff]">
                Work Order Lapangan
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] border border-[#DCE3F2] dark:border-[#4B386B] font-mono text-[10.5px] font-bold">
                {effectiveInstallerName}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {currentUser.role !== 'installer' && (
              <select
                aria-label="Pilih Teknisi"
                value={selectedInstallerName}
                onChange={e => setSelectedInstallerName(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-[#F8FAFD] dark:bg-[#160D29] rounded-xl font-semibold text-[#26364A] dark:text-[#f5eeff] border border-[#DDE6F0] dark:border-[#35105E] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5]"
              >
                {myInstallers.map(inst => (
                  <option key={inst.id} value={inst.name}>
                    {inst.name}
                  </option>
                ))}
              </select>
            )}

            <div className="inline-flex rounded-xl bg-[#EDF3F8] dark:bg-[#160D29] p-0.5 border border-[#DDE6F0] dark:border-[#35105E] text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setDateScope('today')}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  dateScope === 'today'
                    ? 'bg-white dark:bg-[#35105E] text-[#5145A6] dark:text-[#f5eeff] shadow-2xs'
                    : 'text-[#52647A] dark:text-[#A79BC0]'
                }`}
              >
                Hari Ini ({formatAppointmentDateDisplay(todayWIB) || todayWIB})
              </button>
              <button
                type="button"
                onClick={() => setDateScope('all')}
                className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  dateScope === 'all'
                    ? 'bg-white dark:bg-[#35105E] text-[#5145A6] dark:text-[#f5eeff] shadow-2xs'
                    : 'text-[#52647A] dark:text-[#A79BC0]'
                }`}
              >
                Semua
              </button>
            </div>
          </div>
        </div>

        {/* 3 Segmented Tabs: Tugas Baru | Dalam Proses | Selesai */}
        <div
          role="tablist"
          aria-label="Kategori Status Work Order"
          className="mj-tactile-tab-bar grid grid-cols-3 gap-1 p-1 border border-[#DDE6F0] dark:border-[#35105E]"
        >
          {(
            [
              {
                key: 'tugas_baru' as InstallerWoBucket,
                label: 'Tugas Baru',
                count: bucketCounts.tugas_baru,
                badgeCls: 'bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] border-[#DCE3F2] dark:border-[#5B35B1]'
              },
              {
                key: 'dalam_proses' as InstallerWoBucket,
                label: 'Dalam Proses',
                count: bucketCounts.dalam_proses,
                badgeCls: 'bg-[#FFF2D9] dark:bg-amber-950/50 text-[#9D661F] dark:text-amber-300 border-[#F2CF95] dark:border-amber-700/60'
              },
              {
                key: 'selesai' as InstallerWoBucket,
                label: 'Selesai',
                count: bucketCounts.selesai,
                badgeCls: 'bg-[#E4F5EC] dark:bg-emerald-950/50 text-[#218A63] dark:text-emerald-300 border-[#B7E4CC] dark:border-emerald-700/60'
              }
            ] as const
          ).map(tab => {
            const isSelected = !activeKpiDrilldown && activeBucket === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={isSelected}
                onClick={() => {
                  setActiveKpiDrilldown(null);
                  setActiveBucket(tab.key);
                }}
                className={`min-h-[42px] px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  isSelected
                    ? 'mj-tactile-tab-active text-[#5145A6] dark:text-[#f5eeff]'
                    : 'text-[#52647A] dark:text-[#A79BC0] hover:text-[#26364A] dark:hover:text-white'
                }`}
              >
                <span className="truncate">{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold tabular-nums border ${tab.badgeCls}`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Field Dispatch 6-Status Quick Filter Strip */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          {(
            [
              { key: 'field_checkin' as WOKpiFilterKey, label: 'Check-in', count: fieldDispatchDateScopedCounts.checkIn },
              { key: 'field_complete' as WOKpiFilterKey, label: 'Complete', count: fieldDispatchDateScopedCounts.complete },
              { key: 'field_requested' as WOKpiFilterKey, label: 'Requested', count: fieldDispatchDateScopedCounts.requested },
              { key: 'field_reschedule' as WOKpiFilterKey, label: 'Reschedule', count: fieldDispatchDateScopedCounts.reschedule },
              { key: 'field_pending' as WOKpiFilterKey, label: 'Pending', count: fieldDispatchDateScopedCounts.pending },
              { key: 'field_cancel' as WOKpiFilterKey, label: 'Cancel', count: fieldDispatchDateScopedCounts.cancel }
            ] as const
          ).map(chip => {
            const isChipActive = activeKpiDrilldown?.filterKey === chip.key;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => {
                  if (isChipActive) {
                    setActiveKpiDrilldown(null);
                  } else {
                    setActiveKpiDrilldown({
                      filterKey: chip.key,
                      dateWIB: dateScope === 'today' ? todayWIB : undefined
                    });
                  }
                }}
                className={`px-2.5 py-1 text-[11px] font-bold whitespace-nowrap gap-1 cursor-pointer shrink-0 ${
                  isChipActive
                    ? 'mj-btn-installer-primary mj-btn-xs'
                    : 'mj-btn-installer-neutral mj-btn-xs'
                }`}
              >
                <span>{chip.label}</span>
                <span
                  className={`font-mono text-[10px] tabular-nums ${
                    isChipActive ? 'text-[#DDF4F4] dark:text-[#DAB9FF]' : 'text-[#5145A6] dark:text-[#DAB9FF]'
                  }`}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Debossed Search & Sort Bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-[#8492A5] dark:text-[#A79BC0] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Cari No. WO, Pelanggan, FAT/ODP, Alamat..."
              className="tactile-debossed-input w-full min-h-[42px] pl-9 pr-8 py-1.5 bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl text-xs text-[#26364A] dark:text-[#f5eeff] placeholder:text-[#8492A5] dark:placeholder:text-[#A79BC0] focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135b5]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Hapus pencarian"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8492A5] dark:text-[#7d7484] hover:text-[#26364A] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-[#F8FAFD] dark:bg-[#160D29] px-2.5 min-h-[42px] rounded-xl border border-[#DDE6F0] dark:border-[#35105E] shrink-0">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
            <select
              aria-label="Urutkan Work Order"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'slot' | 'status' | 'wo')}
              className="bg-transparent text-xs font-bold text-[#26364A] dark:text-[#f5eeff] focus:outline-none cursor-pointer"
            >
              <option value="slot">Slot</option>
              <option value="status">Status</option>
              <option value="wo">No. WO</option>
            </select>
          </div>
        </div>
      </section>

      {/* Active KPI Drilldown Notice */}
      {activeKpiDrilldown && (
        <div className="bg-[#EAE8FF] dark:bg-[#2A194B] border border-[#DCE3F2] dark:border-[#4B386B] rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-[#26364A] dark:text-[#f5eeff]">
            Filter Aktif:{' '}
            <strong className="text-[#5145A6] dark:text-[#DAB9FF]">
              {KPI_FILTER_LABELS[activeKpiDrilldown.filterKey] || activeKpiDrilldown.filterKey}
            </strong>{' '}
            ({displayedTickets.length} WO)
          </span>
          <button
            type="button"
            onClick={() => setActiveKpiDrilldown(null)}
            className="mj-btn-installer-neutral mj-btn-xs px-2.5 py-1 text-[11px] font-bold cursor-pointer"
          >
            Reset
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* WORK ORDER LIST BY BUCKET                                    */}
      {/* ============================================================ */}
      {displayedTickets.length === 0 ? (
        <div className="card-3d-lavender rounded-2xl p-8 text-center space-y-2.5">
          <div className="w-12 h-12 mx-auto rounded-xl bg-[#EAE8FF] dark:bg-[#2A194B] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center border border-[#DCE3F2] dark:border-[#4B386B]">
            <Wrench className="w-6 h-6" />
          </div>
          <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-[#f5eeff]">
            {activeKpiDrilldown
              ? `Tidak Ada WO: ${KPI_FILTER_LABELS[activeKpiDrilldown.filterKey] || activeKpiDrilldown.filterKey}`
              : activeBucket === 'tugas_baru'
              ? 'Tidak Ada Tugas Baru'
              : activeBucket === 'dalam_proses'
              ? 'Tidak Ada WO Dalam Proses'
              : 'Belum Ada WO Selesai'}
          </h3>
          <p className="text-xs text-[#52647A] dark:text-[#C4B5D6] max-w-sm mx-auto">
            {searchQuery
              ? 'Tidak ada Work Order yang cocok dengan kata kunci pencarian Anda.'
              : activeKpiDrilldown
              ? `Tidak ada Work Order yang memenuhi kriteria status ${KPI_FILTER_LABELS[activeKpiDrilldown.filterKey] || activeKpiDrilldown.filterKey} pada cakupan tanggal ini.`
              : activeBucket === 'tugas_baru'
              ? 'Semua WO yang baru didistribusikan kepada Anda akan muncul otomatis di tab ini.'
              : activeBucket === 'dalam_proses'
              ? 'WO yang sudah di-Check-In dan sedang dikerjakan akan tampil di sini.'
              : 'WO yang sudah selesai Report & Check-Out akan terarsip rapi di tab Selesai.'}
          </p>
          {(searchQuery || dateScope === 'today' || activeKpiDrilldown) && (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {activeKpiDrilldown && (
                <button
                  type="button"
                  onClick={() => setActiveKpiDrilldown(null)}
                  className="mj-btn-installer-neutral mj-btn-compact px-3 py-1.5 text-xs font-bold cursor-pointer"
                >
                  Reset Filter KPI
                </button>
              )}
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="mj-btn-installer-neutral mj-btn-compact px-3 py-1.5 text-xs font-bold cursor-pointer"
                >
                  Hapus Pencarian
                </button>
              )}
              {dateScope === 'today' && myAssignedTickets.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDateScope('all')}
                  className="mj-btn-installer-primary mj-btn-compact px-3.5 py-1.5 text-xs font-bold cursor-pointer"
                >
                  Lihat Semua Tanggal ({myAssignedTickets.length})
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 items-start">
          {displayedTickets.map(ticket => {
            const unread = getTicketUnreadCount(ticket.id);
            const hasHouseGps = isValidCoordinatePair(
              ticket.houseLocation?.latitude,
              ticket.houseLocation?.longitude
            );
            const addressDisplay = [ticket.clusterName, ticket.streetName || ticket.address, ticket.area]
              .filter(Boolean)
              .join(' · ') || 'Alamat belum tersedia';
            const appDateDisplay =
              formatAppointmentDateDisplay(getTicketAppointmentDate(ticket)) ||
              ticket.appointmentDate ||
              '-';
            const workTypeLabel = ticket.ticketCategory || ticket.appointmentType || 'New Installation';
            const canonicalApproval = getTicketCanonicalApprovalStatus(ticket);
            const canonicalReport = getTicketCanonicalReportStatus(ticket);
            const photoCount = getTicketPhotoEvidenceCount(ticket);
            const cardBucket = classifyInstallerWoBucket(ticket);

            const rawOpmStr =
              ticket.technicalReport?.opticalPowerDbm ||
              ticket.rosetRedamanDbm ||
              ticket.fatRedamanDbm ||
              '';
            const opmNum = rawOpmStr
              ? parseFloat(String(rawOpmStr).replace(',', '.').match(/-?\d+(\.\d+)?/)?.[0] || '')
              : NaN;
            const hasValidOpm = !Number.isNaN(opmNum);
            const isOpmPass = hasValidOpm && opmNum <= -15 && opmNum >= -24;

            /* -------------------------------------------------------- */
            /* CARD VARIANT C: SELESAI (COMPACT COMPLETED WO)           */
            /* -------------------------------------------------------- */
            if (cardBucket === 'selesai') {
              return (
                <article
                  key={ticket.id}
                  onClick={() => handleOpenFullview(ticket)}
                  className="card-3d-lavender rounded-2xl overflow-hidden hover:border-[#65B8C4] dark:hover:border-[#A380FE] transition-colors cursor-pointer"
                >
                  <div className="h-1.5 w-full bg-gradient-to-r from-[#218A63] via-[#3FB588] to-[#2E7D8B] dark:from-[#16A36A] dark:via-emerald-400 dark:to-[#059669]" />
                  <div className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-extrabold text-[#5145A6] dark:text-[#DAB9FF] tracking-tight block">
                          {ticket.woNumber}
                        </span>
                        <h3 className="font-display text-sm font-bold text-[#26364A] dark:text-[#f5eeff] truncate mt-0.5">
                          {ticket.customerName}
                        </h3>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                        {canonicalReport !== 'NONE' && (
                          <StatusBadge status={canonicalReport} variant="report" />
                        )}
                        {canonicalApproval !== 'NONE' && (
                          <StatusApprovalBadge status={canonicalApproval} />
                        )}
                        {canonicalReport === 'NONE' && canonicalApproval === 'NONE' && (
                          <StatusInstallerBadge status={ticket.statusWOInstaller} displayRole="installer" />
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl p-2.5 text-[11px]">
                      <div>
                        <span className="text-[#8492A5] dark:text-[#A79BC0] block">Appointment</span>
                        <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] block truncate">
                          {appDateDisplay} {ticket.slotTime ? `(${ticket.slotTime})` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#8492A5] dark:text-[#A79BC0] block">Selesai</span>
                        <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] block truncate">
                          {formatCompletedDateLabel(ticket.checkOutAt || ticket.updatedAt)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#8492A5] dark:text-[#A79BC0] block">Check-In / Check-Out</span>
                        <span className="font-mono font-bold text-[#26364A] dark:text-[#f5eeff] tabular-nums block truncate">
                          {ticket.checkInAt ? formatJakartaTimeOnly(ticket.checkInAt) : '-'} →{' '}
                          {ticket.checkOutAt ? formatJakartaTimeOnly(ticket.checkOutAt) : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#8492A5] dark:text-[#A79BC0] block">Work Type &amp; OPM</span>
                        <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] block truncate">
                          {workTypeLabel}
                          {hasValidOpm ? ` · ${opmNum} dBm` : ''}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[11px] text-[#52647A] dark:text-[#C4B5D6] truncate font-mono">
                        {photoCount}/{PHOTO_SLOT_DEFINITIONS.length} Foto · {ticket.fatCode || 'FAT -'}
                      </span>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleOpenFullview(ticket);
                        }}
                        className="mj-btn-installer-neutral mj-btn-compact px-3.5 py-2 text-xs font-bold gap-1.5 cursor-pointer shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Ringkasan BAST</span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            }

            /* -------------------------------------------------------- */
            /* CARD VARIANT B: DALAM PROSES (CONTINUE WORK + OPM LCD)   */
            /* -------------------------------------------------------- */
            if (cardBucket === 'dalam_proses') {
              const guidance = getContinueWorkGuidance(ticket);
              const checkInLabel = ticket.checkInAt
                ? `${formatJakartaTimeOnly(ticket.checkInAt)} WIB`
                : 'Belum Foto Check-In';
              const revisionNote =
                ticket.rejectionReason ||
                ticket.progressReports?.[0]?.revisionReason ||
                ticket.progressReports?.[0]?.rejectionReason;

              return (
                <article
                  key={ticket.id}
                  onClick={() => handleOpenFullview(ticket, guidance.section)}
                  className={`card-3d-lavender rounded-2xl overflow-hidden transition-colors cursor-pointer ${
                    canonicalApproval === 'REVISION' ? 'border-[#F3C5CA] dark:border-rose-700' : 'hover:border-[#65B8C4] dark:hover:border-[#A380FE]'
                  }`}
                >
                  {/* Top Status Accent Bar */}
                  <div
                    className={`h-1.5 w-full ${
                      canonicalApproval === 'REVISION'
                        ? 'bg-gradient-to-r from-[#D45B66] to-[#9B2C37] dark:from-[#BA1A1A] dark:to-[#480123]'
                        : 'bg-gradient-to-r from-[#65B8C4] via-[#6657C8] to-[#5145A6] dark:from-[#58149C] dark:via-[#A380FE] dark:to-[#7135B5]'
                    }`}
                  />

                  <div className="p-4 space-y-3">
                    {/* 1-2: WO Number + Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-xs font-extrabold text-[#5145A6] dark:text-[#DAB9FF]">
                            {ticket.woNumber}
                          </span>
                          <span className="text-[11px] font-semibold text-[#52647A] dark:text-[#C4B5D6]">
                            · {ticket.slotTime || 'Hari Ini'}
                          </span>
                        </div>
                        <h3 className="font-display text-[15px] font-extrabold text-[#26364A] dark:text-[#f5eeff] truncate mt-0.5">
                          {ticket.customerName}
                        </h3>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                        <StatusInstallerBadge status={ticket.statusWOInstaller || 'In Progress'} displayRole="installer" />
                        {canonicalApproval === 'REVISION' && (
                          <StatusApprovalBadge status="REVISION" />
                        )}
                      </div>
                    </div>

                    {/* Revision banner if returned by Dispatch */}
                    {canonicalApproval === 'REVISION' && (
                      <div className="rounded-xl bg-[#FCE9EB] dark:bg-rose-950/50 border border-[#F3C5CA] dark:border-rose-800/60 px-3 py-2 text-[11px] text-[#9B2C37] dark:text-rose-200">
                        <span className="font-bold">Revisi Dispatch: </span>
                        <span>{revisionNote || 'Perbaiki data report dan kirim ulang.'}</span>
                      </div>
                    )}

                    {/* Customer Info Inset Well */}
                    <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-2.5 space-y-1 text-xs text-[#52647A] dark:text-[#C4B5D6]">
                      <div className="flex items-start gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#A380FE] shrink-0 mt-0.5" />
                        <span className="whitespace-normal break-words leading-snug">{addressDisplay}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11px] pt-1 border-t border-[#DDE6F0] dark:border-[#35105E]">
                        <span className="inline-flex items-center gap-1 font-semibold text-[#26364A] dark:text-[#f5eeff]">
                          <Clock className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                          <span>Check-In: {checkInLabel}</span>
                        </span>
                        <span className="font-mono font-bold text-[#5145A6] dark:text-[#DAB9FF]">
                          {guidance.stageLabel}
                        </span>
                      </div>
                    </div>

                    {/* 2-Col Telemetry Strip: ODP/FAT Distribution + Crystal Aqua-Violet / Dark Inset OPM LIVE LCD */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-2.5 flex flex-col justify-between">
                        <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A79BC0]">
                          ODP / FAT Distribution
                        </span>
                        <span className="font-mono font-extrabold text-xs text-[#26364A] dark:text-[#f5eeff] truncate mt-1">
                          {ticket.fatCode || ticket.fdtCode || 'FAT -'}
                        </span>
                        <span className="font-mono text-[10.5px] font-semibold text-[#5145A6] dark:text-[#DAB9FF] mt-0.5 truncate">
                          {ticket.fatPort ? `Port ${ticket.fatPort}` : workTypeLabel}
                        </span>
                      </div>

                      <div className="rounded-xl bg-gradient-to-br from-[#F0EDFF] via-[#F8FAFD] to-[#DDF4F4] dark:bg-none dark:bg-[#160D29] border border-[#BDE4E8] dark:border-[#35105E] p-2.5 text-[#26364A] dark:text-white flex flex-col justify-between shadow-inner">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[9.5px] font-mono font-bold uppercase tracking-wider text-[#2E7D8B] dark:text-[#DAB9FF] flex items-center gap-1">
                            <Gauge className="w-3 h-3" />
                            <span>OPM LIVE</span>
                          </span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-extrabold ${
                              !hasValidOpm
                                ? 'bg-[#EAE8FF] text-[#5145A6] dark:bg-white/15 dark:text-[#EEDBFF]'
                                : isOpmPass
                                ? 'bg-[#E4F5EC] text-[#218A63] dark:bg-emerald-500/25 dark:text-emerald-300'
                                : 'bg-[#FCE9EB] text-[#9B2C37] dark:bg-rose-500/30 dark:text-rose-200'
                            }`}
                          >
                            {!hasValidOpm ? 'WAIT' : isOpmPass ? 'PASS' : 'ALERT'}
                          </span>
                        </div>
                        <div className="font-mono font-extrabold text-base text-[#26364A] dark:text-white tabular-nums mt-0.5">
                          {hasValidOpm ? `${opmNum.toFixed(1)} dBm` : '— dBm'}
                        </div>
                        <span className="font-mono text-[9.5px] text-[#52647A] dark:text-white/60">
                          SOP: -15 s/d -24 dBm
                        </span>
                      </div>
                    </div>

                    {/* Primary & Secondary 3D CTAs */}
                    <div className="space-y-2 pt-0.5">
                      {!ticket.checkInAt ? (
                        <button
                          type="button"
                          onClick={e => handleTriggerCheckIn(e, ticket)}
                          className="mj-btn-installer-primary w-full px-4 py-2 text-xs font-bold gap-1.5 cursor-pointer"
                        >
                          <Camera className="w-4 h-4" />
                          <span>CHECK-IN LOKASI GPS</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            handleOpenFullview(ticket, guidance.section);
                          }}
                          className="mj-btn-installer-primary w-full px-4 py-2 text-xs font-bold gap-1.5 cursor-pointer"
                        >
                          <span>{guidance.buttonLabel}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleOpenFullview(ticket);
                        }}
                        className="mj-btn-installer-secondary w-full px-3.5 py-2 text-xs font-bold gap-1.5 cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Buka Detail Tiket (Fullview)</span>
                      </button>

                      {/* 3-col Ergonomic Macro Row */}
                      <div className="grid grid-cols-3 gap-1.5 pt-0.5">
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
                          className="mj-btn-installer-neutral mj-btn-compact px-2 text-[11px] font-bold gap-1 cursor-pointer"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          <span>Maps</span>
                        </button>

                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            handleOpenChat(ticket);
                          }}
                          className="relative mj-btn-installer-neutral mj-btn-compact px-2 text-[11px] font-bold gap-1 cursor-pointer"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                          <span>LiveChat</span>
                          {unread > 0 && (
                            <span className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#D45B66] dark:bg-[#ba1a1a] text-white text-[9px] font-bold flex items-center justify-center">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation();
                            setKendalaTicket(ticket);
                          }}
                          className="mj-btn-installer-danger mj-btn-compact px-2 text-[11px] font-bold gap-1 cursor-pointer"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Kendala</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            }

            /* -------------------------------------------------------- */
            /* CARD VARIANT A: TUGAS BARU                               */
            /* -------------------------------------------------------- */
            return (
              <article
                key={ticket.id}
                onClick={() => handleOpenFullview(ticket)}
                className="card-3d-lavender rounded-2xl overflow-hidden hover:border-[#65B8C4] dark:hover:border-[#A380FE] transition-colors cursor-pointer"
              >
                <div className="h-1.5 w-full bg-gradient-to-r from-[#D4933E] to-[#E9B568] dark:from-[#D97706] dark:to-[#F59E0B]" />
                <div className="p-4 space-y-2.5">
                  {/* 1. WO Number & 2. Status WO */}
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#DDE6F0] dark:border-[#35105E]">
                    <span className="font-mono text-xs font-extrabold text-[#5145A6] dark:text-[#DAB9FF] tracking-tight">
                      {ticket.woNumber}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <StatusInstallerBadge status={ticket.statusWOInstaller || 'Assigned'} displayRole="installer" />
                    </div>
                  </div>

                  {/* 3. Customer Info Inset Well */}
                  <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] p-2.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-[15px] font-extrabold text-[#26364A] dark:text-[#f5eeff] leading-snug truncate">
                        {ticket.customerName}
                      </h3>
                      {ticket.customerPhone && (
                        <span className="font-mono text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF] shrink-0">
                          {ticket.customerPhone}
                        </span>
                      )}
                    </div>
                    <div className="flex items-start gap-1.5 text-xs text-[#52647A] dark:text-[#C4B5D6]">
                      <MapPin className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#A380FE] shrink-0 mt-0.5" />
                      <span className="whitespace-normal break-words leading-snug">{addressDisplay}</span>
                    </div>
                  </div>

                  {/* 5. Appointment Date & 6. Work Type / Category */}
                  <div className="grid grid-cols-2 gap-2 bg-[#F8FAFD] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl px-3 py-2 text-[11px]">
                    <div className="min-w-0">
                      <span className="text-[#8492A5] dark:text-[#A79BC0] flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-[#2E7D8B] dark:text-[#A380FE]" />
                        <span>Appointment</span>
                      </span>
                      <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] block truncate mt-0.5">
                        {appDateDisplay}{ticket.slotTime ? ` · ${ticket.slotTime}` : ''}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-[#8492A5] dark:text-[#A79BC0] flex items-center gap-1">
                        <Wrench className="w-3 h-3 text-[#5145A6] dark:text-[#A380FE]" />
                        <span>Work Type</span>
                      </span>
                      <span className="font-semibold text-[#26364A] dark:text-[#f5eeff] block truncate mt-0.5">
                        {workTypeLabel}
                      </span>
                    </div>
                  </div>

                  {/* 7. Informasi Teknis Relevan */}
                  <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-[#52647A] dark:text-[#C4B5D6] flex-wrap">
                    <span>
                      {ticket.fdtCode || 'FDT -'} · FAT {ticket.fatCode || '-'}
                      {ticket.fatPort ? ` / P${ticket.fatPort}` : ''}
                    </span>
                    <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
                  </div>

                  {/* 8. Action Footer: Quick Maps/WA/Detail + Primary CHECK-IN */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#35105E]">
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
                        aria-label="Hubungi Pelanggan via WhatsApp"
                        className="mj-btn-icon-3d-wa w-10 h-10 cursor-pointer"
                      >
                        <Phone className="w-4 h-4" />
                      </button>

                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          handleOpenFullview(ticket);
                        }}
                        className="mj-btn-installer-neutral mj-btn-compact px-2.5 text-[11px] font-bold cursor-pointer"
                      >
                        Detail WO
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={e => handleTriggerCheckIn(e, ticket)}
                      className="mj-btn-installer-primary mj-btn-compact px-3.5 py-2 text-xs font-bold gap-1.5 cursor-pointer shrink-0"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Check-in &amp; Mulai</span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ============================================================ */}
      {/* SOP KESELAMATAN KERJA (K3) REMINDER BANNER                   */}
      {/* ============================================================ */}
      <section className="rounded-2xl bg-[#F8FAFD] dark:bg-[#1E1238] border border-[#DCE3F2] dark:border-[#35105E] px-4 py-3 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#65B8C4] to-[#6657C8] dark:bg-none dark:bg-[#2D115B] text-white dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h4 className="font-display text-xs font-extrabold uppercase tracking-wider text-[#26364A] dark:text-[#f5eeff]">
            SOP Keselamatan Kerja (K3)
          </h4>
          <p className="text-[11.5px] text-[#52647A] dark:text-[#C4B5D6] leading-snug mt-0.5">
            Gunakan helm pelindung, safety belt saat memanjat tiang, serta sarung tangan isolasi sebelum terminasi kabel optik FAT/ODP.
          </p>
        </div>
      </section>

      {/* Kendala / Reschedule Escalation Modal with Mandatory Photo & Session Draft */}
      <KendalaReportModal
        isOpen={Boolean(kendalaTicket)}
        ticket={kendalaTicket}
        onClose={() => setKendalaTicket(null)}
      />

      {/* Quick LiveChat Modal */}
      <ResponsiveModal
        isOpen={Boolean(chatModalTicket)}
        onClose={() => setChatModalTicket(null)}
        size="md"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<MessageSquare className="w-4 h-4" />}
        title={chatModalTicket ? `Live Chat: ${chatModalTicket.woNumber}` : 'Live Chat'}
        subtitle={
          chatModalTicket
            ? `Pelanggan: ${chatModalTicket.customerName} (${chatModalTicket.area || '-'})`
            : undefined
        }
        footer={
          <div className="w-full flex items-center justify-between gap-3 text-xs text-[#8492A5] dark:text-[#A79BC0]">
            <span>Koordinasi cepat dengan Dispatch &amp; Leader</span>
            <button
              type="button"
              onClick={() => setChatModalTicket(null)}
              className="mj-btn-installer-neutral mj-btn-compact px-4 py-1.5 text-xs font-bold cursor-pointer"
            >
              Tutup Chat
            </button>
          </div>
        }
      >
        {chatModalTicket && (
          <TicketLiveChat ticket={chatModalTicket} initialCategory={chatInitialCategory} />
        )}
      </ResponsiveModal>

      {/* Camera GPS Check-In Modal */}
      {checkInCameraTicket && (
        <GeoTagCameraCheckInModal
          isOpen={Boolean(checkInCameraTicket)}
          onClose={() => setCheckInCameraTicket(null)}
          ticket={checkInCameraTicket}
          onCheckInSuccess={() => {
            setCheckInCameraTicket(null);
            setActiveKpiDrilldown(null);
            setActiveBucket('dalam_proses');
            refreshKpiSummary();
          }}
        />
      )}
    </div>
  );
};
