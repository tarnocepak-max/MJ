import React, { useMemo, useState } from 'react';
import {
  Users,
  UserPlus,
  RefreshCw,
  MapPin,
  Search,
  AlertTriangle,
  PhoneCall,
  UserCheck,
  Radio,
  X,
  Copy,
  Check,
  Send,
  ClipboardCheck,
  Wrench,
  Clock,
  Award,
  TrendingUp
} from 'lucide-react';
import { Ticket, User } from '../../types/index.ts';
import { TechnicianCapacitySummary } from '../../services/leaderQuotaService';
import { buildWhatsAppClickToChatUrl, isValidPhoneNumber } from '../../services/whatsappService';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { formatWorkDuration } from '../../services/workSessionService';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { useToast } from '../../context/ToastContext';
import gisMapStripImg from '../../assets/images/leader_gis_map_strip_1794890484931.jpg';

interface LeaderTechnicianManagementViewProps {
  displayContractor: string;
  displayArea: string;
  clusterOptions: string[];
  technicians: TechnicianCapacitySummary[];
  todayTickets: Ticket[];
  allContractorTickets: Ticket[];
  isLeaderRole: boolean;
  isRefreshing?: boolean;
  onRefresh: () => void;
  onSelectTechnicianDetail: (installer: User) => void;
  onAssignWorkOrderToTechnician: (installer: User) => void;
  onSelectTicket: (ticket: Ticket) => void;
  onRegisterInstaller: (payload: {
    name: string;
    username: string;
    phone: string;
    email?: string;
  }) => { success: boolean; error?: string };
}

type TechFilterType = 'all' | 'field' | 'standby' | 'issue' | 'full';

function getInitials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'TK';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_TONES = [
  'bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF]',
  'bg-[#EEDBFF] dark:bg-[#35105E] text-[#35105E] dark:text-[#E8DDFF]',
  'bg-[#DCFCE7] dark:bg-emerald-950/70 text-[#15803D] dark:text-emerald-300',
  'bg-[#FEF3C7] dark:bg-amber-950/70 text-[#B45309] dark:text-amber-300'
];

