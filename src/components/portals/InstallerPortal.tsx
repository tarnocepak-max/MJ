import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { Ticket, TicketStatusWOInstaller } from '../../types/index.ts';
import { StatusInstallerBadge, StatusWhatsAppBadge, StatusApprovalBadge, StatusBadge } from '../common/Badge';
import { TicketLiveChat } from '../chat/TicketLiveChat';
import { TechnicalReportForm } from '../tickets/TechnicalReportForm';
import { InstallerTicketFullview } from './InstallerTicketFullview';
import { TactileAlertBanner } from '../common/TactileAlertBanner';
import { TactileConfirmModal, EscalationReasonOption } from '../common/TactileConfirmModal';
import { ResponsiveModal } from '../common/ResponsiveModal';
import {
  matchesKpiFilter,
  KPI_FILTER_LABELS,
  isTicketClosed,
  getTicketCanonicalApprovalStatus,
  getTicketCanonicalReportStatus
} from '../../services/woLifecycleService';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { openCustomerAddressInGoogleMaps, openCoordinatesInGoogleMaps, isValidCoordinatePair } from '../../services/mapsService';
import { formatJakartaTimeOnly } from '../../services/workSessionService';
import {
  Wrench,
  Phone,
  MessageSquare,
  MapPin,
  CheckCircle2,
  Navigation,
  FileText,
  AlertTriangle,
  Clock,
  Wifi,
  Camera,
  Search,
  Check,
  X,
  AlertCircle,
  Router,
  RefreshCw,
  WifiOff,
  Package,
  ShieldAlert,
  SlidersHorizontal,
  ArrowUpDown,
  Ticket as TicketIcon
} from 'lucide-react';

export type StatusFilterCategory = 'all' | 'pending' | 'butuh_approval' | 'revision' | 'done' | 'reschedule' | 'cancel';

interface InstallerPortalProps {
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp: (ticket: Ticket) => void;
  initialFilter?: StatusFilterCategory;
}

const KENDALA_ESCALATION_OPTIONS: EscalationReasonOption[] = [
  {
    id: 'port_odp_full',
    label: 'Port FAT / ODP Penuh atau Tidak Ada Signal',
    description: 'Memerlukan relokasi FAT atau penambahan splitter oleh tim jaringan.',
    targetInstallerStatus: 'Pending Technical'
  },
  {
    id: 'customer_reschedule',
    label: 'Pelanggan Tidak di Tempat / Minta Reschedule',
    description: 'Pelanggan menunda jadwal pemasangan ke sesi atau hari berikutnya.',
    targetInstallerStatus: 'Pending Technical',
    isReschedule: true
  },
  {
    id: 'route_permit',
    label: 'Hambatan Izin Jalur / Penarikan Dropcore',
    description: 'Terdapat kendala akses tiang, pengelola cluster, atau jalur rumah.',
    targetInstallerStatus: 'Pending Technical'
  },
  {
    id: 'hardware_or_cancel',
    label: 'Pelanggan Membatalkan / Gagal Instalasi',
    description: 'Order dibatalkan di lokasi atau kondisi lokasi tidak memungkinkan.',
    targetInstallerStatus: 'Failed / Cancelled'
  }
];

