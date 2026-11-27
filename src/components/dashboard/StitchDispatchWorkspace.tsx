import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  Filter,
  MapPin,
  MessageCircle,
  MessageSquare,
  Navigation,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Users,
  Zap
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Ticket, WOKpiFilterKey, WOKpiSummary } from '../../types/index.ts';
import {
  computeClientKpiSummary,
  getTicketCanonicalApprovalStatus,
  isTicketAssigned,
  isTicketCheckedIn,
  isTicketClosed
} from '../../services/woLifecycleService';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { StatusApprovalBadge, StatusInstallerBadge, StatusWhatsAppBadge } from '../common/Badge';

interface StitchDispatchWorkspaceProps {
  onNavigate: (tab: string) => void;
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
  onDrillDown: (filterKey: WOKpiFilterKey, filters?: { contractor?: string; area?: string }) => void;
}

const FEED_LIMIT = 8;

function getInitials(name?: string): string {
  if (!name) return 'LD';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'LD';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export const StitchDispatchWorkspace: React.FC<StitchDispatchWorkspaceProps> = ({
  onNavigate,
  onSelectTicket,
  onOpenWhatsApp,
  onDrillDown
}) => {
  const {
    currentUser,
    scopedTickets,
    kpiSummary,
    overdueSummary,
    users,
    todayWIB,
    kpiContractorFilter,
    kpiAreaFilter,
    refreshDatabaseData,
    refreshKpiSummary,
    toast
  } = useApp();

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedSlot, setSelectedSlot] = useState<string>('ALL');
  const [showAllFeed, setShowAllFeed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const baseTodayTickets = useMemo(() => {
    return (scopedTickets || []).filter(t => {
      if (!t || t.isDeleted || t.isArchived) return false;
      if (getTicketAppointmentDate(t) !== todayWIB) return false;
      if (kpiContractorFilter !== 'ALL') {
        const v = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
        if (v !== kpiContractorFilter.trim().toLowerCase()) return false;
      }
      if (kpiAreaFilter !== 'ALL') {
        const a = String(t.area || '').trim().toLowerCase();
        if (a !== kpiAreaFilter.trim().toLowerCase()) return false;
      }
      return true;
    });
  }, [scopedTickets, todayWIB, kpiContractorFilter, kpiAreaFilter]);

  const effectiveSummary: WOKpiSummary = useMemo(() => {
    if (
      kpiSummary &&
      kpiSummary.dateWIB === todayWIB &&
      kpiSummary.contractorFilter === kpiContractorFilter &&
      kpiSummary.areaFilter === kpiAreaFilter
    ) {
      return kpiSummary;
    }
    return computeClientKpiSummary(scopedTickets, currentUser, {
      dateWIB: todayWIB,
      contractorFilter: kpiContractorFilter,
      areaFilter: kpiAreaFilter
    });
  }, [kpiSummary, scopedTickets, currentUser, todayWIB, kpiContractorFilter, kpiAreaFilter]);

  const c = effectiveSummary.counts;

  // Dynamic Issue / Ticket Category Pills from live today tickets
  const categoryStats = useMemo(() => {
    const counts = new Map<string, number>();
    baseTodayTickets.forEach(t => {
      const cat = String(t.ticketCategory || t.remarksAgent || 'General FTTH').trim();
      if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [baseTodayTickets]);

  // Dynamic Slot Time Pills from live today tickets
  const slotOptions = useMemo(() => {
    const set = new Set<string>();
    baseTodayTickets.forEach(t => {
      const s = String(t.slotTime || '').trim();
      if (s) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b)).slice(0, 5);
  }, [baseTodayTickets]);

  // Filtered & Prioritized Triage Feed
  const triageFeed = useMemo(() => {
    const rank = (t: Ticket): number => {
      const app = getTicketCanonicalApprovalStatus(t);
      if (app === 'BUTUH APPROVAL') return 0;
      if (!isTicketAssigned(t)) return 1;
      if (!isTicketCheckedIn(t) && !isTicketClosed(t)) return 2;
      if (isTicketCheckedIn(t) && !isTicketClosed(t)) return 3;
      return 4;
    };

    return baseTodayTickets
      .filter(t => {
        if (selectedCategory !== 'ALL') {
          const cat = String(t.ticketCategory || t.remarksAgent || 'General FTTH').trim();
          if (cat !== selectedCategory) return false;
        }
        if (selectedSlot !== 'ALL') {
          if (String(t.slotTime || '').trim() !== selectedSlot) return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => {
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime();
      });
  }, [baseTodayTickets, selectedCategory, selectedSlot]);

  const visibleFeed = showAllFeed ? triageFeed : triageFeed.slice(0, FEED_LIMIT);

  // Average QA Approval Wait Minutes
  const avgApprovalWaitMin = useMemo(() => {
    const nowMs = Date.now();
    const waits = baseTodayTickets
      .filter(t => getTicketCanonicalApprovalStatus(t) === 'BUTUH APPROVAL')
      .map(t => {
        const ts = t.progressReports?.[0]?.timestamp || t.technicalReport?.submittedAt || t.updatedAt;
        const parsed = ts ? new Date(ts).getTime() : NaN;
        if (Number.isNaN(parsed)) return null;
        return Math.max(0, Math.round((nowMs - parsed) / 60000));
      })
      .filter((v): v is number => v !== null);
    if (waits.length === 0) return null;
    return Math.round(waits.reduce((sum, n) => sum + n, 0) / waits.length);
  }, [baseTodayTickets]);

  // WhatsApp outreach queue count
  const waQueueCount = useMemo(() => {
    return baseTodayTickets.filter(
      t => !isTicketClosed(t) && (!t.statusWhatsApp || t.statusWhatsApp === 'not_prepared' || t.statusWhatsApp === 'ready')
    ).length;
  }, [baseTodayTickets]);

  // Active techs logged on today's tickets or user roster
  const activeTechCount = useMemo(() => {
    const fromTickets = new Set(
      baseTodayTickets
        .map(t => String(t.installerName || '').trim().toLowerCase())
        .filter(Boolean)
    );
    if (fromTickets.size > 0) return fromTickets.size;
    return (users || []).filter(u => u.role === 'installer' && u.active !== false).length;
  }, [baseTodayTickets, users]);

  const primaryVendor = effectiveSummary.byVendor[0];
  const activeLeaders = useMemo(() => {
    return effectiveSummary.byLeader.slice(0, 4);
  }, [effectiveSummary.byLeader]);

  const mappedCount = Math.max(0, c.totalToday - c.unmappedDistribution);
  const scopeZoneLabel =
    kpiAreaFilter !== 'ALL'
      ? kpiAreaFilter.toUpperCase()
      : kpiContractorFilter !== 'ALL'
      ? kpiContractorFilter.toUpperCase()
      : currentUser.area
      ? currentUser.area.toUpperCase()
      : 'SEMUA AREA AKTIF';

  // Highlight lifecycle stage dynamically based on largest pending queue
  const highlightStage = c.butuhApproval > 0 && c.butuhApproval >= c.unassigned ? 6 : 3;

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([refreshDatabaseData(), refreshKpiSummary()]);
      toast.success(`Antrean triage Dispatch (${todayWIB}) diperbarui.`);
    } catch {
      toast.error('Gagal memperbarui data antrean Dispatch.');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 1. Compact Dispatch Context Bar */}
      <div className="card-3d-lavender mj-banner-glossy-3d rounded-2xl px-4 py-3.5 sm:px-5 sm:py-4 relative overflow-hidden">
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#DDF4F4] dark:bg-[#2e1459] text-[#2E7D8B] dark:text-[#dab9ff] border border-[#BDE4E8] dark:border-transparent text-[10.5px] font-extrabold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-[#2E7D8B] dark:bg-[#7135b5] animate-pulse" />
              <span>DISPATCH TRIAGE &amp; SLA WORKSPACE</span>
            </span>
            <span className="px-2.5 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2a194b] text-[#5145A6] dark:text-[#dab9ff] font-mono text-[10.5px] font-bold">
              ZONE: {scopeZoneLabel}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-[#52647A] dark:text-[#cabde8] tabular-nums shrink-0">
            <span>WIB: {todayWIB}</span>
            <span aria-hidden="true">·</span>
            <span>Overdue Alert: <strong className="text-[#9B2C37] dark:text-rose-300">{overdueSummary.totalOverdue}</strong></span>
          </div>
        </div>
      </div>

      {/* 2. 4 Priority Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Card 1: Urgent Overdue WO */}
        <div className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-[#9B2C37] dark:text-rose-300 text-[10.5px] font-extrabold uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>CRITICAL BREACH RISK</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#FCE9EB] dark:bg-rose-950/70 text-[#9B2C37] dark:text-rose-200 text-[10px] font-extrabold tabular-nums">
                {overdueSummary.totalOverdue} Tiket
              </span>
            </div>
            <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
              Urgent Overdue WO
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#cabde8] leading-relaxed">
              Tiket melewati Appointment Date hari ini dan belum selesai dieksekusi di lapangan. Perlu tindak lanjut ke Leader.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('overdue_wo')}
            className="btn-3d-amber w-full py-2.5 px-3 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Triage Overdue</span>
          </button>
        </div>

        {/* Card 2: Verification Desk */}
        <div className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-[#5145A6] dark:text-[#dab9ff] text-[10.5px] font-extrabold uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>PHOTO QC STREAM</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] text-[10px] font-extrabold tabular-nums">
                {c.butuhApproval} Queue
              </span>
            </div>
            <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
              Verification Desk
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#cabde8] leading-relaxed">
              Antrean validasi foto redaman optical power meter (OPM) &amp; geotag rumah.{' '}
              <span className="font-bold text-[#26364A] dark:text-white tabular-nums">
                Rerata tunggu: {avgApprovalWaitMin !== null ? `${avgApprovalWaitMin}m` : 'Real-time'}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('verification_desk')}
            className="btn-3d-emerald w-full py-2.5 px-3 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Buka Antrean QA</span>
          </button>
        </div>

        {/* Card 3: Sameday Quick Entry */}
        <div className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-[#52647A] dark:text-[#cabde8] text-[10.5px] font-extrabold uppercase tracking-wider">
                <Zap className="w-4 h-4 text-[#C88735] dark:text-amber-500 shrink-0" />
                <span>SINGLE TICKET INPUT</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#DDF4F4] dark:bg-[#2e1459] text-[#2E7D8B] dark:text-[#dab9ff] text-[10px] font-bold">
                Express WIB
              </span>
            </div>
            <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
              Sameday Quick Entry
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#cabde8] leading-relaxed">
              Entri manual single-ticket insiden darurat pelanggan prioritas untuk slot hari ini ({todayWIB}).
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('form_sameday')}
            className="btn-3d-lilac w-full py-2.5 px-3 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>+ Input Sameday WO</span>
          </button>
        </div>

        {/* Card 4: WhatsApp Dispatch */}
        <div className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-[#52647A] dark:text-[#cabde8] text-[10.5px] font-extrabold uppercase tracking-wider">
                <MessageCircle className="w-4 h-4 text-[#218A63] dark:text-emerald-600 shrink-0" />
                <span>OUTREACH CENTER</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#E4F5EC] dark:bg-emerald-950/70 text-[#218A63] dark:text-emerald-200 text-[10px] font-extrabold tabular-nums">
                {waQueueCount} Ready
              </span>
            </div>
            <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
              WhatsApp Dispatch
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#cabde8] leading-relaxed">
              Kirim notifikasi estimasi kedatangan teknisi &amp; koordinasi lapangan langsung ke nomor pelanggan.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('contact_centre')}
            className="btn-3d-darkpurple w-full py-2.5 px-3 rounded-xl text-xs font-extrabold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            <span>Buka WhatsApp Center</span>
          </button>
        </div>
      </div>

      {/* 3. Main Split: 8-Col Live Triage Feed + 4-Col Vendor/Leader Workload Sidebar */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Left 8 Cols: Live Triage Queue */}
        <div className="xl:col-span-8 space-y-3">
          {/* Dynamic Filter Bar */}
          <div className="card-3d-lavender rounded-xl p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#cabde8] mr-1 inline-flex items-center gap-1">
                <Filter className="w-3 h-3" />
                <span>FILTER ISSUE:</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedCategory('ALL')}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                  selectedCategory === 'ALL'
                    ? 'bg-[#6657C8] dark:bg-[#240c45] text-white'
                    : 'bg-[#EAE8FF] dark:bg-[#2a194b] text-[#5145A6] dark:text-[#dab9ff] hover:bg-[#DCE3F2]'
                }`}
              >
                All Active ({baseTodayTickets.length})
              </button>
              {categoryStats.map(([cat, count]) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(prev => (prev === cat ? 'ALL' : cat))}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors cursor-pointer max-w-[190px] truncate ${
                    selectedCategory === cat
                      ? 'bg-[#6657C8] dark:bg-[#58149c] text-white'
                      : 'bg-[#F8FAFD] dark:bg-[#160d29] text-[#52647A] dark:text-[#cabde8] border border-[#DDE6F0] dark:border-[#3b1d78] hover:border-[#65B8C4]'
                  }`}
                  title={cat}
                >
                  {cat} ({count})
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              {slotOptions.length > 0 && (
                <>
                  <span className="text-[10px] font-bold uppercase text-[#8492A5] dark:text-[#cabde8]">SLOT:</span>
                  <button
                    type="button"
                    onClick={() => setSelectedSlot('ALL')}
                    className={`px-2 py-1 rounded-md text-[10.5px] font-bold cursor-pointer ${
                      selectedSlot === 'ALL'
                        ? 'bg-[#6657C8] dark:bg-[#58149c] text-white'
                        : 'bg-[#F8FAFD] dark:bg-[#160d29] text-[#52647A] dark:text-[#cabde8]'
                    }`}
                  >
                    Semua
                  </button>
                  {slotOptions.map(slot => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setSelectedSlot(prev => (prev === slot ? 'ALL' : slot))}
                      className={`px-2 py-1 rounded-md text-[10.5px] font-mono font-bold cursor-pointer ${
                        selectedSlot === slot
                          ? 'bg-[#6657C8] dark:bg-[#58149c] text-white'
                          : 'bg-[#F8FAFD] dark:bg-[#160d29] text-[#52647A] dark:text-[#cabde8]'
                      }`}
                    >
                      {slot.replace(/\s*WIB/i, '')}
                    </button>
                  ))}
                </>
              )}
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                aria-label="Muat ulang antrean Dispatch"
                className="btn-3d-icon w-7 h-7 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Triage Cards List */}
          {visibleFeed.length === 0 ? (
            <div className="card-3d-lavender rounded-2xl p-10 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[#218A63] dark:text-emerald-500 mx-auto" />
              <div className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
                Tidak ada Work Order yang cocok dengan filter
              </div>
              <p className="text-xs text-[#52647A] dark:text-[#cabde8]">
                Ubah filter kategori atau slot waktu untuk menampilkan seluruh antrean aktif hari ini.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleFeed.map(ticket => {
                const assigned = isTicketAssigned(ticket);
                const checkedIn = isTicketCheckedIn(ticket);
                const closed = isTicketClosed(ticket);
                const approval = getTicketCanonicalApprovalStatus(ticket);
                const fullAddress =
                  ticket.streetName || ticket.address || ticket.clusterName || ticket.area || '-';
                const fatFdt = [ticket.fatCode || ticket.fat, ticket.fdtCode].filter(Boolean).join(' · ');
                const contractor = ticket.contactorName || ticket.contractorName || '-';

                return (
                  <div
                    key={ticket.id}
                    className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:border-[#65B8C4] transition-all"
                  >
                    <div className="flex items-start gap-3.5 min-w-0 flex-1">
                      <div
                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          approval === 'BUTUH APPROVAL'
                            ? 'bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff]'
                            : !assigned
                            ? 'bg-[#FCE9EB] dark:bg-rose-950/60 text-[#9B2C37] dark:text-rose-300'
                            : checkedIn
                            ? 'bg-[#E7F1FB] dark:bg-sky-950/60 text-[#3E81C6] dark:text-sky-300'
                            : 'bg-[#FFF2D9] dark:bg-amber-950/60 text-[#9D661F] dark:text-amber-300'
                        }`}
                      >
                        {!assigned ? (
                          <AlertTriangle className="w-5 h-5" />
                        ) : checkedIn ? (
                          <Navigation className="w-5 h-5" />
                        ) : (
                          <Clock className="w-5 h-5" />
                        )}
                      </div>

                      <div className="min-w-0 space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              onSelectTicket ? onSelectTicket(ticket, 'overview') : onNavigate('tickets')
                            }
                            className="font-mono text-base font-extrabold text-[#26364A] dark:text-white hover:text-[#5145A6] dark:hover:text-[#dab9ff] hover:underline cursor-pointer"
                          >
                            {ticket.woNumber}
                          </button>
                          {ticket.ticketCategory && (
                            <span className="px-2 py-0.5 rounded bg-[#FCE9EB] dark:bg-rose-950/50 text-[#9B2C37] dark:text-rose-300 text-[10px] font-extrabold uppercase">
                              {ticket.ticketCategory}
                            </span>
                          )}
                          <StatusInstallerBadge status={ticket.statusWOInstaller} />
                          {ticket.approvalStatus && ticket.approvalStatus !== 'NONE' && (
                            <StatusApprovalBadge status={ticket.approvalStatus} />
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#52647A] dark:text-[#cabde8]">
                          <span className="inline-flex items-center gap-1 font-semibold">
                            <Clock className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#dab9ff]" />
                            <span>Slot: {ticket.slotTime || '-'}</span>
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-[#D45B66] dark:text-rose-500 shrink-0" />
                            <span className="truncate max-w-[340px]">
                              {fullAddress}
                              {fatFdt ? ` (${fatFdt})` : ''}
                            </span>
                          </span>
                        </div>

                        <div className="text-xs font-semibold text-[#26364A] dark:text-white">
                          Pelanggan: {ticket.customerName} ·{' '}
                          <span className="font-mono text-[#5145A6] dark:text-[#dab9ff]">
                            {ticket.idCustomer}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8492A5] dark:text-[#cabde8]">
                          <span>Routing: {contractor}</span>
                          <span>•</span>
                          {assigned ? (
                            <span className="font-semibold text-[#5145A6] dark:text-[#dab9ff]">
                              Teknisi: {ticket.installerName}{' '}
                              {ticket.leaderName ? `(Lead: ${ticket.leaderName})` : ''}
                            </span>
                          ) : (
                            <span className="font-bold text-[#9B2C37] dark:text-rose-300">
                              Leader Belum Meneruskan ke Teknisi
                            </span>
                          )}
                          <span>•</span>
                          <StatusWhatsAppBadge status={ticket.statusWhatsApp} />
                        </div>
                      </div>
                    </div>

                    {/* Right 3D Action Pair */}
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 self-end lg:self-center">
                      {!assigned ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectTicket ? onSelectTicket(ticket, 'chat') : onNavigate('tickets')
                            }
                            className="btn-3d-amber px-3.5 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            <span>Eskalasi Leader</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onOpenWhatsApp ? onOpenWhatsApp(ticket) : onNavigate('contact_centre')
                            }
                            className="btn-3d-emerald px-3.5 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <MessageCircle className="w-3.5 h-3.5" />
                            <span>Hubungi WA</span>
                          </button>
                        </>
                      ) : approval === 'BUTUH APPROVAL' ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectTicket ? onSelectTicket(ticket, 'report') : onNavigate('verification_desk')
                            }
                            className="btn-3d-emerald px-3.5 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            <span>Review QA</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectTicket ? onSelectTicket(ticket, 'overview') : onNavigate('tickets')
                            }
                            className="btn-3d-lilac px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Detail WO</span>
                          </button>
                        </>
                      ) : checkedIn && !closed ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openCustomerAddressInGoogleMaps(ticket)}
                            className="btn-3d-lilac px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <MapPin className="w-3.5 h-3.5" />
                            <span>Cek Maps Lokasi</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onOpenWhatsApp ? onOpenWhatsApp(ticket) : onNavigate('contact_centre')
                            }
                            className="btn-3d-emerald px-3.5 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <PhoneCall className="w-3.5 h-3.5" />
                            <span>WA Pelanggan</span>
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectTicket ? onSelectTicket(ticket, 'chat') : onNavigate('tickets')
                            }
                            className="btn-3d-amber px-3.5 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span>Reminder Teknisi</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectTicket ? onSelectTicket(ticket, 'overview') : onNavigate('tickets')
                            }
                            className="btn-3d-lilac px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Detail WO</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}

              {triageFeed.length > FEED_LIMIT && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-[#8492A5] dark:text-[#cabde8] tabular-nums">
                    Menampilkan {visibleFeed.length} dari {triageFeed.length} tiket triage
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAllFeed(prev => !prev)}
                      className="btn-3d-lilac px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      {showAllFeed ? 'Ringkas (8 Teratas)' : `Tampilkan Semua (${triageFeed.length})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('tickets')}
                      className="btn-3d-primary px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <span>Buka Work Orders</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right 4 Cols: Vendor Workload & Field Leaders Sidebar */}
        <div className="xl:col-span-4 card-3d-lavender rounded-2xl p-5 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#5145A6] dark:text-[#dab9ff]" />
              <h2 className="font-display text-base font-extrabold text-[#26364A] dark:text-white">
                Vendor Workload
              </h2>
            </div>
            <span className="px-2 py-0.5 rounded bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] text-[10px] font-bold uppercase">
              READ-ONLY
            </span>
          </div>

          <div className="p-4 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-display text-sm font-extrabold text-[#26364A] dark:text-white">
                  {primaryVendor ? primaryVendor.contractorName : 'Semua Mitra Kontraktor'}
                </div>
                <div className="text-[11px] text-[#8492A5] dark:text-[#cabde8]">
                  {effectiveSummary.byVendor.length} Mitra Aktif · Area {scopeZoneLabel}
                </div>
              </div>
              <span className="w-2 h-2 rounded-full bg-[#6657C8] dark:bg-[#58149c] mt-1.5 shrink-0" />
            </div>

            <div className="grid grid-cols-3 gap-2 text-center pt-1">
              <button
                type="button"
                onClick={() => onDrillDown('total_today', primaryVendor ? { contractor: primaryVendor.contractorName } : undefined)}
                className="p-2 rounded-lg bg-white dark:bg-[#1e1238] border border-[#DDE6F0] dark:border-[#35105e] hover:border-[#6657C8]/60 transition-colors cursor-pointer"
              >
                <div className="font-display text-lg font-extrabold text-[#26364A] dark:text-white tabular-nums">
                  {primaryVendor ? primaryVendor.total : c.totalToday}
                </div>
                <div className="text-[10px] font-semibold text-[#8492A5]">Active WO</div>
              </button>
              <button
                type="button"
                onClick={() => onDrillDown('assigned', primaryVendor ? { contractor: primaryVendor.contractorName } : undefined)}
                className="p-2 rounded-lg bg-white dark:bg-[#1e1238] border border-[#DDE6F0] dark:border-[#35105e] hover:border-[#6657C8]/60 transition-colors cursor-pointer"
              >
                <div className="font-display text-lg font-extrabold text-[#5145A6] dark:text-[#dab9ff] tabular-nums">
                  {effectiveSummary.byLeader.length}
                </div>
                <div className="text-[10px] font-semibold text-[#8492A5]">Leaders Duty</div>
              </button>
              <button
                type="button"
                onClick={() => onDrillDown('checked_in_progress', primaryVendor ? { contractor: primaryVendor.contractorName } : undefined)}
                className="p-2 rounded-lg bg-white dark:bg-[#1e1238] border border-[#DDE6F0] dark:border-[#35105e] hover:border-[#6657C8]/60 transition-colors cursor-pointer"
              >
                <div className="font-display text-lg font-extrabold text-[#26364A] dark:text-white tabular-nums">
                  {activeTechCount}
                </div>
                <div className="text-[10px] font-semibold text-[#8492A5]">Techs Active</div>
              </button>
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#cabde8]">
              FIELD LEADERS ON DUTY
            </div>
            {activeLeaders.length === 0 ? (
              <div className="p-3 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] text-xs text-[#8492A5]">
                Belum ada leader yang terpetakan pada WO hari ini.
              </div>
            ) : (
              <div className="space-y-2">
                {activeLeaders.map(ld => (
                  <button
                    key={ld.leaderName}
                    type="button"
                    onClick={() => onDrillDown('assigned', { contractor: ld.contractorName })}
                    className="w-full flex items-center justify-between gap-2.5 p-2.5 rounded-xl bg-[#F8FAFD] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#35105e] hover:border-[#65B8C4] transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[#EAE8FF] dark:bg-[#2e1459] text-[#5145A6] dark:text-[#dab9ff] font-extrabold text-[11px] flex items-center justify-center shrink-0">
                        {getInitials(ld.leaderName)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                          {ld.leaderName}
                        </div>
                        <div className="text-[10.5px] text-[#8492A5] dark:text-[#cabde8] truncate">
                          {ld.contractorName || 'Vendor Roster'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                        {ld.total} Tiket
                      </div>
                      <div className="text-[10px] font-bold text-[#5145A6] dark:text-[#dab9ff]">
                        {ld.assigned} Assigned
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-xl bg-[#DDF4F4]/65 dark:bg-[#2a194b]/60 border border-[#BDE4E8] dark:border-[#4b386b] space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#2E7D8B] dark:text-[#dab9ff]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Auto-Distribution Policy</span>
            </div>
            <p className="text-[11px] text-[#52647A] dark:text-[#cabde8] leading-relaxed tabular-nums">
              <strong>{mappedCount}</strong> dari <strong>{c.totalToday}</strong> WO hari ini telah terdistribusi
              otomatis ke Vendor &amp; Area Leader. Gunakan eskalasi apabila masih terdapat {c.unassigned} WO belum
              ditugaskan ke teknisi.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('monitoring_maps')}
            className="btn-3d-primary dark:bg-none dark:bg-gradient-to-br dark:from-[#240c45] dark:to-[#3f186d] w-full p-3.5 rounded-xl text-white flex items-center justify-between gap-3 hover:brightness-105 transition-all cursor-pointer dark:shadow-[0_3px_0_#120624]"
          >
            <div className="flex items-center gap-2.5 text-left min-w-0">
              <div className="w-9 h-9 rounded-lg bg-white/15 dark:bg-white/10 flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4 text-white dark:text-[#DAB9FF]" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-white/80 dark:text-[#DAB9FF]">
                  SECTOR COVERAGE
                </div>
                <div className="text-xs font-extrabold text-white truncate">
                  Buka GIS Monitoring Maps ({c.checkedInProgress} On-Site)
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-white dark:text-[#DAB9FF] shrink-0" />
          </button>
        </div>
      </div>

      {/* 4. Bottom 7-Stage MoraJaws End-to-End Operational Lifecycle Bar */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-[#52647A] dark:text-[#cabde8]">
            MORAJAWS END-TO-END OPERATIONAL LIFECYCLE
          </span>
          <span className="text-[11px] font-bold text-[#5145A6] dark:text-[#dab9ff]">
            Strict Dispatch Verification Scope
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {[
            {
              step: 1,
              tag: '01. Import / Sameday',
              title: 'Auto Intake',
              sub: `${c.totalToday} System Queue`,
              filter: 'total_today' as WOKpiFilterKey
            },
            {
              step: 2,
              tag: '02. Auto Router',
              title: 'Vendor Allocation',
              sub: `${mappedCount} Mapped`,
              filter: 'unmapped_distribution' as WOKpiFilterKey
            },
            {
              step: 3,
              tag: '03. Leader Action',
              title: 'Teknisi Assignment',
              sub: `${c.unassigned} Pending Dispatch`,
              filter: 'unassigned' as WOKpiFilterKey
            },
            {
              step: 4,
              tag: '04. En-Route & Geo',
              title: 'Tech Check-in',
              sub: `${c.checkedInProgress} On-Site`,
              filter: 'checked_in_progress' as WOKpiFilterKey
            },
            {
              step: 5,
              tag: '05. Fiber Splice/Repair',
              title: 'Physical Action',
              sub: `${c.reportComplete} Complete Report`,
              filter: 'report_complete' as WOKpiFilterKey
            },
            {
              step: 6,
              tag: '06. Dispatch QA',
              title: 'Photo & OTP Review',
              sub: `${c.butuhApproval} Pending Queue`,
              filter: 'butuh_approval' as WOKpiFilterKey
            },
            {
              step: 7,
              tag: '07. Terminal State',
              title: 'Closed & Synced',
              sub: `${c.closed} Closed`,
              filter: 'closed' as WOKpiFilterKey
            }
          ].map(stage => {
            const isHighlighted = stage.step === highlightStage;
            return (
              <button
                key={stage.step}
                type="button"
                onClick={() => onDrillDown(stage.filter)}
                className={`p-3 rounded-xl text-left transition-all cursor-pointer border ${
                  isHighlighted
                    ? 'bg-[#EAE8FF] dark:bg-[#2e1459] border-[#6657C8] dark:border-[#7135b5] shadow-[0_2px_0_#C7C3EA] dark:shadow-[0_2px_0_#120624]'
                    : 'bg-[#F8FAFD] dark:bg-[#160d29] border-[#DDE6F0] dark:border-[#35105e] hover:border-[#65B8C4]'
                }`}
              >
                <div
                  className={`text-[10px] font-bold truncate ${
                    isHighlighted ? 'text-[#5145A6] dark:text-[#dab9ff]' : 'text-[#8492A5] dark:text-[#cabde8]'
                  }`}
                >
                  {stage.tag}
                </div>
                <div className="font-display text-xs font-extrabold text-[#26364A] dark:text-white mt-0.5 truncate">
                  {stage.title}
                </div>
                <div
                  className={`text-[10.5px] font-bold mt-1 truncate tabular-nums ${
                    isHighlighted ? 'text-[#9B2C37] dark:text-rose-300' : 'text-[#8492A5] dark:text-[#cabde8]'
                  }`}
                >
                  {stage.sub}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
