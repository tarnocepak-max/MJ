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
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
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
  Radio,
  Wifi,
  Camera,
  Filter,
  Search,
  Eye,
  Check,
  X,
  Play,
  AlertCircle,
  Router,
  RefreshCw,
  WifiOff,
  Package,
  ShieldAlert,
  SlidersHorizontal
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
    startWorkOnTicket,
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
    return myTickets.filter(t => {
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
  }, [myTickets, statusFilter, searchQuery, activeKpiDrilldown]);

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
    <div className="space-y-4 sm:space-y-5 pb-20 sm:pb-6">
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
      {/* 2. TOP HEADER & SEARCH/FILTER WORKSPACE                      */}
      {/* ============================================================ */}
      <div className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4 sm:p-5 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-b from-[#7135B5] to-[#58149C] text-white flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_3px_0_#2A0053]">
              <Wrench className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[16px] sm:text-[17px] font-bold text-[#1F1638] dark:text-white tracking-tight">
                  Tugas Saya (Field Ops)
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] border border-[#E8DDFF] dark:border-[#7135B5]/50">
                  {effectiveInstallerName}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                    isOnline
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700/50'
                      : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700/50'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
                  <span>{isOnline ? 'Online Sync' : 'Offline Cache'}</span>
                </span>
              </div>
              <p className="text-[11.5px] text-[#7D7484] dark:text-[#CEC0E8] mt-0.5">
                Jadwal hari ini ({todayWIB}) • Pantau telemetry OPM, Check-in #PROGRESS, dan kirim laporan QC lapangan.
              </p>
            </div>
          </div>

          {currentUser.role !== 'installer' && (
            <div className="flex items-center gap-2 bg-[#F8F1FF] dark:bg-[#160D29] p-2 rounded-xl border border-[#E8DDFF] dark:border-[#35105E]">
              <span className="text-xs font-semibold text-[#4B4452] dark:text-[#CEC0E8] whitespace-nowrap">
                Teknisi:
              </span>
              <select
                value={selectedInstallerName}
                onChange={e => setSelectedInstallerName(e.target.value)}
                className="tactile-debossed-input px-2.5 py-1.5 text-xs bg-white dark:bg-[#22123F] rounded-lg font-semibold text-[#1F1638] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#58149C]"
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

        {/* Search & Filter Controls */}
        <div className="pt-3 border-t border-[#E8DDFF] dark:border-[#35105E] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-[#7D7484] absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Cari nomor WO, nama pelanggan, cluster, atau telepon..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="tactile-debossed-input w-full pl-9 pr-8 py-2 bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl text-xs text-[#1F1638] dark:text-white placeholder:text-[#7D7484] focus:outline-none focus:ring-2 focus:ring-[#58149C]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-[#7D7484] hover:text-[#1F1638] dark:hover:text-white cursor-pointer"
                aria-label="Hapus pencarian"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[#7D7484] dark:text-[#CEC0E8] font-semibold text-[11px] mr-1 flex items-center gap-1">
              <Filter className="w-3 h-3" /> Filter:
            </span>
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrilldown(null);
                setStatusFilter('all');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'all' && !activeKpiDrilldown
                  ? 'bg-[#342B4E] text-white shadow-[0_2px_0_#160D29]'
                  : 'bg-[#F8F1FF] text-[#4B4452] hover:bg-[#EEE4FF] dark:bg-[#160D29] dark:text-[#CEC0E8]'
              }`}
            >
              Semua ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrilldown(null);
                setStatusFilter('pending');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'pending'
                  ? 'bg-[#58149C] text-white shadow-[0_2px_0_#2A0053]'
                  : 'bg-[#F3EAFF] text-[#58149C] hover:bg-[#E8DDFF] dark:bg-[#261942] dark:text-[#DAB9FF]'
              }`}
            >
              Aktif ({counts.pending})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrilldown(null);
                setStatusFilter('butuh_approval');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                statusFilter === 'butuh_approval'
                  ? 'bg-amber-600 text-white shadow-[0_2px_0_#92400E]'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/70 dark:text-amber-200 border border-amber-200 dark:border-amber-700/50'
              }`}
            >
              <AlertCircle className="w-3 h-3" />
              <span>Butuh Approval ({counts.butuh_approval})</span>
            </button>
            {counts.revision > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveKpiDrilldown(null);
                  setStatusFilter('revision');
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  statusFilter === 'revision'
                    ? 'bg-[#BA1A1A] text-white shadow-[0_2px_0_#7F1D1D]'
                    : 'bg-[#FEF2F2] text-[#BA1A1A] hover:bg-rose-100 dark:bg-rose-950/80 dark:text-rose-200 border border-rose-200'
                }`}
              >
                <AlertTriangle className="w-3 h-3" />
                <span>Revisi ({counts.revision})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setActiveKpiDrilldown(null);
                setStatusFilter('done');
              }}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                statusFilter === 'done'
                  ? 'bg-emerald-600 text-white shadow-[0_2px_0_#065F46]'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300'
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
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
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
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  statusFilter === 'cancel'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/60 dark:text-rose-300'
                }`}
              >
                Cancel ({counts.cancel})
              </button>
            )}
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
            <span className="text-xs font-bold text-[#4B4452] dark:text-[#E9D5FF] uppercase tracking-wider">
              Daftar Work Order ({filteredTickets.length} Tiket)
            </span>
            <span className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8] hidden sm:inline">
              Ketuk <strong>&ldquo;Buka Tiket&rdquo;</strong> untuk 3-Tier Checkout, Foto 4 Titik &amp; Validasi QC
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
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
              const fatDisplay =
                numericFat !== null
                  ? `${numericFat.toFixed(1)}`
                  : ticket.technicalReport?.deviceSerialNumber || ticket.ontSerialNumber || '—';

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

              return (
                <article
                  key={ticket.id}
                  className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-4 sm:p-5 space-y-4 relative overflow-hidden transition-all"
                >
                  {/* 1. Card Header: WO Pill + Category + Live Job Indicator */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E8DDFF] dark:border-[#35105E]">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="px-2.5 py-1 rounded-lg bg-[#F3EAFF] dark:bg-[#2E1459] border border-[#E8DDFF] dark:border-[#7135B5]/60 font-mono font-extrabold text-[13px] text-[#58149C] dark:text-[#DAB9FF] tracking-tight">
                        {ticket.woNumber}
                      </span>
                      <span className="text-xs font-semibold text-[#4B4452] dark:text-[#E9D5FF] truncate">
                        • {ticket.ticketCategory || ticket.appointmentType || 'New Installation'}
                      </span>
                      <span className="font-mono text-[10.5px] text-[#7D7484] dark:text-[#CEC0E8] hidden sm:inline">
                        ID: {ticket.idCustomer || ticket.customerId || '-'}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {isLiveJob && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] border border-[#DAB9FF]/70 dark:border-[#7135B5] text-[10.5px] font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#58149C] dark:bg-[#DAB9FF] animate-pulse" />
                          <span>Live Job</span>
                        </span>
                      )}
                      {ticketClosed && <StatusBadge status="CLOSED" variant="wo_agent" />}
                      <StatusInstallerBadge status={ticket.statusWOInstaller} />
                      {canonicalReport !== 'NONE' && (
                        <StatusBadge status={canonicalReport} variant="report" />
                      )}
                      <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
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

                  {/* 2. Customer Identity, Address & ODP/FAT Splitter Line */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-[#F3EAFF] dark:bg-[#2E1459] border border-[#E8DDFF] dark:border-[#7135B5]/50 text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_#ffffff,0_2px_0_#CEC3D4] dark:shadow-none">
                        <Router className="w-6 h-6" />
                      </div>
                      <div className="min-w-0 space-y-1">
                        <h3 className="font-display font-bold text-[17px] text-[#1F1638] dark:text-white leading-tight truncate">
                          {ticket.customerName}
                        </h3>
                        <div className="flex items-start gap-1.5 text-xs text-[#4B4452] dark:text-[#CEC0E8]">
                          <MapPin className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
                          <span className="line-clamp-2">
                            {ticket.clusterName ? `${ticket.clusterName} — ` : ''}
                            {ticket.streetName || ticket.area || 'Alamat belum terisi'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono font-bold text-[#58149C] dark:text-[#DAB9FF]">
                          <span>
                            {ticket.fdtCode || 'FDT -'} • FAT {ticket.fatCode || '-'}
                            {ticket.fatPort ? ` (Port ${ticket.fatPort})` : ''}
                          </span>
                          {ticket.slotTime && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#F8F1FF] dark:bg-[#160D29] text-[#4B4452] dark:text-[#E9D5FF] border border-[#E8DDFF] dark:border-[#35105E]">
                              <Clock className="w-3 h-3 text-[#58149C] dark:text-[#DAB9FF]" />
                              {ticket.slotTime}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Customer Contact Phone + Quick WA */}
                    <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 bg-[#F8F1FF] dark:bg-[#160D29] px-3 py-2 rounded-xl border border-[#E8DDFF] dark:border-[#35105E] shrink-0">
                      <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-[#1F1638] dark:text-white">
                        <Phone className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>{ticket.customerPhone || '-'}</span>
                      </div>
                      {ticket.customerPhone && (
                        <button
                          type="button"
                          onClick={() => onOpenWhatsApp(ticket)}
                          className="tactile-pill-btn px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* 3. DARK MECHANICAL OPTICAL TELEMETRY CONSOLE */}
                  <div className="rounded-2xl bg-[#160D29] border border-[#35105E] p-3.5 sm:p-4 text-white shadow-[0_6px_18px_rgba(22,13,41,0.22)]">
                    <div className="flex items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-white/10 text-[10.5px] font-mono uppercase tracking-wider">
                      <span className="flex items-center gap-1.5 text-[#DAB9FF] font-bold">
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        <span>OPM LIVE TELEMETRY (1490nm)</span>
                      </span>
                      <span className="text-[#CEC0E8] tabular-nums">
                        REF: -24.00 dBm
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      {/* Left Well: Power Rx ONT */}
                      <div className="rounded-xl bg-[#241740] border border-white/10 p-3">
                        <div className="text-[11px] text-[#CEC0E8] font-medium">
                          Power Rx ONT
                        </div>
                        <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
                          <span
                            className={`text-[20px] sm:text-[22px] font-bold leading-none ${
                              numericOpm === null
                                ? 'text-[#DAB9FF]'
                                : opmIsOutOfSpec
                                ? 'text-rose-400'
                                : 'text-white'
                            }`}
                          >
                            {opmDisplay}
                          </span>
                          {numericOpm !== null && (
                            <span className="text-xs text-[#CEC0E8]">dBm</span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold">
                          {numericOpm === null ? (
                            <span className="text-amber-300">Menunggu pengukuran OPM</span>
                          ) : opmIsOutOfSpec ? (
                            <span className="text-rose-400 flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Redaman Tinggi (&lt;-24)
                            </span>
                          ) : (
                            <span className="text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              Normal (Pass SOP)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right Well: FAT Redaman / ONT SN */}
                      <div className="rounded-xl bg-[#241740] border border-white/10 p-3">
                        <div className="text-[11px] text-[#CEC0E8] font-medium">
                          {numericFat !== null ? 'FAT Redaman Ref' : 'Serial Number ONT'}
                        </div>
                        <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums truncate">
                          <span className="text-[18px] sm:text-[20px] font-bold text-white leading-none truncate">
                            {fatDisplay}
                          </span>
                          {numericFat !== null && (
                            <span className="text-xs text-[#CEC0E8]">dBm</span>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold">
                          {numericFat !== null || ticket.ontSerialNumber || ticket.technicalReport?.deviceSerialNumber ? (
                            <span className="text-emerald-400 flex items-center gap-1 truncate">
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                              <span>Terkunci ({ticket.fatCode || 'FAT'})</span>
                            </span>
                          ) : (
                            <span className="text-[#DAB9FF]/80 truncate">
                              {ticket.ontBrand || 'Input saat Checkout'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 4. 3-STEP INSTALLATION PROGRESS RIBBON */}
                  <div>
                    <div className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8] mb-2">
                      TAHAPAN INSTALASI
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {/* Step 1: Mulai Kerja */}
                      <div
                        className={`rounded-xl p-2.5 text-center border transition-all ${
                          step1Done
                            ? 'bg-[#F8F1FF] dark:bg-[#241740] border-[#E8DDFF] dark:border-[#4B386B]'
                            : 'bg-white dark:bg-[#160D29] border-[#E8DDFF] dark:border-[#35105E]'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 mx-auto rounded-full flex items-center justify-center text-[11px] font-bold ${
                            step1Done
                              ? 'bg-emerald-500 text-white'
                              : 'bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF]'
                          }`}
                        >
                          {step1Done ? <Check className="w-3.5 h-3.5" /> : '1'}
                        </div>
                        <div className="font-bold text-[11.5px] text-[#1F1638] dark:text-white mt-1.5 truncate">
                          1. Mulai Kerja
                        </div>
                        <div className="text-[10px] text-[#7D7484] dark:text-[#CEC0E8] truncate font-mono">
                          {ticket.workStartedAt
                            ? `Mulai ${formatJakartaTimeOnly(ticket.workStartedAt)}`
                            : dropcoreInfo
                            ? `Dropcore ${dropcoreInfo}`
                            : 'Siap Berangkat'}
                        </div>
                      </div>

                      {/* Step 2: Check-in #PROGRESS */}
                      <button
                        type="button"
                        onClick={() => handleOpenChat(ticket, 'PROGRESS')}
                        className={`rounded-xl p-2.5 text-center border transition-all cursor-pointer ${
                          step2Done
                            ? 'bg-[#F8F1FF] dark:bg-[#241740] border-[#E8DDFF] dark:border-[#4B386B]'
                            : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700/60 hover:bg-amber-100/70'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 mx-auto rounded-full flex items-center justify-center text-[11px] font-bold ${
                            step2Done
                              ? 'bg-emerald-500 text-white'
                              : 'bg-amber-500 text-white'
                          }`}
                        >
                          {step2Done ? <Check className="w-3.5 h-3.5" /> : '2'}
                        </div>
                        <div className="font-bold text-[11.5px] text-[#1F1638] dark:text-white mt-1.5 truncate">
                          2. Check-in
                        </div>
                        <div className="text-[10px] font-mono truncate text-[#58149C] dark:text-[#DAB9FF]">
                          {step2Done
                            ? formatJakartaTimeOnly(ticket.checkInAt!)
                            : 'Kirim #PROGRESS'}
                        </div>
                      </button>

                      {/* Step 3: Laporan & QC */}
                      <button
                        type="button"
                        onClick={() => handleOpenTicket(ticket)}
                        className={`rounded-xl p-2.5 text-center border transition-all cursor-pointer ${
                          step3Done
                            ? 'bg-[#F8F1FF] dark:bg-[#241740] border-[#E8DDFF] dark:border-[#4B386B]'
                            : 'bg-[#F3EAFF] dark:bg-[#2E1459] border-[#58149C]/40 dark:border-[#A380FE]/50'
                        }`}
                      >
                        <div
                          className={`w-6 h-6 mx-auto rounded-full flex items-center justify-center text-[11px] font-bold ${
                            step3Done
                              ? 'bg-emerald-500 text-white'
                              : 'bg-[#58149C] text-white'
                          }`}
                        >
                          {step3Done ? <Check className="w-3.5 h-3.5" /> : '3'}
                        </div>
                        <div className="font-bold text-[11.5px] text-[#1F1638] dark:text-white mt-1.5 truncate">
                          3. Laporan QC
                        </div>
                        <div className="text-[10px] font-semibold truncate text-[#58149C] dark:text-[#DAB9FF]">
                          {step3Done
                            ? ticket.approvalStatus === 'APPROVED'
                              ? 'Approved'
                              : 'Menunggu Dispatch'
                            : step2Done
                            ? 'Siap Submit...'
                            : 'Terkunci'}
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Remarks / Notes */}
                  {(ticket.remarksWOInstaller || ticket.remarksAgent) && (
                    <div className="p-2.5 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-[11.5px] text-amber-950 dark:text-amber-200 space-y-0.5">
                      {ticket.remarksWOInstaller && (
                        <div>
                          <strong>Catatan Teknisi:</strong> {ticket.remarksWOInstaller}
                        </div>
                      )}
                      {ticket.remarksAgent && (
                        <div>
                          <strong>Catatan Dispatch:</strong> {ticket.remarksAgent}
                        </div>
                      )}
                    </div>
                  )}

                  {/* 5. TACTILE ACTION BAR */}
                  <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2.5 border-t border-[#E8DDFF] dark:border-[#35105E]">
                    <div className="flex flex-wrap items-center gap-2">
                      {!ticketClosed && !ticket.workStartedAt && (ticket.statusWOInstaller === 'Assigned' || !ticket.statusWOInstaller) && (
                        <button
                          type="button"
                          onClick={async e => {
                            e.stopPropagation();
                            try {
                              const res = await startWorkOnTicket(ticket.id);
                              if (res.success && res.ticket) {
                                setFullviewTicket(res.ticket);
                                toast.success(
                                  `Tiket WO ${ticket.woNumber} dibuka dan status pengerjaan dimulai.`,
                                  'Mulai Dikerjakan',
                                  { withSound: true }
                                );
                              } else if (!res.success && res.error) {
                                toast.error(res.error, 'Gagal Memulai Pengerjaan');
                              } else {
                                setFullviewTicket(ticket);
                              }
                            } catch {
                              setFullviewTicket(ticket);
                            }
                          }}
                          className="tactile-btn-primary px-4 py-2 min-h-[42px] bg-gradient-to-r from-[#58149C] to-[#7135B5] text-white text-xs font-extrabold rounded-xl flex items-center gap-1.5 cursor-pointer"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Mulai Kerjakan</span>
                        </button>
                      )}

                      {!ticketClosed && ticket.statusWOInstaller === 'Assigned' && !ticket.workStartedAt && (
                        <button
                          type="button"
                          onClick={() => handleQuickStatus(ticket.id, 'En Route', 'Teknisi berangkat menuju lokasi pelanggan')}
                          className="tactile-btn-secondary px-3 py-2 min-h-[42px] bg-white dark:bg-[#261942] text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-700/50 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                        >
                          <Navigation className="w-3.5 h-3.5" />
                          <span>Otw</span>
                        </button>
                      )}

                      {!ticketClosed && ticket.statusWOInstaller === 'En Route' && (
                        <button
                          type="button"
                          onClick={() => handleQuickStatus(ticket.id, 'On Site', 'Teknisi tiba di lokasi pelanggan')}
                          className="tactile-btn-secondary px-3 py-2 min-h-[42px] bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-700 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          <span>Tiba di Lokasi</span>
                        </button>
                      )}

                      {!ticketClosed && (
                        <button
                          type="button"
                          onClick={() => setKendalaTicket(ticket)}
                          className="tactile-btn-secondary px-3 py-2 min-h-[42px] bg-white dark:bg-[#261942] text-[#BA1A1A] dark:text-rose-300 border border-rose-200 dark:border-rose-500/40 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                          title="Laporkan kendala lapangan atau reschedule"
                        >
                          <ShieldAlert className="w-3.5 h-3.5" />
                          <span>Kendala</span>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                      <button
                        type="button"
                        onClick={() =>
                          openCustomerAddressInGoogleMaps(ticket, () => {
                            toast.warning('Alamat pelanggan belum tersedia untuk Google Maps.', 'Google Maps');
                          })
                        }
                        className="tactile-btn-secondary px-3 py-2 min-h-[42px] bg-white dark:bg-[#261942] border border-[#E8DDFF] dark:border-[#4B386B] text-[#58149C] dark:text-[#DAB9FF] text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                        title="Buka rute Google Maps"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                        <span>Maps</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenChat(ticket)}
                        className="tactile-btn-secondary relative px-3.5 py-2 min-h-[42px] bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] border border-[#DAB9FF] dark:border-[#7135B5] text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                        title="Buka Live Chat koordinasi dengan Dispatch untuk tiket ini"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Live Chat</span>
                        {unread > 0 && (
                          <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#BA1A1A] text-white leading-none tabular-nums">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleOpenTicket(ticket)}
                        className="tactile-btn-primary px-4 py-2 min-h-[42px] bg-gradient-to-r from-[#58149C] to-[#7135B5] text-white text-xs font-extrabold rounded-xl flex items-center gap-1.5 cursor-pointer"
                        title="Buka rincian lengkap tiket dan formulir teknis"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>
                          {canonicalApproval === 'REVISION'
                            ? 'Perbaiki Revisi'
                            : ticket.workStartedAt && !ticketClosed
                            ? 'Buka & Lapor QC'
                            : 'Buka Tiket'}
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