function parseNumericDbm(raw?: string | number | null): number | null {
  if (raw === undefined || raw === null) return null;
  const cleaned = String(raw).replace(/[^\d.-]/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Categorizes a ticket into one of the four operational buckets:
 * - Done (Selesai)
 * - Pending (Menunggu / Dalam Proses)
 * - Reschedule (Jadwal Ulang)
 * - Cancel (Dibatalkan)
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

export const InstallerPortal: React.FC<InstallerPortalProps> = ({
  onOpenWhatsApp,
  initialFilter = 'all'
}) => {
  const {
    tickets,
    updateTicketStatus,
    sendTicketMessage,
    currentUser,
    users,
    todayWIB,
    activeKpiDrilldown,
    setActiveKpiDrilldown,
    getTicketUnreadCount,
    setTicketChatCategory
  } = useApp();
  const { toast } = useToast();
  const { isOnline, pendingCount, syncNow, isSyncing, setIsOfflineModalOpen } = useOfflineSync();

  const myInstallers = users.filter(u => u.role === 'installer');
  const [selectedInstallerName, setSelectedInstallerName] = useState<string>(
    currentUser.role === 'installer' ? currentUser.name : (myInstallers[0]?.name || 'Andi Saputra')
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

  const myTickets = useMemo(() => {
    const isHistoryView = initialFilter === 'done';
    if (currentUser.role === 'installer') {
      const myId = currentUser.id || '';
      const myUsername = (currentUser.username || '').toLowerCase().trim();
      const myName = (currentUser.name || '').toLowerCase().trim();

      return tickets.filter(t => {
        if (t.isArchived || t.isDeleted) return false;
        if (!t.installerName && !t.assignedTo) return false;
        if (!isHistoryView && getTicketAppointmentDate(t) !== todayWIB) return false;

        if (myId && t.assignedTo === myId) return true;
        if (myUsername && (t.assignedTo === myUsername || (t.assignedTo && t.assignedTo.toLowerCase() === myUsername))) return true;

        if (myName && isInstallerMatch(t.installerName, myName)) return true;
        if (myUsername && isInstallerMatch(t.installerName, myUsername)) return true;

        return false;
      });
    }

    return tickets.filter(
      t =>
        !t.isArchived &&
        !t.isDeleted &&
        (isHistoryView || getTicketAppointmentDate(t) === todayWIB) &&
        Boolean(t.installerName) &&
        isInstallerMatch(t.installerName, effectiveInstallerName)
    );
  }, [tickets, currentUser, effectiveInstallerName, todayWIB, initialFilter]);

  const [statusFilter, setStatusFilter] = useState<StatusFilterCategory>(initialFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'slot' | 'status' | 'wo'>('slot');
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Record<string, boolean>>({});
  const [materialStripDismissed, setMaterialStripDismissed] = useState(false);

  React.useEffect(() => {
    if (initialFilter) {
      setStatusFilter(initialFilter);
    }
  }, [initialFilter]);

  React.useEffect(() => {
    if (activeKpiDrilldown) {
      setStatusFilter('all');
    }
  }, [activeKpiDrilldown]);

  const [fullviewTicket, setFullviewTicket] = useState<Ticket | null>(null);
  const [detailTicket, setDetailTicket] = useState<Ticket | null>(null);
  const [detailModalTab, setDetailModalTab] = useState<'details' | 'chat'>('details');
  const [chatInitialCategory, setChatInitialCategory] = useState<string | undefined>(undefined);
  const [chatModalTicket, setChatModalTicket] = useState<Ticket | null>(null);

  // Level-3 Escalation / Kendala Modal state
  const [kendalaTicket, setKendalaTicket] = useState<Ticket | null>(null);
  const [isSubmittingKendala, setIsSubmittingKendala] = useState(false);

  const counts = useMemo(() => {
    let done = 0;
    let pending = 0;
    let butuh_approval = 0;
    let revision = 0;
    let reschedule = 0;
    let cancel = 0;

    myTickets.forEach(t => {
      const appStat = getTicketCanonicalApprovalStatus(t);
      if (appStat === 'BUTUH APPROVAL') butuh_approval++;
      else if (appStat === 'REVISION') revision++;
      const cat = classifyInstallerStatus(t);
      if (cat === 'done') done++;
      else if (cat === 'pending') pending++;
      else if (cat === 'reschedule') reschedule++;
      else if (cat === 'cancel') cancel++;
    });

    return {
      all: myTickets.length,
      done,
      pending,
      butuh_approval,
      revision,
      reschedule,
      cancel
    };
  }, [myTickets]);

  const filteredTickets = useMemo(() => {
    const matched = myTickets.filter(t => {
      if (activeKpiDrilldown && !matchesKpiFilter(t, activeKpiDrilldown.filterKey)) {
        return false;
      }

      if (statusFilter === 'butuh_approval') {
        if (getTicketCanonicalApprovalStatus(t) !== 'BUTUH APPROVAL') return false;
      } else if (statusFilter === 'revision') {
        if (getTicketCanonicalApprovalStatus(t) !== 'REVISION') return false;
      } else if (statusFilter !== 'all') {
        const cat = classifyInstallerStatus(t);
        if (cat !== statusFilter) return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchWO = String(t.woNumber ?? '').toLowerCase().includes(query);
        const matchCust = String(t.customerName ?? '').toLowerCase().includes(query);
        const matchCustId = String(t.idCustomer || t.customerId || '').toLowerCase().includes(query);
        const matchPhone = String(t.customerPhone ?? '').includes(query);
        const matchAddr = String(t.streetName ?? '').toLowerCase().includes(query);
        const matchCluster = String(t.clusterName ?? '').toLowerCase().includes(query);
        const matchArea = String(t.area ?? '').toLowerCase().includes(query);
        return matchWO || matchCust || matchCustId || matchPhone || matchAddr || matchCluster || matchArea;
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
      return String(a.slotTime || '').localeCompare(String(b.slotTime || ''));
    });
  }, [myTickets, statusFilter, searchQuery, activeKpiDrilldown, sortBy]);

  // Real operational alerts derived from live assigned Work Orders (no dummy values)
  const criticalRevisionTicket = useMemo(
    () => myTickets.find(t => !isTicketClosed(t) && getTicketCanonicalApprovalStatus(t) === 'REVISION'),
    [myTickets]
  );

  const highAttenuationTicket = useMemo(() => {
    return myTickets.find(t => {
      if (isTicketClosed(t)) return false;
      const val = parseNumericDbm(t.technicalReport?.opticalPowerDbm || t.rosetRedamanDbm);
      return val !== null && val < -24;
    });
  }, [myTickets]);

  const missingCheckInTicket = useMemo(() => {
    return myTickets.find(
      t =>
        !isTicketClosed(t) &&
        Boolean(t.workStartedAt || t.statusWOInstaller === 'En Route' || t.statusWOInstaller === 'On Site') &&
        !t.checkInAt
    );
  }, [myTickets]);

  // Primary active WO for Material Terpakai contextual bar
  const primaryActiveWo = useMemo(() => {
    return (
      filteredTickets.find(t => !isTicketClosed(t) && (t.workStartedAt || t.checkInAt)) ||
      filteredTickets.find(t => !isTicketClosed(t)) ||
      null
    );
  }, [filteredTickets]);

  const handleQuickStatus = (ticketId: string, status: TicketStatusWOInstaller, remark: string) => {
    updateTicketStatus(ticketId, undefined, status, remark);
    if (detailTicket && detailTicket.id === ticketId) {
      setDetailTicket(prev => (prev ? { ...prev, statusWOInstaller: status } : null));
    }
  };

  const handleOpenTicket = (ticket: Ticket) => {
    setFullviewTicket(ticket);
  };

  const handleOpenChat = (ticket: Ticket, category?: string) => {
    setChatInitialCategory(category);
    if (category) {
      setTicketChatCategory(ticket.id, category);
    }
    setChatModalTicket(ticket);
  };

  const handleConfirmKendala = async ({
    selectedReason,
    notes
  }: {
    selectedReason?: EscalationReasonOption;
    notes: string;
  }) => {
    if (!kendalaTicket || !selectedReason) return;
    setIsSubmittingKendala(true);
    try {
      const targetStatus: TicketStatusWOInstaller =
        selectedReason.targetInstallerStatus || 'Pending Technical';
      const prefix = selectedReason.isReschedule ? 'RESCHEDULE' : 'KENDALA LAPANGAN';
      const remarkText = `[${prefix}: ${selectedReason.label}] ${notes}`;

      updateTicketStatus(
        kendalaTicket.id,
        targetStatus === 'Failed / Cancelled' ? 'Cancelled' : undefined,
        targetStatus,
        remarkText
      );

      await sendTicketMessage(
        kendalaTicket.id,
        `${prefix} — ${selectedReason.label}. Catatan: ${notes}`,
        [],
        'ISSUE'
      );

      toast.warning(
        `Kendala WO ${kendalaTicket.woNumber} dilaporkan ke Dispatch & tercatat di LiveChat (#ISSUE).`,
        'Kendala Dilaporkan',
        { withSound: true }
      );
      setKendalaTicket(null);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal mengirim laporan kendala.', 'Gagal');
    } finally {
      setIsSubmittingKendala(false);
    }
  };

  if (fullviewTicket) {
    return (
      <InstallerTicketFullview
        ticket={fullviewTicket}
        onBack={() => setFullviewTicket(null)}
        onOpenWhatsApp={onOpenWhatsApp}
      />
    );
  }

  return (
    <div className="max-w-lg md:max-w-3xl lg:max-w-6xl mx-auto space-y-4 sm:space-y-5 pb-20 sm:pb-6">
      {/* ============================================================ */}
      {/* 1. REAL-TIME OPERATIONAL ALERTS & CONNECTIVITY SNACKBAR      */}
      {/* ============================================================ */}
      {(highAttenuationTicket && !dismissedAlertIds[`opm_${highAttenuationTicket.id}`]) && (
        <TactileAlertBanner
          variant="critical"
          badge="PERINGATAN REDAMAN TINGGI"
          metricBadge={`${highAttenuationTicket.technicalReport?.opticalPowerDbm || highAttenuationTicket.rosetRedamanDbm} (${highAttenuationTicket.fatCode || highAttenuationTicket.woNumber})`}
          title={`Redaman melebihi batas toleransi FTTH (-24 dBm) pada ${highAttenuationTicket.woNumber}`}
          description={`Pelanggan ${highAttenuationTicket.customerName}. Cek tekukan kabel dropcore dan kebersihan konektor/ferrule sebelum finalisasi.`}
          primaryAction={{
            label: 'Perbaiki Jalur',
            icon: <Wrench className="w-3.5 h-3.5" />,
            onClick: () => handleOpenTicket(highAttenuationTicket)
          }}
          secondaryAction={{
            label: 'Abaikan',
            onClick: () =>
              setDismissedAlertIds(prev => ({
                ...prev,
                [`opm_${highAttenuationTicket.id}`]: true
              }))
          }}
          onDismiss={() =>
            setDismissedAlertIds(prev => ({
              ...prev,
              [`opm_${highAttenuationTicket.id}`]: true
            }))
          }
        />
      )}

      {(criticalRevisionTicket && !dismissedAlertIds[`rev_${criticalRevisionTicket.id}`]) && (
        <TactileAlertBanner
          variant="critical"
          badge="REVISI DISPATCH"
          metricBadge={criticalRevisionTicket.woNumber}
          title={`Laporan ${criticalRevisionTicket.customerName} perlu revisi dari Dispatch`}
          description={
            criticalRevisionTicket.rejectionReason ||
            criticalRevisionTicket.progressReports?.[0]?.revisionReason ||
            'Silakan periksa catatan Dispatch dan kirim ulang versi revisi laporan.'
          }
          primaryAction={{
            label: 'Perbaiki & Kirim Revisi',
            icon: <FileText className="w-3.5 h-3.5" />,
            onClick: () => handleOpenTicket(criticalRevisionTicket)
          }}
          onDismiss={() =>
            setDismissedAlertIds(prev => ({
              ...prev,
              [`rev_${criticalRevisionTicket.id}`]: true
            }))
          }
        />
      )}

      {(missingCheckInTicket && !dismissedAlertIds[`checkin_${missingCheckInTicket.id}`]) && (
        <TactileAlertBanner
          variant="warning"
          badge="CHECK-IN #PROGRESS DIPERLUKAN"
          metricBadge={missingCheckInTicket.woNumber}
          title={`Pekerjaan ${missingCheckInTicket.customerName} belum mencatat Check-in LiveChat`}
          description="Kirim minimal 1 pesan LiveChat dengan kategori #PROGRESS agar tombol submit laporan & QC terbuka sesuai SOP."
          primaryAction={{
            label: 'Kirim #PROGRESS Sekarang',
            icon: <MessageSquare className="w-3.5 h-3.5" />,
            onClick: () => handleOpenChat(missingCheckInTicket, 'PROGRESS')
          }}
          onDismiss={() =>
            setDismissedAlertIds(prev => ({
              ...prev,
              [`checkin_${missingCheckInTicket.id}`]: true
            }))
          }
        />
      )}

      {/* Real Connectivity / Pending Sync Tactile Bar */}
      {(!isOnline || pendingCount > 0) && (
        <div className="rounded-2xl bg-[#F3EAFF] dark:bg-[#1E1238] border border-[#DAB9FF] dark:border-[#7135B5]/50 px-3.5 py-2.5 flex items-center justify-between gap-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_2px_0_#CEC3D4] dark:shadow-none text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              {!isOnline ? (
                <WifiOff className="w-4 h-4 text-amber-600 animate-pulse" />
              ) : (
                <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              )}
            </div>
            <span className="font-semibold text-[#1F1638] dark:text-white truncate">
              {!isOnline
                ? `Mode Offline Aktif (${pendingCount} log tersimpan lokal)`
                : `Tersambung Ulang: ${pendingCount} antrean telemetry siap disinkronkan`}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isOnline && pendingCount > 0 && (
              <button
                type="button"
                onClick={() => syncNow()}
                disabled={isSyncing}
                className="tactile-pill-btn px-3 py-1 rounded-lg bg-white dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] font-bold border border-[#E8DDFF] dark:border-[#7135B5] cursor-pointer"
              >
                {isSyncing ? 'Sync...' : 'Sync'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOfflineModalOpen(true)}
              className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-[#58149C] dark:text-[#DAB9FF] hover:bg-white/60 dark:hover:bg-white/10 cursor-pointer"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 2. TOP HEADER & SEARCH/FILTER WORKSPACE (STITCH PURPLE OPS)  */}
      {/* ============================================================ */}
      <div className="mj-stitch-card rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#7e3cb8] to-[#5b2299] text-white flex items-center justify-center shrink-0 shadow-md shadow-purple-900/20">
              <Wrench className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[17px] sm:text-[18px] font-bold text-[#1f1638] dark:text-white tracking-tight">
                  Daftar Work Order
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-purple-50 dark:bg-[#35105E] text-[#7135b5] dark:text-[#DAB9FF] border border-purple-200/80 dark:border-[#7135b5]/40">
                  {effectiveInstallerName}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${
                    isOnline
                      ? 'bg-[#dcfce7] border-emerald-200 text-[#059669] dark:bg-emerald-950/60 dark:border-emerald-700/60 dark:text-emerald-300'
                      : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/60 dark:border-amber-700/60 dark:text-amber-300'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                  <span>{isOnline ? 'Online Sync' : 'Offline Cache'}</span>
                </span>
              </div>
              <p className="text-[11.5px] text-slate-500 dark:text-[#CEC0E8] mt-0.5">
                Jadwal {todayWIB} • {counts.pending} Aktif • {counts.revision + counts.butuh_approval} Perlu Tindak Lanjut
              </p>
            </div>
          </div>

          {currentUser.role !== 'installer' && (
            <div className="flex items-center gap-2 bg-[#fcf8ff] dark:bg-[#160D29] p-2 rounded-xl border border-purple-200/80 dark:border-[#35105E]">
              <span className="text-xs font-semibold text-slate-600 dark:text-[#CEC0E8] whitespace-nowrap">
                Teknisi:
              </span>
              <select
                value={selectedInstallerName}
                onChange={e => setSelectedInstallerName(e.target.value)}
                className="px-2.5 py-1.5 text-xs bg-white dark:bg-[#22123F] rounded-lg font-semibold text-[#1f1638] dark:text-white border border-purple-200 dark:border-[#4b386b] focus:outline-none focus:ring-2 focus:ring-[#7135b5]"
              >
                {myInstallers.map(inst => (
                  <option key={inst.id} value={inst.name}>
                    {inst.name} ({inst.contractor || 'Mitra'})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Horizontal Segmented Filter Chips */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5 text-xs">
          <button
            type="button"
            onClick={() => {
              setActiveKpiDrilldown(null);
              setStatusFilter('all');
            }}
            className={`min-h-[38px] px-3 py-1.5 rounded-full font-bold transition-all cursor-pointer shrink-0 inline-flex items-center gap-1.5 ${
              statusFilter === 'all' && !activeKpiDrilldown
                ? 'bg-[#18152e] dark:bg-[#7135b5] text-white shadow-xs'
                : 'bg-[#f6f0ff] text-[#1f1638] hover:bg-purple-100 dark:bg-[#160D29] dark:text-[#CEC0E8]'
            }`}
          >
            <span>Semua</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${statusFilter === 'all' && !activeKpiDrilldown ? 'bg-white/20 text-white' : 'bg-white dark:bg-black/25'}`}>
              {counts.all}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveKpiDrilldown(null);
              setStatusFilter('pending');
            }}
            className={`min-h-[38px] px-3 py-1.5 rounded-full font-bold transition-all cursor-pointer shrink-0 inline-flex items-center gap-1.5 ${
              statusFilter === 'pending'
                ? 'bg-[#7135b5] text-white shadow-[0_2px_0_#4a1584]'
                : 'bg-purple-50 text-[#7135b5] hover:bg-purple-100 border border-purple-200/70 dark:bg-[#261942] dark:border-[#4B386B] dark:text-[#DAB9FF]'
            }`}
          >
            <span>Aktif</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${statusFilter === 'pending' ? 'bg-white/20 text-white' : 'bg-white dark:bg-black/25'}`}>
              {counts.pending}
            </span>
          </button>

          {counts.revision > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrilldown(null);
                setStatusFilter('revision');
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-full font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                statusFilter === 'revision'
                  ? 'bg-[#b91c1c] text-white shadow-xs'
                  : 'bg-[#fee2e2] text-[#b91c1c] hover:bg-[#fecaca] dark:bg-rose-950/80 dark:text-rose-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              <span>Revisi</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums bg-white/60 dark:bg-black/25">
                {counts.revision}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setActiveKpiDrilldown(null);
              setStatusFilter('butuh_approval');
            }}
            className={`min-h-[38px] px-3 py-1.5 rounded-full font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
              statusFilter === 'butuh_approval'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100 dark:bg-amber-950/70 dark:border-amber-700/60 dark:text-amber-200'
            }`}
          >
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Butuh Approval ({counts.butuh_approval})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveKpiDrilldown(null);
              setStatusFilter('done');
            }}
            className={`min-h-[38px] px-3 py-1.5 rounded-full font-bold transition-all cursor-pointer shrink-0 ${
              statusFilter === 'done'
                ? 'bg-[#00a884] text-white shadow-xs'
                : 'bg-[#dcfce7] text-[#059669] hover:bg-emerald-100 border border-emerald-200 dark:bg-emerald-950/60 dark:border-emerald-700/60 dark:text-emerald-300'
            }`}
          >
            Selesai ({counts.done})
          </button>

          {counts.reschedule > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrilldown(null);
                setStatusFilter('reschedule');
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-full font-bold transition-all cursor-pointer shrink-0 ${
                statusFilter === 'reschedule'
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-950/60 dark:text-blue-300'
              }`}
            >
              Reschedule ({counts.reschedule})
            </button>
          )}

          {counts.cancel > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrilldown(null);
                setStatusFilter('cancel');
              }}
              className={`min-h-[38px] px-3 py-1.5 rounded-full font-bold transition-all cursor-pointer shrink-0 ${
                statusFilter === 'cancel'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300'
              }`}
            >
              Cancel ({counts.cancel})
            </button>
          )}
        </div>

        {/* Search & Sort Controls */}
        <div className="pt-2 border-t border-purple-100/80 dark:border-[#35105E] flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari no. WO, pelanggan, cluster, telepon..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full min-h-[44px] pl-10 pr-9 py-2 bg-[#fcf8ff] dark:bg-[#160D29] border border-purple-100 dark:border-[#35105E] rounded-full text-xs text-[#1f1638] dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7135b5]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#1f1638] dark:hover:text-white cursor-pointer"
                aria-label="Hapus pencarian"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 bg-[#fcf8ff] dark:bg-[#160D29] px-2.5 min-h-[44px] rounded-xl border border-purple-100 dark:border-[#35105E] shrink-0">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#7135b5] dark:text-[#DAB9FF]" />
            <select
              aria-label="Urutkan Tugas"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as 'slot' | 'status' | 'wo')}
              className="bg-transparent text-xs font-bold text-[#1f1638] dark:text-white focus:outline-none cursor-pointer"
            >
              <option value="slot">Slot Waktu</option>
              <option value="status">Status</option>
              <option value="wo">No. WO</option>
            </select>
          </div>
        </div>
      </div>

      {/* Active KPI Drilldown Banner */}
      {activeKpiDrilldown && (
        <div className="bg-[#160D29] text-white rounded-2xl border border-[#7135B5]/60 px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-2.5 text-xs">
            <span className="px-2 py-0.5 rounded-md bg-[#7135B5] font-bold uppercase tracking-wider text-[10px]">
              KPI Drilldown
            </span>
            <span className="font-semibold text-[#F5EEFF]">
              Filter KPI Aktif: <strong className="text-[#DAB9FF]">{KPI_FILTER_LABELS[activeKpiDrilldown.filterKey]}</strong> ({filteredTickets.length} WO)
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setActiveKpiDrilldown(null);
              setStatusFilter('all');
            }}
            className="min-h-[38px] px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            <span>Reset Filter KPI</span>
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* 3. WORK ORDER HERO CARDS (STITCH TACTILE BEVELED WORKSTATION)*/}
      {/* ============================================================ */}
      {filteredTickets.length === 0 ? (
        <div className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-10 sm:p-12 text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center">
            <Wrench className="w-7 h-7" />
          </div>
          <h4 className="font-display text-base font-bold text-[#1F1638] dark:text-white">
            Tidak Ada Work Order yang Sesuai
          </h4>
          <p className="text-xs text-[#7D7484] dark:text-[#CEC0E8] max-w-md mx-auto leading-relaxed">
            {myTickets.length === 0
              ? `Belum ada tiket yang ditugaskan kepada teknisi ${effectiveInstallerName} untuk hari ini (${todayWIB}). Hubungi Koordinator Lapangan (Leader) untuk jadwal penugasan.`
              : `Tidak ditemukan tiket yang cocok dengan filter aktif atau kata kunci pencarian tersebut.`}
          </p>
          {(statusFilter !== 'all' || searchQuery || activeKpiDrilldown) && (
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrilldown(null);
                setStatusFilter('all');
                setSearchQuery('');
              }}
              className="tactile-btn-secondary min-h-[42px] px-4 py-2 text-xs font-bold bg-[#F3EAFF] text-[#58149C] dark:bg-[#2A1647] dark:text-[#DAB9FF] rounded-xl border border-[#E8DDFF] dark:border-[#5B35B1] cursor-pointer"
            >
              Reset Filter &amp; Tampilkan Semua WO
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold text-slate-500 dark:text-[#E9D5FF] uppercase tracking-widest">
              Daftar Work Order ({filteredTickets.length} Tiket)
            </span>
            <span className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8] hidden sm:inline">
              Ketuk <strong>&ldquo;Buka Tiket&rdquo;</strong> untuk 3-Tier Checkout, Foto 6 Titik &amp; Validasi QC
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-start">
            {filteredTickets.map(ticket => {
              const ticketClosed = isTicketClosed(ticket);
              const canonicalApproval = getTicketCanonicalApprovalStatus(ticket);
              const canonicalReport = getTicketCanonicalReportStatus(ticket);
              const unread = getTicketUnreadCount(ticket.id);
              const revisionReason =
                ticket.rejectionReason ||
                ticket.progressReports?.[0]?.revisionReason ||
                ticket.progressReports?.[0]?.rejectionReason ||
                '';

              const rawOpm = ticket.technicalReport?.opticalPowerDbm || ticket.rosetRedamanDbm;
              const numericOpm = parseNumericDbm(rawOpm);
              const opmIsOutOfSpec = numericOpm !== null && numericOpm < -24;
              const opmDisplay =
                numericOpm !== null ? numericOpm.toFixed(1) : rawOpm ? String(rawOpm) : '—';

              const rawFatDbm = ticket.technicalReport?.fatRedamanDbm || ticket.fatRedamanDbm;
              const numericFat = parseNumericDbm(rawFatDbm);
              const ontSn = ticket.technicalReport?.deviceSerialNumber || ticket.ontSerialNumber || '';

              const isLiveJob =
                !ticketClosed &&
                (Boolean(ticket.workStartedAt) ||
                  ticket.statusWOInstaller === 'En Route' ||
                  ticket.statusWOInstaller === 'On Site' ||
                  ticket.statusWOInstaller === 'In Progress');

              const step1Done =
                Boolean(ticket.workStartedAt) ||
                (Boolean(ticket.statusWOInstaller) &&
                  ticket.statusWOInstaller !== 'Assigned' &&
                  ticket.statusWOInstaller !== 'Unassigned');
              const step2Done = Boolean(ticket.checkInAt);
              const step3Done =
                Boolean(ticket.checkOutAt) ||
                (ticket.progressReports && ticket.progressReports.length > 0) ||
                ticket.statusWOInstaller === 'Completed';

              const dropcoreInfo =
                ticket.technicalReport?.dropcoreLength ||
                ticket.dropcoreLength ||
                (ticket.dropcoreLengthMeter ? `${ticket.dropcoreLengthMeter}m` : '');

              const hasHouseGps = isValidCoordinatePair(
                ticket.houseLocation?.latitude,
                ticket.houseLocation?.longitude
              );
              const hasFatGps = isValidCoordinatePair(
                ticket.fatLocation?.latitude,
                ticket.fatLocation?.longitude
              );
              const photoCount =
                ticket.photoEvidenceCount ??
                (Array.isArray(ticket.technicalReport?.photoSlots)
                  ? ticket.technicalReport!.photoSlots.length
                  : Array.isArray(ticket.technicalReport?.photos)
                  ? ticket.technicalReport!.photos.length
                  : 0);

              return (
                <article
                  key={ticket.id}
                  className="bg-[#fcf8ff] dark:bg-[#1E1238] rounded-2xl border border-purple-100 dark:border-[#35105E] p-3.5 sm:p-4 shadow-tactile-card space-y-3.5 relative overflow-hidden transition-all"
                >
                  {/* 1. Compact Header Row: WO Number + Metadata + Status */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-purple-100 dark:border-[#35105E]">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-[#2E1459] border border-purple-200/80 dark:border-[#7135B5]/60 font-mono font-extrabold text-[12.5px] text-[#4a1584] dark:text-[#DAB9FF] tracking-tight">
                        {ticket.woNumber}
                      </span>
                      <span className="text-xs font-semibold text-slate-600 dark:text-[#E9D5FF] truncate">
                        • {ticket.ticketCategory || ticket.appointmentType || 'New Installation'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {isLiveJob && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 dark:bg-[#35105E] text-[#7135b5] dark:text-[#DAB9FF] border border-purple-200 dark:border-[#7135B5] text-[10px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#7135b5] dark:bg-[#DAB9FF] animate-pulse" />
                          <span>Live Job</span>
                        </span>
                      )}
                      {ticketClosed && <StatusBadge status="CLOSED" variant="wo_agent" />}
                      <StatusInstallerBadge status={ticket.statusWOInstaller} />
                      {canonicalReport !== 'NONE' && (
                        <StatusBadge status={canonicalReport} variant="report" />
                      )}
                      <StatusApprovalBadge status={ticket.approvalStatus} />
                    </div>
                  </div>

                  {/* Dispatch Revision Alert on Card */}
                  {canonicalApproval === 'REVISION' && (
                    <TactileAlertBanner
                      variant="critical"
                      badge="REVISI LAPORAN DIMINTA DISPATCH"
                      title="Perlu Perbaikan Laporan Segera"
                      description={
                        revisionReason ||
                        'Silakan perbaiki Report Status / data telemetry dan kirim ulang versi revisi.'
                      }
                      primaryAction={{
                        label: 'Perbaiki & Kirim Revisi',
                        icon: <FileText className="w-3.5 h-3.5" />,
                        onClick: () => handleOpenTicket(ticket)
                      }}
                    />
                  )}

                  {/* 2. STITCH CUSTOMER & WHATSAPP CONTACT CARD */}
                  <div className="bg-white dark:bg-[#160D29] rounded-2xl p-3.5 border border-purple-100/90 dark:border-[#35105E] shadow-[0_2px_10px_rgba(99,74,140,0.05)] space-y-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-[#2E1459] border border-purple-100 dark:border-[#7135B5]/50 text-[#7135b5] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                        <Router className="w-5 h-5" />
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-display font-bold text-[15.5px] text-slate-900 dark:text-white leading-tight truncate">
                            {ticket.customerName}
                          </h3>
                          {ticket.slotTime && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 dark:bg-[#241740] text-[#4a1584] dark:text-[#E9D5FF] border border-purple-100 dark:border-[#35105E] font-mono text-[10px] font-bold shrink-0">
                              <Clock className="w-3 h-3 text-[#7135b5] dark:text-[#DAB9FF]" />
                              {ticket.slotTime}
                            </span>
                          )}
                        </div>
                        <div className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-[#CEC0E8]">
                          <MapPin className="w-3.5 h-3.5 text-[#7135b5] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
                          <span className="line-clamp-2">
                            {ticket.clusterName ? `${ticket.clusterName} — ` : ''}
                            {ticket.streetName || ticket.area || 'Alamat belum terisi'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-mono font-semibold text-[#7135b5] dark:text-[#DAB9FF]">
                          <span>
                            {ticket.fdtCode || 'FDT -'} • FAT {ticket.fatCode || '-'}
                            {ticket.fatPort ? ` (Port ${ticket.fatPort})` : ''}
                          </span>
                          <span className="inline-flex items-center gap-1 text-slate-500 dark:text-[#CEC0E8]">
                            <Camera className="w-3 h-3 text-[#7135b5] dark:text-[#DAB9FF]" />
                            {photoCount}/6 Foto
                          </span>
                          {(hasHouseGps || hasFatGps) && (
                            <span className="text-emerald-600 dark:text-emerald-300 font-bold">
                              GPS {hasHouseGps && hasFatGps ? 'Rumah+FAT' : hasHouseGps ? 'Rumah' : 'FAT'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Stitch Phone + Vibrant WhatsApp CTA Row */}
                    <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-purple-50 dark:border-[#35105E]/80">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950/60 flex items-center justify-center text-[#059669] dark:text-emerald-300 shrink-0">
                          <Phone className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-mono text-[13.5px] font-bold tracking-tight text-slate-800 dark:text-white truncate">
                            {ticket.customerPhone || 'No. HP Kosong'}
                          </div>
                          <div className="mt-0.5">
                            <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!ticket.customerPhone}
                        onClick={() => onOpenWhatsApp(ticket)}
                        className="bg-[#00a884] hover:bg-[#008f6f] disabled:opacity-45 disabled:cursor-not-allowed text-white font-bold text-xs px-3.5 py-2 rounded-xl shadow-tactile-wa active:translate-y-0.5 transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5 fill-current" />
                        <span>WhatsApp</span>
                      </button>
                    </div>
                  </div>

                  {/* 3. STITCH DARK OPM LIVE TELEMETRY CONSOLE */}
                  <div className="rounded-2xl bg-[#18152e] border border-[#2d2752] p-4 text-white shadow-tactile-telemetry relative overflow-hidden">
                    <div className="absolute -right-10 -top-10 w-32 h-32 bg-purple-600/20 blur-2xl rounded-full pointer-events-none" />

                    <div className="relative z-10">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 text-purple-200/90 text-[11px] font-mono font-bold tracking-widest uppercase">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          <span>OPM LIVE TELEMETRY</span>
                        </div>
                        <span className="text-[11px] font-mono text-purple-300/75 tabular-nums">
                          REF: -24.00 DBM
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-purple-300/70 mb-3">
                        (1490NM)
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        {/* Left Well: Power Rx ONT */}
                        <div className="bg-[#242042] border border-[#3b3464] rounded-xl p-3 flex flex-col justify-between">
                          <span className="text-[11px] text-slate-300 font-medium">
                            Power Rx ONT
                          </span>
                          <div className="mt-1.5 flex items-baseline gap-1 font-mono tabular-nums">
                            <span
                              className={`text-[22px] sm:text-[24px] font-bold tracking-tight leading-none ${
                                numericOpm === null
                                  ? 'text-purple-200'
                                  : opmIsOutOfSpec
                                  ? 'text-rose-400'
                                  : 'text-white'
                              }`}
                            >
                              {opmDisplay}
                            </span>
                            {numericOpm !== null && (
                              <span className="text-xs font-medium text-slate-400">dBm</span>
                            )}
                          </div>
                          <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold">
                            {numericOpm === null ? (
                              <span className="text-amber-300">Menunggu pengukuran</span>
                            ) : opmIsOutOfSpec ? (
                              <span className="text-rose-400 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 shrink-0" />
                                <span>Redaman Tinggi (&lt;-24)</span>
                              </span>
                            ) : (
                              <span className="text-emerald-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                <span>Normal (Pass SOP)</span>
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right Well: Serial Number ONT & FAT Redaman */}
                        <div className="bg-[#242042] border border-[#3b3464] rounded-xl p-3 flex flex-col justify-between">
                          <span className="text-[11px] text-slate-300 font-medium">
                            Serial Number ONT
                          </span>
                          <div className="mt-1.5 flex items-baseline gap-1 font-mono tabular-nums min-w-0">
                            <span className="text-[18px] sm:text-[20px] font-bold text-white leading-none truncate">
                              {ontSn || (numericFat !== null ? `${numericFat.toFixed(1)} dBm` : '—')}
                            </span>
                          </div>
                          <div className="mt-2 text-[11px] font-medium truncate">
                            {numericFat !== null ? (
                              <span className="text-emerald-400 font-mono">
                                FAT {ticket.fatCode || '-'}: {numericFat.toFixed(1)} dBm
                              </span>
                            ) : ontSn ? (
                              <span className="text-emerald-400 flex items-center gap-1 truncate">
                                <CheckCircle2 className="w-3 h-3 shrink-0" />
                                <span>Terkunci ({ticket.fatCode || 'ONT'})</span>
                              </span>
                            ) : (
                              <span className="text-purple-200/75 truncate">
                                {ticket.ontBrand || 'Input saat Checkout'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 4. STITCH 3-STEP TAHAPAN INSTALASI */}
                  <div>
                    <h4 className="text-[11px] font-bold text-slate-500 dark:text-[#CEC0E8] tracking-widest uppercase mb-2 px-0.5">
                      TAHAPAN INSTALASI
                    </h4>
                    <div className="grid grid-cols-3 gap-2">
                      {/* Step 1: Mulai Kerja */}
                      <div className="bg-white dark:bg-[#241740] border border-purple-100 dark:border-[#3b3464] rounded-xl p-2.5 flex flex-col items-center text-center shadow-[0_2px_8px_rgba(113,53,181,0.04)]">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center mb-1.5 text-[11px] font-bold ${
                            step1Done
                              ? 'bg-emerald-500 text-white'
                              : 'bg-purple-100 dark:bg-[#35105E] text-[#7135b5] dark:text-[#DAB9FF]'
                          }`}
                        >
                          {step1Done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '1'}
                        </div>
                        <span className="text-[11.5px] font-bold text-slate-800 dark:text-white leading-tight truncate w-full">
                          1. Mulai Kerja
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-[#CEC0E8] mt-1 font-medium truncate w-full">
                          {ticket.workStartedAt
                            ? `Mulai ${formatJakartaTimeOnly(ticket.workStartedAt)}`
                            : dropcoreInfo
                            ? `Dropcore ${dropcoreInfo}`
                            : 'Siap Berangkat'}
                        </span>
                      </div>

                      {/* Step 2: Check-in #PROGRESS */}
                      <button
                        type="button"
                        onClick={() => handleOpenChat(ticket, 'PROGRESS')}
                        className={`rounded-xl p-2.5 flex flex-col items-center text-center border transition-all cursor-pointer ${
                          step2Done
                            ? 'bg-white dark:bg-[#241740] border-purple-100 dark:border-[#3b3464] shadow-[0_2px_8px_rgba(113,53,181,0.04)]'
                            : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700/60 hover:bg-amber-100/70'
                        }`}
                      >
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center mb-1.5 text-[11px] font-bold ${
                            step2Done
                              ? 'bg-emerald-500 text-white'
                              : 'bg-amber-500 text-white'
                          }`}
                        >
                          {step2Done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '2'}
                        </div>
                        <span className="text-[11.5px] font-bold text-slate-800 dark:text-white leading-tight truncate w-full">
                          2. Check-in
                        </span>
                        <span className="text-[10px] font-mono font-semibold mt-1 truncate w-full text-[#7135b5] dark:text-[#DAB9FF]">
                          {step2Done
                            ? `${formatJakartaTimeOnly(ticket.checkInAt!)} WIB`
                            : 'Kirim #PROGRESS'}
                        </span>
                      </button>

                      {/* Step 3: Laporan QC */}
                      <button
                        type="button"
                        onClick={() => handleOpenTicket(ticket)}
                        className="bg-white dark:bg-[#241740] border border-purple-100 dark:border-[#3b3464] rounded-xl p-2.5 flex flex-col items-center text-center shadow-[0_2px_8px_rgba(113,53,181,0.04)] hover:border-purple-300 transition-all cursor-pointer"
                      >
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center mb-1.5 text-[11px] font-bold ${
                            step3Done
                              ? 'bg-emerald-500 text-white'
                              : 'bg-[#7135b5] text-white'
                          }`}
                        >
                          {step3Done ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '3'}
                        </div>
                        <span className="text-[11.5px] font-bold text-slate-800 dark:text-white leading-tight truncate w-full">
                          3. Laporan QC
                        </span>
                        <span className="text-[10px] font-semibold mt-1 truncate w-full text-[#7135b5] dark:text-[#DAB9FF]">
                          {step3Done
                            ? ticket.approvalStatus === 'APPROVED'
                              ? 'Approved'
                              : 'Menunggu Disp...'
                            : step2Done
                            ? 'Siap Submit...'
                            : 'Terkunci'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* 5. STITCH TECHNICIAN & DISPATCH REMARKS ALERT */}
                  {(ticket.remarksWOInstaller || ticket.remarksAgent) && (
                    <div className="bg-[#fffbeb] dark:bg-amber-950/30 border border-[#fef08a] dark:border-amber-800/50 rounded-xl px-3.5 py-2.5 flex items-start gap-2.5 shadow-2xs">
                      <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="text-[11.5px] text-amber-900 dark:text-amber-200 leading-snug space-y-0.5 min-w-0">
                        {ticket.remarksWOInstaller && (
                          <div className="break-words">
                            <span className="font-bold">Catatan Teknisi: </span>
                            <span className="font-mono text-[11px] uppercase tracking-tight text-amber-800 dark:text-amber-100">
                              {ticket.remarksWOInstaller}
                            </span>
                          </div>
                        )}
                        {ticket.remarksAgent && (
                          <div className="break-words">
                            <span className="font-bold">Catatan Dispatch: </span>
                            <span className="text-amber-800 dark:text-amber-200">{ticket.remarksAgent}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Quick On-Site Arrival CTA when En Route */}
                  {!ticketClosed && ticket.statusWOInstaller === 'En Route' && (
                    <button
                      type="button"
                      onClick={() => handleQuickStatus(ticket.id, 'On Site', 'Teknisi tiba di lokasi pelanggan')}
                      className="w-full py-2.5 px-3 rounded-xl bg-teal-50 hover:bg-teal-100 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-700 text-teal-800 dark:text-teal-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Konfirmasi Tiba di Lokasi (On Site)</span>
                    </button>
                  )}

                  {/* 6. STITCH UNIFIED 4-BUTTON TACTILE ACTION DOCK */}
                  <div className="bg-white/85 dark:bg-[#160D29]/90 backdrop-blur-md border border-purple-100 dark:border-[#35105E] p-2 rounded-2xl shadow-tactile-card">
                    <div className="grid grid-cols-4 gap-2">
                      {/* 1. Kendala */}
                      <button
                        type="button"
                        disabled={ticketClosed}
                        onClick={() => setKendalaTicket(ticket)}
                        title={ticketClosed ? 'WO sudah ditutup' : 'Laporkan kendala lapangan atau reschedule'}
                        className="h-12 flex flex-col items-center justify-center rounded-xl bg-[#fee2e2] hover:bg-[#fecaca] disabled:opacity-45 disabled:cursor-not-allowed border border-[#f87171] dark:bg-rose-950/60 dark:border-rose-700/70 text-[#b91c1c] dark:text-rose-200 shadow-tactile-danger active:translate-y-0.5 transition-all cursor-pointer"
                      >
                        <ShieldAlert className="w-4 h-4 mb-0.5" />
                        <span className="text-[11px] font-bold leading-none">Kendala</span>
                      </button>

                      {/* 2. Maps (prioritize captured house GPS, fallback address) */}
                      <button
                        type="button"
                        onClick={() => {
                          if (hasHouseGps) {
                            openCoordinatesInGoogleMaps(
                              ticket.houseLocation!.latitude,
                              ticket.houseLocation!.longitude
                            );
                          } else {
                            openCustomerAddressInGoogleMaps(ticket, () => {
                              toast.warning('Alamat & koordinat GPS pelanggan belum tersedia.', 'Google Maps');
                            });
                          }
                        }}
                        title={
                          hasHouseGps
                            ? 'Buka koordinat GPS Rumah Pelanggan di Google Maps'
                            : 'Buka rute alamat pelanggan di Google Maps'
                        }
                        className="h-12 flex flex-col items-center justify-center rounded-xl bg-purple-50 hover:bg-purple-100/80 dark:bg-[#261942] dark:hover:bg-[#342b4e] border border-purple-200/80 dark:border-[#4B386B] text-[#4a1584] dark:text-[#DAB9FF] shadow-tactile-subtle active:translate-y-0.5 transition-all cursor-pointer"
                      >
                        <Navigation className="w-4 h-4 mb-0.5 text-[#7135b5] dark:text-[#DAB9FF]" />
                        <span className="text-[11px] font-bold leading-none">Maps</span>
                      </button>

                      {/* 3. Live Chat */}
                      <button
                        type="button"
                        onClick={() => handleOpenChat(ticket)}
                        title="Buka Live Chat koordinasi dengan Dispatch untuk tiket ini"
                        className="h-12 flex flex-col items-center justify-center rounded-xl bg-purple-50 hover:bg-purple-100/80 dark:bg-[#261942] dark:hover:bg-[#342b4e] border border-purple-200/80 dark:border-[#4B386B] text-[#4a1584] dark:text-[#DAB9FF] shadow-tactile-subtle active:translate-y-0.5 transition-all relative cursor-pointer"
                      >
                        <div className="relative">
                          <MessageSquare className="w-4 h-4 mb-0.5 text-[#7135b5] dark:text-[#DAB9FF]" />
                          {unread > 0 && (
                            <span className="absolute -top-1 -right-2 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center ring-1 ring-white dark:ring-[#261942] tabular-nums">
                              {unread > 99 ? '99+' : unread}
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] font-bold leading-none">Live Chat</span>
                      </button>

                      {/* 4. Buka Tiket (Primary Tactile Purple) */}
                      <button
                        type="button"
                        onClick={() => handleOpenTicket(ticket)}
                        title="Buka rincian lengkap tiket, kamera geotag 6 titik & 3-Tier Checkout"
                        className="h-12 flex flex-col items-center justify-center rounded-xl bg-gradient-to-b from-[#7e3cb8] to-[#5b2299] text-white shadow-tactile-primary active:translate-y-[3px] transition-all relative overflow-hidden cursor-pointer px-1"
                      >
                        <div className="absolute inset-x-0 top-0 h-px bg-white/25 pointer-events-none" />
                        <TicketIcon className="w-4 h-4 mb-0.5" />
                        <span className="text-[11px] font-bold leading-none tracking-tight truncate max-w-full">
                          {canonicalApproval === 'REVISION' ? 'Perbaiki' : 'Buka Tiket'}
                        </span>
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 4. CONTEXTUAL MATERIAL TERPAKAI SUMMARY BAR (NON-BLOCKING)   */}
      {/* ============================================================ */}
      {primaryActiveWo && !materialStripDismissed && (
        <div className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0 border border-[#E8DDFF] dark:border-[#7135B5]/40">
              <Package className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold text-[13px] text-[#1F1638] dark:text-white flex items-center gap-1.5">
                <span>Material Terpakai</span>
                <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]">
                  {primaryActiveWo.woNumber}
                </span>
              </div>
              <p className="text-[11.5px] text-[#4B4452] dark:text-[#CEC0E8] truncate mt-0.5">
                {primaryActiveWo.technicalReport?.usedMaterials ||
                  [
                    primaryActiveWo.technicalReport?.dropcoreLength || primaryActiveWo.dropcoreLength
                      ? `${primaryActiveWo.technicalReport?.dropcoreLength || primaryActiveWo.dropcoreLength}m Dropcore`
                      : null,
                    primaryActiveWo.ontBrand ? `1x ONT ${primaryActiveWo.ontBrand}` : null,
                    primaryActiveWo.technicalReport?.fatPort || primaryActiveWo.fatPort
                      ? `Port ${primaryActiveWo.technicalReport?.fatPort || primaryActiveWo.fatPort}`
                      : null
                  ]
                    .filter(Boolean)
                    .join(' • ') ||
                  'Belum ada material dicatat — ketuk Ubah untuk melengkapi'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => handleOpenTicket(primaryActiveWo)}
              className="tactile-btn-secondary px-3 py-1.5 rounded-xl bg-white dark:bg-[#261942] text-[#1F1638] dark:text-white border border-[#CEC3D4] dark:border-[#4B386B] text-xs font-bold cursor-pointer"
            >
              Ubah
            </button>
            <button
              type="button"
              onClick={() => setMaterialStripDismissed(true)}
              className="p-1.5 text-[#7D7484] hover:text-[#1F1638] dark:hover:text-white rounded-lg cursor-pointer"
              aria-label="Sembunyikan ringkasan material"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 5. LEVEL-3 KENDALA / RESCHEDULE ESCALATION MODAL             */}
      {/* ============================================================ */}
      <TactileConfirmModal
        isOpen={Boolean(kendalaTicket)}
        onClose={() => setKendalaTicket(null)}
        variant="danger"
        badge={kendalaTicket ? `ESKALASI KENDALA • ${kendalaTicket.woNumber}` : 'ESKALASI KENDALA'}
        title={`Laporkan Kendala / Tunda WO ${kendalaTicket?.woNumber || ''}`}
        subtitle={
          kendalaTicket
            ? `Pelanggan: ${kendalaTicket.customerName}. Laporan akan langsung memperbarui status teknis WO dan mengirim notifikasi kategori #ISSUE ke Dispatch.`
            : undefined
        }
        reasonOptions={KENDALA_ESCALATION_OPTIONS}
        requireNotes={true}
        notesLabel="Keterangan Detail Lapangan"
        notesPlaceholder="Jelaskan kendala di lokasi (misal: port FAT penuh, pelanggan minta dijadwalkan besok pagi pukul 09:00)..."
        confirmLabel="Kirim Laporan Kendala"
        cancelLabel="Batal"
        isSubmitting={isSubmittingKendala}
        onConfirm={handleConfirmKendala}
      />

      {/* ============================================================ */}
      {/* 6. DEDICATED TICKET DETAIL MODAL WITH LIVE CHAT              */}
      {/* ============================================================ */}
      <ResponsiveModal
        isOpen={Boolean(detailTicket)}
        onClose={() => setDetailTicket(null)}
        size="xl"
        mobileVariant="fullscreen"
        zIndexClass="z-60"
        icon={<Wrench className="w-4 h-4" />}
        title={
          detailTicket ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold text-[#58149C] dark:text-[#DAB9FF]">
                {detailTicket.woNumber}
              </span>
              <span className="text-sm font-bold text-[#1F1638] dark:text-white">
                {detailTicket.customerName}
              </span>
              <StatusInstallerBadge status={detailTicket.statusWOInstaller} />
            </span>
          ) : (
            'Detail Tiket'
          )
        }
        subtitle={
          detailTicket
            ? `ID Pelanggan: ${detailTicket.idCustomer || detailTicket.customerId || '-'}`
            : undefined
        }
        headerExtra={
          detailTicket ? (
            <div className="flex items-center gap-1.5">
              {(() => {
                const detailUnread = getTicketUnreadCount(detailTicket.id);
                return (
                  <button
                    type="button"
                    onClick={() => setDetailModalTab(prev => (prev === 'chat' ? 'details' : 'chat'))}
                    className={`min-h-[36px] px-2.5 sm:px-3 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer ${
                      detailModalTab === 'chat'
                        ? 'bg-[#58149C] text-white'
                        : 'bg-white hover:bg-[#F3EAFF] text-[#58149C] dark:bg-[#261942] dark:text-[#DAB9FF] border border-[#E8DDFF] dark:border-[#4B386B]'
                    }`}
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                      {detailModalTab === 'chat' ? 'Kembali ke Rincian' : 'Buka Live Chat'}
                    </span>
                    <span className="sm:hidden">
                      {detailModalTab === 'chat' ? 'Rincian' : 'Chat'}
                    </span>
                    {detailUnread > 0 && detailModalTab !== 'chat' && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-[#BA1A1A] text-white">
                        {detailUnread > 99 ? '99+' : detailUnread}
                      </span>
                    )}
                  </button>
                );
              })()}

              <button
                type="button"
                onClick={() => onOpenWhatsApp(detailTicket)}
                className="min-h-[36px] px-2.5 sm:px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <Phone className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">WhatsApp</span>
              </button>
            </div>
          ) : undefined
        }
      >
        {detailTicket && (
          <div className="space-y-5 text-xs">
            {detailModalTab === 'chat' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E8DDFF] dark:border-[#35105E]">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <h4 className="font-bold text-[#1F1638] dark:text-white text-sm">
                      Live Chat Koordinasi WO {detailTicket.woNumber}
                    </h4>
                  </div>
                  <span className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]">
                    Terhubung langsung dengan Dispatch dan Korlap Leader
                  </span>
                </div>

                <div className="rounded-xl border border-[#E8DDFF] dark:border-[#4B386B] overflow-hidden">
                  <TicketLiveChat ticket={detailTicket} initialCategory={chatInitialCategory} />
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-[#E8DDFF] dark:border-[#35105E] bg-white dark:bg-[#160D29] space-y-3">
                <h5 className="font-bold text-[#1F1638] dark:text-white text-xs flex items-center gap-1.5 border-b pb-2 border-[#E8DDFF] dark:border-[#35105E]">
                  <Wifi className="w-3.5 h-3.5 text-[#58149C]" />
                  <span>Laporan Teknis Lapangan (Optical Power OPM &amp; Root Cause)</span>
                </h5>
                <TechnicalReportForm
                  ticket={detailTicket}
                  onRequestProgressCheckIn={() => {
                    setChatInitialCategory('PROGRESS');
                    setTicketChatCategory(detailTicket.id, 'PROGRESS');
                    setDetailModalTab('chat');
                  }}
                />
              </div>
            )}
          </div>
        )}
      </ResponsiveModal>

      {/* ============================================================ */}
      {/* 7. STANDALONE QUICK LIVE CHAT MODAL (DIRECT FROM CARD)       */}
      {/* ============================================================ */}
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
          <div className="w-full flex items-center justify-between gap-3 text-xs text-[#7D7484] dark:text-[#CEC0E8]">
            <span>Koordinasi cepat dengan Dispatch &amp; Leader</span>
            <button
              type="button"
              onClick={() => setChatModalTicket(null)}
              className="btn-3d-secondary min-h-[40px] sm:min-h-[36px] px-4 py-1.5 rounded-xl font-bold text-xs cursor-pointer"
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
    </div>
  );
};