export const LeaderTechnicianManagementView: React.FC<LeaderTechnicianManagementViewProps> = ({
  displayContractor,
  displayArea,
  clusterOptions,
  technicians,
  todayTickets,
  allContractorTickets,
  isLeaderRole,
  isRefreshing = false,
  onRefresh,
  onSelectTechnicianDetail,
  onAssignWorkOrderToTechnician,
  onSelectTicket,
  onRegisterInstaller
}) => {
  const { isCompactUI } = useResponsiveViewport();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TechFilterType>('all');
  const [showAddForm, setShowAddForm] = useState(false);

  // Add Technician Form State
  const [instName, setInstName] = useState('');
  const [instUsername, setInstUsername] = useState('');
  const [instPhone, setInstPhone] = useState('');
  const [instEmail, setInstEmail] = useState('');

  // Team Broadcast Sheet Modal State
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [broadcastAudience, setBroadcastAudience] = useState<'all' | 'field' | 'standby'>('all');
  const [broadcastMessage, setBroadcastMessage] = useState(
    `[KOORDINASI LAPANGAN - ${displayContractor}]\nHarap seluruh rekan teknisi memastikan status Check-in melalui LiveChat kategori PROGRESS dan kelengkapan foto Optical Power Meter (OPM) sebelum Submit Technical Report.`
  );
  const [copiedBroadcast, setCopiedBroadcast] = useState(false);

  // Compute enriched operational summary per technician strictly from live tickets & quota state
  const enrichedTechs = useMemo(() => {
    return technicians.map((summary, idx) => {
      const techNameLower = summary.installer.name.toLowerCase().trim();
      const myTodayTickets = todayTickets.filter(
        t => (t.installerName || '').toLowerCase().trim() === techNameLower
      );
      const completedToday = myTodayTickets.filter(
        t =>
          t.statusWOInstaller === 'Completed' ||
          t.statusWOInstaller === 'Installed' ||
          t.statusWOAgent === 'Resolved' ||
          t.statusWOAgent === 'Closed'
      ).length;

      const activeTicket =
        myTodayTickets.find(
          t =>
            t.statusWOInstaller === 'On Site' ||
            t.statusWOInstaller === 'En Route' ||
            t.statusWOAgent === 'In Progress'
        ) ||
        myTodayTickets.find(
          t => t.statusWOInstaller !== 'Completed' && t.statusWOInstaller !== 'Failed / Cancelled'
        );

      const issueTicket = myTodayTickets.find(
        t =>
          t.statusWOInstaller === 'Pending Technical' ||
          t.statusWOInstaller === 'Failed / Cancelled' ||
          String(t.remarksWOInstaller || '').toLowerCase().includes('kendala') ||
          String(t.remarksWOInstaller || '').toLowerCase().includes('penuh') ||
          String(t.remarksWOInstaller || '').toLowerCase().includes('redaman')
      );

      const hasPendingOpenWO = myTodayTickets.some(
        t =>
          t.statusWOInstaller !== 'Completed' &&
          t.statusWOInstaller !== 'Installed' &&
          t.statusWOInstaller !== 'Failed / Cancelled'
      );

      const isOnField =
        summary.liveTone === 'onsite' || summary.liveTone === 'enroute' || hasPendingOpenWO;
      const isStandby = !isOnField;

      const latestActiveOverallCount = allContractorTickets.filter(
        t =>
          (t.installerName || '').toLowerCase().trim() === techNameLower &&
          t.statusWOInstaller !== 'Completed' &&
          t.statusWOInstaller !== 'Failed / Cancelled'
      ).length;

      // Compute real completion rate & avg SLA duration across contractor history for leaderboard
      const techHistoryTickets = allContractorTickets.filter(
        t => (t.installerName || '').toLowerCase().trim() === techNameLower
      );
      const completedAllCount = techHistoryTickets.filter(
        t =>
          t.statusWOInstaller === 'Completed' ||
          t.statusWOInstaller === 'Installed' ||
          t.statusWOAgent === 'Resolved' ||
          t.statusWOAgent === 'Closed'
      ).length;
      const completionRatePct =
        techHistoryTickets.length > 0
          ? Math.round((completedAllCount / techHistoryTickets.length) * 1000) / 10
          : 0;
      const slaDurations = techHistoryTickets
        .map(t => Number(t.workDurationMinutes || 0))
        .filter(m => Number.isFinite(m) && m > 0 && m <= 600);
      const avgSlaMins =
        slaDurations.length > 0
          ? Math.round(slaDurations.reduce((a, b) => a + b, 0) / slaDurations.length)
          : 0;

      return {
        summary,
        idx,
        myTodayTickets,
        completedToday,
        completedAllCount,
        completionRatePct,
        avgSlaMins,
        activeTicket,
        issueTicket,
        isOnField,
        isStandby,
        latestActiveOverallCount
      };
    });
  }, [technicians, todayTickets, allContractorTickets]);

  const metrics = useMemo(() => {
    const total = enrichedTechs.length;
    const onField = enrichedTechs.filter(t => t.isOnField).length;
    const standby = enrichedTechs.filter(t => t.isStandby).length;
    const withIssues = enrichedTechs.filter(t => Boolean(t.issueTicket)).length;
    const fullQuota = enrichedTechs.filter(t => t.summary.isFull).length;
    const activePct = total > 0 ? Math.round((onField / total) * 100) : 0;
    return { total, onField, standby, withIssues, fullQuota, activePct };
  }, [enrichedTechs]);

  const topPerformers = useMemo(() => {
    return [...enrichedTechs]
      .sort((a, b) => {
        if (b.completedAllCount !== a.completedAllCount) return b.completedAllCount - a.completedAllCount;
        return b.completionRatePct - a.completionRatePct;
      })
      .slice(0, 3);
  }, [enrichedTechs]);

  const avgTeamSlaLabel = useMemo(() => {
    const valid = enrichedTechs.map(t => t.avgSlaMins).filter(m => m > 0);
    if (valid.length === 0) return '—';
    const avg = Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
    return formatWorkDuration(avg);
  }, [enrichedTechs]);

  const clusterBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    todayTickets.forEach(t => {
      const label = String(t.clusterName || t.area || '').trim();
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [todayTickets]);

  const filteredTechs = useMemo(() => {
    return enrichedTechs.filter(item => {
      if (statusFilter === 'field' && !item.isOnField) return false;
      if (statusFilter === 'standby' && !item.isStandby) return false;
      if (statusFilter === 'issue' && !item.issueTicket) return false;
      if (statusFilter === 'full' && !item.summary.isFull) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inst = item.summary.installer;
        const matchName = String(inst.name || '').toLowerCase().includes(q);
        const matchUser = String(inst.username || '').toLowerCase().includes(q);
        const matchArea = String(inst.area || '').toLowerCase().includes(q);
        const matchPhone = String(inst.phone || '').toLowerCase().includes(q);
        const matchWo = item.myTodayTickets.some(t => String(t.woNumber || '').toLowerCase().includes(q));
        if (!matchName && !matchUser && !matchArea && !matchPhone && !matchWo) return false;
      }
      return true;
    });
  }, [enrichedTechs, statusFilter, searchQuery]);

  const broadcastRecipients = useMemo(() => {
    if (broadcastAudience === 'field') return enrichedTechs.filter(t => t.isOnField);
    if (broadcastAudience === 'standby') return enrichedTechs.filter(t => t.isStandby);
    return enrichedTechs;
  }, [enrichedTechs, broadcastAudience]);

  const handleSubmitAddInstaller = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instName.trim() || !instUsername.trim() || !instPhone.trim()) {
      toast.error('Nama lengkap, username login, dan nomor WhatsApp wajib diisi.', 'Data Belum Lengkap');
      return;
    }
    const res = onRegisterInstaller({
      name: instName.trim(),
      username: instUsername.trim(),
      phone: instPhone.trim(),
      email: instEmail.trim() || undefined
    });
    if (res.success) {
      toast.success(`Teknisi ${instName.trim()} berhasil ditambahkan (Password default: 12345678).`, 'Teknisi Terdaftar');
      setInstName('');
      setInstUsername('');
      setInstPhone('');
      setInstEmail('');
      setShowAddForm(false);
    } else {
      toast.error(res.error || 'Gagal mendaftarkan teknisi baru.', 'Pendaftaran Gagal');
    }
  };

  const handleCopyBroadcast = () => {
    navigator.clipboard.writeText(broadcastMessage).then(() => {
      setCopiedBroadcast(true);
      toast.success('Pesan koordinasi tim disalin ke clipboard.', 'Pesan Disalin');
      setTimeout(() => setCopiedBroadcast(false), 2000);
    });
  };

  const handleOpenAreaMap = () => {
    const firstMappedTicket = todayTickets.find(t => Boolean(t.streetName || t.clusterName || t.area));
    if (firstMappedTicket) {
      openCustomerAddressInGoogleMaps(firstMappedTicket);
    } else {
      openCustomerAddressInGoogleMaps({ area: displayArea, clusterName: clusterOptions[0] || '' } as Ticket);
    }
  };

  return (
    <div className="space-y-4">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#58149C] dark:text-[#DAB9FF] block">
            FIELD DISPATCH UNIT · {displayContractor}
          </span>
          <h2
            className="text-xl sm:text-2xl font-extrabold text-[#1F1638] dark:text-white tracking-tight"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            Manajemen Teknisi
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            className={`mj-btn-leader-neutral px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer ${
              isRefreshing ? 'mj-btn-loading' : ''
            }`}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF] ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Live Sync</span>
          </button>

          {isLeaderRole && (
            <button
              type="button"
              onClick={() => setShowAddForm(prev => !prev)}
              className="mj-btn-leader-primary px-3.5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>{showAddForm ? 'Tutup Form' : '+ Tambah Teknisi'}</span>
            </button>
          )}
        </div>
      </div>

      {/* COLLAPSIBLE ADD INSTALLER FORM (Leader Scope Only) */}
      {showAddForm && isLeaderRole && (
        <form
          onSubmit={handleSubmitAddInstaller}
          className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-4 sm:p-5 shadow-[0_4px_14px_rgba(31,22,56,0.05)] space-y-4 animate-fadeIn"
        >
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#E8DDFF] dark:border-[#35105E]">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#1F1638] dark:text-white">
                  Daftarkan Teknisi Lapangan Baru
                </h3>
                <p className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]">
                  Terikat ke vendor <strong>{displayContractor}</strong> ({displayArea}). Password default:{' '}
                  <code className="font-mono font-bold text-[#58149C] dark:text-[#DAB9FF]">12345678</code>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-[#7D7484] hover:bg-[#F3EAFF] dark:hover:bg-[#2E1B59] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className={`grid gap-3 text-xs ${isCompactUI ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
            <div>
              <label className="block font-bold text-[#1F1638] dark:text-[#E8DDFF] mb-1">
                Nama Lengkap Teknisi *
              </label>
              <input
                type="text"
                required
                placeholder="Contoh: Budi Santoso"
                value={instName}
                onChange={e => setInstName(e.target.value)}
                className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-xl text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:border-[#58149C]"
              />
            </div>

            <div>
              <label className="block font-bold text-[#1F1638] dark:text-[#E8DDFF] mb-1">
                Username Login *
              </label>
              <input
                type="text"
                required
                placeholder="Contoh: budi_mjs"
                value={instUsername}
                onChange={e => setInstUsername(e.target.value)}
                className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-xl text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:border-[#58149C]"
              />
            </div>

            <div>
              <label className="block font-bold text-[#1F1638] dark:text-[#E8DDFF] mb-1">
                No. Telepon WhatsApp *
              </label>
              <input
                type="text"
                required
                placeholder="Contoh: 081234567890"
                value={instPhone}
                onChange={e => setInstPhone(e.target.value)}
                className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-xl text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:border-[#58149C]"
              />
            </div>

            <div>
              <label className="block font-bold text-[#1F1638] dark:text-[#E8DDFF] mb-1">
                Email (Opsional)
              </label>
              <input
                type="email"
                placeholder="teknisi@mitra.id"
                value={instEmail}
                onChange={e => setInstEmail(e.target.value)}
                className="tactile-debossed-input w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-xl text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:border-[#58149C]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="mj-btn-leader-neutral px-4 py-2 text-xs cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              className="mj-btn-leader-primary px-5 py-2 text-xs flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Simpan Akun Teknisi</span>
            </button>
          </div>
        </form>
      )}

      {/* 4 TACTILE KPI CARDS */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`text-left bg-white dark:bg-[#1E1238] rounded-2xl border p-3.5 sm:p-4 shadow-[0_3px_0_#E8DDFF,0_4px_12px_rgba(31,22,56,0.05)] dark:shadow-[0_3px_0_#120826] transition-all cursor-pointer ${
            statusFilter === 'all'
              ? 'border-[#58149C] dark:border-[#A380FE] ring-2 ring-[#58149C]/20'
              : 'border-[#E8DDFF] dark:border-[#3E246F] hover:border-[#A380FE]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8]">
                Total Teknisi
              </div>
              <div
                className="text-2xl font-extrabold text-[#1F1638] dark:text-white tabular-nums leading-none mt-1.5"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {String(metrics.total).padStart(2, '0')}
              </div>
              <div className="text-[11px] font-semibold text-[#58149C] dark:text-[#DAB9FF] mt-1">
                {metrics.total > 0 ? '100% Terdaftar' : 'Belum Ada Data'}
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(prev => (prev === 'field' ? 'all' : 'field'))}
          className={`text-left bg-white dark:bg-[#1E1238] rounded-2xl border p-3.5 sm:p-4 shadow-[0_3px_0_#E8DDFF,0_4px_12px_rgba(31,22,56,0.05)] dark:shadow-[0_3px_0_#120826] transition-all cursor-pointer ${
            statusFilter === 'field'
              ? 'border-emerald-500 ring-2 ring-emerald-500/20'
              : 'border-[#E8DDFF] dark:border-[#3E246F] hover:border-emerald-400'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8]">
                Bertugas / Check-in
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span
                  className="text-2xl font-extrabold text-[#1F1638] dark:text-white tabular-nums leading-none"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {String(metrics.onField).padStart(2, '0')}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/70 text-[#16A36A] dark:text-emerald-300 font-mono text-[10px] font-bold">
                  {metrics.activePct}% Aktif
                </span>
              </div>
              <div className="text-[11px] font-semibold text-[#7D7484] dark:text-[#CEC0E8] mt-1">
                Aktif Di Lapangan
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#16A36A] dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Wrench className="w-4 h-4" />
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(prev => (prev === 'standby' ? 'all' : 'standby'))}
          className={`text-left bg-white dark:bg-[#1E1238] rounded-2xl border p-3.5 sm:p-4 shadow-[0_3px_0_#E8DDFF,0_4px_12px_rgba(31,22,56,0.05)] dark:shadow-[0_3px_0_#120826] transition-all cursor-pointer ${
            statusFilter === 'standby'
              ? 'border-[#7135B5] dark:border-[#A380FE] ring-2 ring-[#7135B5]/20'
              : 'border-[#E8DDFF] dark:border-[#3E246F] hover:border-[#A380FE]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8]">
                Standby Basecamp
              </div>
              <div
                className="text-2xl font-extrabold text-[#1F1638] dark:text-white tabular-nums leading-none mt-1.5"
                style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
              >
                {String(metrics.standby).padStart(2, '0')}
              </div>
              <div className="text-[11px] font-semibold text-[#7D7484] dark:text-[#CEC0E8] mt-1">
                Siap Terima Dispatch
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#7135B5] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(prev => (prev === 'issue' ? 'all' : 'issue'))}
          className={`text-left bg-white dark:bg-[#1E1238] rounded-2xl border p-3.5 sm:p-4 shadow-[0_3px_0_#E8DDFF,0_4px_12px_rgba(31,22,56,0.05)] dark:shadow-[0_3px_0_#120826] transition-all cursor-pointer ${
            statusFilter === 'issue'
              ? 'border-[#BA1A1A] ring-2 ring-[#BA1A1A]/20'
              : 'border-[#E8DDFF] dark:border-[#3E246F] hover:border-[#BA1A1A]/50'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8]">
                Kendala / Penuh
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span
                  className="text-2xl font-extrabold text-[#93000A] dark:text-rose-300 tabular-nums leading-none"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {String(metrics.withIssues).padStart(2, '0')}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 text-[#93000A] dark:text-rose-300 font-mono text-[10px] font-bold">
                  {metrics.fullQuota} Penuh
                </span>
              </div>
              <div className="text-[11px] font-semibold text-[#7D7484] dark:text-[#CEC0E8] mt-1">
                Perlu Perhatian Leader
              </div>
            </div>
            <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-[#BA1A1A] dark:text-rose-300 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
        </button>
      </div>

      {/* DESKTOP 8/4 SPLIT: ROSTER (LEFT) + TOP PERFORMER & COVERAGE ANALYTICS (RIGHT) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-8 space-y-3.5">
          {/* SEARCH BAR + FILTER CHIPS */}
          <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-3.5 shadow-[0_2px_10px_rgba(31,22,56,0.04)] space-y-2.5">
            <div className="relative">
              <Search className="w-4 h-4 text-[#7D7484] absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Cari nama teknisi, username, nomor WA, atau nomor WO..."
                className="tactile-debossed-input w-full min-h-[44px] pl-10 pr-10 py-2.5 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#3E246F] rounded-xl text-xs text-[#1F1638] dark:text-white placeholder:text-[#7D7484] focus:outline-hidden focus:border-[#58149C]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-[#7D7484] hover:text-[#1F1638] dark:hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
              {[
                { id: 'all' as TechFilterType, label: `Semua (${metrics.total})` },
                { id: 'field' as TechFilterType, label: `Di Lapangan (${metrics.onField})` },
                { id: 'standby' as TechFilterType, label: `Standby (${metrics.standby})` },
                { id: 'issue' as TechFilterType, label: `Kendala (${metrics.withIssues})` },
                { id: 'full' as TechFilterType, label: `Kuota Penuh (${metrics.fullQuota})` }
              ].map(chip => {
                const active = statusFilter === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setStatusFilter(chip.id)}
                    className={`px-3.5 py-1.5 rounded-full text-xs whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'mj-btn-leader-secondary mj-btn-xs'
                        : 'mj-btn-leader-neutral mj-btn-xs'
                    }`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* TECHNICIAN CARDS LIST / GRID */}
          {filteredTechs.length === 0 ? (
            <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-10 text-center space-y-2.5">
              <div className="w-11 h-11 rounded-2xl bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center mx-auto">
                <Users className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-sm text-[#1F1638] dark:text-white">
                Tidak ada teknisi yang sesuai filter
              </h3>
              <p className="text-xs text-[#7D7484] dark:text-[#CEC0E8]">
                {technicians.length === 0
                  ? `Belum ada teknisi terdaftar pada vendor ${displayContractor}. Klik "+ Tambah Teknisi" untuk mendaftarkan teknisi.`
                  : 'Ubah kata kunci pencarian atau filter status di atas.'}
              </p>
            </div>
          ) : (
            <div className={`grid gap-3.5 ${isCompactUI ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
          {filteredTechs.map(({ summary, idx, completedToday, activeTicket, issueTicket, isStandby, latestActiveOverallCount }) => {
            const inst = summary.installer;
            const hasValidPhone = isValidPhoneNumber(inst.phone || '');
            const waUrl = hasValidPhone
              ? buildWhatsAppClickToChatUrl(
                  inst.phone || '',
                  `Halo ${inst.name}, koordinasi Leader (${displayContractor}) untuk jadwal WO area ${displayArea}.`
                ).url
              : '';

            const statusBadge = issueTicket
              ? {
                  label: `Kendala (${issueTicket.woNumber})`,
                  cls: 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700',
                  dot: 'bg-amber-500'
                }
              : activeTicket
              ? {
                  label: `On Job (${activeTicket.woNumber})`,
                  cls: 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700',
                  dot: 'bg-emerald-500'
                }
              : summary.isFull
              ? {
                  label: 'Kuota Harian Penuh',
                  cls: 'bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700',
                  dot: 'bg-rose-600'
                }
              : {
                  label: 'Standby Basecamp',
                  cls: 'bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF] border-[#D0BCFF] dark:border-[#58149C]/50',
                  dot: 'bg-[#58149C]'
                };

            return (
              <div
                key={inst.id}
                className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-4 shadow-[0_2px_10px_rgba(31,22,56,0.04)] flex flex-col justify-between gap-3.5"
              >
                {/* Header: Avatar + Name + Live Status Pill */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`relative w-11 h-11 rounded-2xl ${AVATAR_TONES[idx % AVATAR_TONES.length]} font-extrabold text-sm flex items-center justify-center shrink-0 shadow-2xs`}
                    >
                      {getInitials(inst.name)}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-[#1E1238] ${statusBadge.dot}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <h3
                        className="font-bold text-[14.5px] text-[#1F1638] dark:text-white truncate"
                        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                      >
                        {inst.name}
                      </h3>
                      <div className="text-[11px] font-mono text-[#58149C] dark:text-[#DAB9FF] truncate">
                        @{inst.username} · {inst.area || displayArea}
                      </div>
                      <div className="text-[10.5px] font-mono text-[#7D7484] dark:text-[#CEC0E8] truncate">
                        WA: {inst.phone || 'Belum diisi'}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10.5px] font-bold whitespace-nowrap shrink-0 ${statusBadge.cls}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${statusBadge.dot}`} />
                    <span className="truncate max-w-[130px]">{statusBadge.label}</span>
                  </span>
                </div>

                {/* 3 Compact Metric Wells */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl p-2.5 border border-[#E8DDFF] dark:border-[#35105E]">
                    <div className="text-[10px] font-semibold text-[#7D7484] dark:text-[#CEC0E8]">Beban WO</div>
                    <div className="mt-0.5 font-mono font-extrabold text-sm text-[#1F1638] dark:text-white tabular-nums">
                      {summary.assignedCount}
                      <span className="text-[#9A8DB2] text-xs font-semibold"> / {summary.maxLimit}</span>
                    </div>
                    <div className="mt-1.5 w-full h-1.5 bg-[#E8DDFF] dark:bg-[#2E1B59] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          summary.isFull ? 'bg-rose-600' : issueTicket ? 'bg-amber-500' : 'bg-[#58149C]'
                        }`}
                        style={{ width: `${Math.min(100, summary.utilizationPct)}%` }}
                      />
                    </div>
                  </div>

                  <div className="bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl p-2.5 border border-[#E8DDFF] dark:border-[#35105E]">
                    <div className="text-[10px] font-semibold text-[#7D7484] dark:text-[#CEC0E8]">Selesai Hari Ini</div>
                    <div className="mt-0.5 font-mono font-extrabold text-sm text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {completedToday} <span className="text-[11px] font-semibold">WO</span>
                    </div>
                    <div className="text-[10px] text-[#7D7484] dark:text-[#CEC0E8] truncate mt-0.5">
                      {latestActiveOverallCount} aktif total
                    </div>
                  </div>

                  <div className="bg-[#F8F1FF] dark:bg-[#160D29] rounded-xl p-2.5 border border-[#E8DDFF] dark:border-[#35105E]">
                    <div className="text-[10px] font-semibold text-[#7D7484] dark:text-[#CEC0E8]">Sisa Kuota</div>
                    <div className="mt-0.5 font-mono font-extrabold text-sm text-[#1F1638] dark:text-white tabular-nums">
                      {summary.remainingSlots} <span className="text-[11px] font-semibold">Slot</span>
                    </div>
                    <div className="text-[10px] font-semibold text-[#58149C] dark:text-[#DAB9FF] truncate mt-0.5">
                      {summary.hasCustomLimit ? 'Custom Limit' : 'Kuota Standar'}
                    </div>
                  </div>
                </div>

                {/* S1-S4 Live Slot Strip */}
                <div className="grid grid-cols-4 gap-1.5">
                  {summary.slots.map(cell => (
                    <button
                      key={cell.slotCode}
                      type="button"
                      disabled={!cell.ticket}
                      onClick={() => cell.ticket && onSelectTicket(cell.ticket)}
                      className={`py-1.5 px-1 rounded-lg font-mono text-[10px] font-bold text-center tabular-nums truncate transition-colors ${
                        cell.state === 'ok'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 cursor-pointer'
                          : cell.state === 'assigned'
                          ? 'bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF] border border-[#D0BCFF] dark:border-[#58149C]/50 cursor-pointer'
                          : cell.state === 'locked'
                          ? 'bg-[#F8F1FF] dark:bg-[#261942] text-[#7D7484] dark:text-[#CEC0E8] border border-[#E8DDFF] dark:border-[#3E246F]'
                          : 'bg-[#FDF7FF] dark:bg-[#120924] text-emerald-600 dark:text-emerald-400 border border-[#E8DDFF] dark:border-[#35105E]'
                      }`}
                    >
                      {cell.slotCode}: {cell.state === 'ok' ? 'OK' : cell.state === 'assigned' ? cell.shortWoCode : cell.state === 'locked' ? 'LOCK' : 'FREE'}
                    </button>
                  ))}
                </div>

                {/* Contextual Footer: Issue Callout OR Active Location Strip */}
                {issueTicket ? (
                  <button
                    type="button"
                    onClick={() => onSelectTicket(issueTicket)}
                    className="w-full text-left p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-start gap-2 cursor-pointer hover:bg-amber-100/70 transition-colors"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="min-w-0 text-[11px] text-amber-900 dark:text-amber-200">
                      <span className="font-bold block">
                        Kendala pada {issueTicket.woNumber} ({issueTicket.statusWOInstaller})
                      </span>
                      <span className="line-clamp-2">
                        {issueTicket.remarksWOInstaller || issueTicket.technicalReport?.rootCause || 'Memerlukan koordinasi & pengecekan detail WO.'}
                      </span>
                    </div>
                  </button>
                ) : activeTicket ? (
                  <button
                    type="button"
                    onClick={() => onSelectTicket(activeTicket)}
                    className="w-full text-left flex items-center justify-between gap-2 text-[11.5px] text-[#4B4452] dark:text-[#CEC0E8] hover:text-[#58149C] dark:hover:text-[#DAB9FF] cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 min-w-0 truncate">
                      <MapPin className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF] shrink-0" />
                      <span className="truncate">
                        {activeTicket.streetName || activeTicket.clusterName || activeTicket.customerName}
                      </span>
                    </span>
                    <span className="font-bold text-[#58149C] dark:text-[#DAB9FF] shrink-0">
                      {activeTicket.slotTime || activeTicket.statusWOInstaller}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11.5px] text-[#7D7484] dark:text-[#CEC0E8]">
                    <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>Siap menerima penugasan Work Order untuk {displayArea}.</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onSelectTechnicianDetail(inst)}
                    className="mj-btn-leader-neutral mj-btn-compact flex-1 py-2 px-3 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                    <span>Detail Profil</span>
                  </button>

                  {isStandby && !summary.isFull && isLeaderRole ? (
                    <button
                      type="button"
                      onClick={() => onAssignWorkOrderToTechnician(inst)}
                      className="mj-btn-leader-primary mj-btn-compact flex-1 py-2 px-3 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>Tugaskan WO</span>
                    </button>
                  ) : hasValidPhone ? (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mj-btn-leader-success mj-btn-compact flex-1 py-2 px-3 text-xs flex items-center justify-center gap-1.5"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      <span>Panggil WA</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAssignWorkOrderToTechnician(inst)}
                      disabled={!isLeaderRole || summary.isFull}
                      className="mj-btn-leader-primary mj-btn-compact flex-1 py-2 px-3 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>Tugaskan WO</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
            </div>
          )}
        </div>

        {/* RIGHT 4-COLUMN LEADERBOARD & COVERAGE PANEL */}
        <aside className="xl:col-span-4 space-y-3.5">
          {/* Dark Purple-to-Maroon Leaderboard Card: Top Performer */}
          <div className="rounded-2xl bg-gradient-to-br from-[#160D29] via-[#2D115B] to-[#480123] border border-[#58149C]/50 text-white p-4 shadow-[0_10px_24px_rgba(22,13,41,0.32)] space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-[#DAB9FF]">
                  TOP PERFORMER TIM
                </span>
                <h3
                  className="text-base font-extrabold text-white tracking-tight mt-0.5"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {displayArea}
                </h3>
              </div>
              <div className="w-9 h-9 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center text-[#DAB9FF] shrink-0">
                <Award className="w-4 h-4" />
              </div>
            </div>

            {topPerformers.length === 0 ? (
              <div className="rounded-xl bg-white/8 border border-white/10 p-3 text-xs text-[#E8DDFF]/80">
                Belum ada riwayat penyelesaian WO untuk peringkat teknisi.
              </div>
            ) : (
              <div className="space-y-2">
                {topPerformers.map((perf, rank) => (
                  <button
                    key={perf.summary.installer.id}
                    type="button"
                    onClick={() => onSelectTechnicianDetail(perf.summary.installer)}
                    className="w-full text-left rounded-xl bg-white/10 hover:bg-white/15 border border-white/12 px-3 py-2.5 flex items-center justify-between gap-2.5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono text-[11px] font-extrabold text-[#DAB9FF] w-5 shrink-0">
                        #{rank + 1}
                      </span>
                      <div className="w-8 h-8 rounded-lg bg-[#58149C] border border-[#A380FE]/40 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        {getInitials(perf.summary.installer.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-white truncate">
                          {perf.summary.installer.name}
                        </div>
                        <div className="text-[10.5px] text-[#E8DDFF]/80 truncate font-mono">
                          {perf.summary.installer.area || displayArea} · {perf.completedAllCount} WO
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-xs font-extrabold text-emerald-300 tabular-nums">
                        {perf.completionRatePct}%
                      </div>
                      {perf.avgSlaMins > 0 && (
                        <div className="font-mono text-[9.5px] text-[#DAB9FF]">
                          SLA {formatWorkDuration(perf.avgSlaMins)}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sebaran Sektor Aktif & Rata-rata SLA Tim Card */}
          <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#E8DDFF] dark:border-[#3E246F] p-4 shadow-[0_3px_0_#E8DDFF,0_4px_12px_rgba(31,22,56,0.05)] dark:shadow-[0_3px_0_#120826] space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#58149C] dark:text-[#DAB9FF]">
                  SEBARAN SEKTOR AKTIF
                </div>
                <div className="text-sm font-extrabold text-[#1F1638] dark:text-white truncate">
                  {displayArea} · {displayContractor}
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenAreaMap}
                className="mj-btn-leader-neutral mj-btn-xs px-2.5 py-1.5 text-[11px] flex items-center gap-1 text-[#58149C] dark:text-[#DAB9FF] cursor-pointer shrink-0"
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>GIS Map</span>
              </button>
            </div>

            <div className="relative h-28 rounded-xl overflow-hidden border border-[#E8DDFF] dark:border-[#35105E]">
              <img
                src={gisMapStripImg}
                alt="Peta cakupan area tim"
                className="w-full h-full object-cover opacity-80 dark:opacity-50"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#160D29]/85 via-transparent to-transparent flex items-end p-2.5">
                <div className="flex items-center justify-between w-full text-white text-[11px]">
                  <span className="font-semibold truncate">
                    {clusterOptions.length > 0 ? `${clusterOptions.length} Kluster Aktif` : `${todayTickets.length} WO Hari Ini`}
                  </span>
                  <span className="font-mono font-bold text-[#DAB9FF]">Live GIS</span>
                </div>
              </div>
            </div>

            {clusterBreakdown.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {clusterBreakdown.map(cluster => {
                  const pct = todayTickets.length > 0 ? Math.round((cluster.count / todayTickets.length) * 100) : 0;
                  return (
                    <div key={cluster.name} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-[#1F1638] dark:text-[#E8DDFF] truncate">{cluster.name}</span>
                        <span className="font-mono font-bold text-[#58149C] dark:text-[#DAB9FF] tabular-nums">
                          {cluster.count} WO ({pct}%)
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#F3EAFF] dark:bg-[#2E1B59] overflow-hidden">
                        <div className="h-full rounded-full bg-[#7135B5] dark:bg-[#A380FE]" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="pt-2.5 border-t border-[#E8DDFF] dark:border-[#35105E] flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#7D7484] dark:text-[#CEC0E8]">
                  RATA-RATA SLA TIM
                </div>
                <div
                  className="text-lg font-extrabold text-[#1F1638] dark:text-white font-mono tabular-nums"
                  style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                >
                  {avgTeamSlaLabel}
                </div>
              </div>
              <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1B59] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
          </div>

          {/* BOTTOM TEAM BROADCAST CTA */}
          <div className="space-y-1.5 text-center">
            <button
              type="button"
              onClick={() => setIsBroadcastOpen(true)}
              className="mj-btn-leader-primary w-full min-h-[48px] py-3 px-4 rounded-2xl text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              <Radio className="w-4 h-4" />
              <span>Broadcast Pesan ke Tim ({metrics.total} Teknisi)</span>
            </button>
            <p className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]">
              Koordinasi cepat via WhatsApp dalam cakupan {displayContractor}
            </p>
          </div>
        </aside>
      </div>

      {/* BROADCAST COORDINATION MODAL */}
      <ResponsiveModal
        isOpen={isBroadcastOpen}
        onClose={() => setIsBroadcastOpen(false)}
        size="md"
        mobileVariant="sheet"
        zIndexClass="z-60"
        icon={<Radio className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />}
        title="Broadcast Koordinasi Tim"
        subtitle={`${displayContractor} · ${displayArea}`}
        footer={
          <button
            type="button"
            onClick={() => setIsBroadcastOpen(false)}
            className="mj-btn-leader-neutral px-4 py-2 text-xs cursor-pointer"
          >
            Tutup
          </button>
        }
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-bold text-[#1F1638] dark:text-white mb-1.5">
              Target Penerima:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'all' as const, label: `Semua (${metrics.total})` },
                { id: 'field' as const, label: `Di Lapangan (${metrics.onField})` },
                { id: 'standby' as const, label: `Standby (${metrics.standby})` }
              ].map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBroadcastAudience(opt.id)}
                  className={`min-h-[42px] py-2 px-2 rounded-xl font-bold text-[11px] border cursor-pointer transition-colors ${
                    broadcastAudience === opt.id
                      ? 'bg-[#58149C] border-[#35105E] text-white'
                      : 'bg-[#F8F1FF] dark:bg-[#160D29] border-[#E8DDFF] dark:border-[#35105E] text-[#4B4452] dark:text-[#CEC0E8]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-bold text-[#1F1638] dark:text-white">
                Isi Pesan Instruksi:
              </label>
              <button
                type="button"
                onClick={handleCopyBroadcast}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-[#58149C] dark:text-[#DAB9FF] hover:underline cursor-pointer"
              >
                {copiedBroadcast ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedBroadcast ? 'Disalin' : 'Salin Teks'}</span>
              </button>
            </div>
            <textarea
              rows={4}
              value={broadcastMessage}
              onChange={e => setBroadcastMessage(e.target.value)}
              className="tactile-debossed-input w-full p-3 bg-[#F8F1FF] dark:bg-[#160D29] border border-[#D0BCFF] dark:border-[#4B386B] rounded-xl text-xs text-[#1F1638] dark:text-white focus:outline-hidden focus:border-[#58149C]"
            />
          </div>

          <div className="space-y-2">
            <div className="font-bold text-[#1F1638] dark:text-white">
              Kirim Langsung via WhatsApp ({broadcastRecipients.length} Teknisi):
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-[#E8DDFF] dark:divide-[#35105E] rounded-xl border border-[#E8DDFF] dark:border-[#3E246F] bg-white dark:bg-[#1E1238]">
              {broadcastRecipients.length === 0 ? (
                <div className="p-4 text-center text-[#7D7484] dark:text-[#CEC0E8]">
                  Tidak ada teknisi pada kelompok penerima ini.
                </div>
              ) : (
                broadcastRecipients.map(({ summary }) => {
                  const phone = summary.installer.phone || '';
                  const valid = isValidPhoneNumber(phone);
                  return (
                    <div key={summary.installer.id} className="px-3 py-2.5 flex items-center justify-between gap-2 bg-white dark:bg-[#1E1238]">
                      <div className="min-w-0">
                        <div className="font-bold text-[#1F1638] dark:text-white truncate">
                          {summary.installer.name}
                        </div>
                        <div className="text-[10.5px] font-mono text-[#7D7484] dark:text-[#CEC0E8]">
                          {phone || 'No. WA belum terdaftar'}
                        </div>
                      </div>
                      {valid ? (
                        <a
                          href={buildWhatsAppClickToChatUrl(phone, broadcastMessage).url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mj-btn-leader-success mj-btn-compact px-3 py-1.5 rounded-lg text-[11px] inline-flex items-center gap-1 shrink-0"
                        >
                          <Send className="w-3 h-3" />
                          <span>Kirim WA</span>
                        </a>
                      ) : (
                        <span className="text-[10.5px] text-[#9A8DB2] italic shrink-0">No WA N/A</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </ResponsiveModal>
    </div>
  );
};
