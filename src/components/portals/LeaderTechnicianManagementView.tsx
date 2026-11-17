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
  Clock
} from 'lucide-react';
import { Ticket, User } from '../../types/index.ts';
import { TechnicianCapacitySummary } from '../../services/leaderQuotaService';
import { buildWhatsAppClickToChatUrl, isValidPhoneNumber } from '../../services/whatsappService';
import { openCustomerAddressInGoogleMaps } from '../../services/mapsService';
import { useUIConfig } from '../../context/UIConfigContext';
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
  'bg-[#eedbff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff]',
  'bg-[#e0f2fe] dark:bg-sky-950/70 text-[#0369a1] dark:text-sky-300',
  'bg-[#dcfce7] dark:bg-emerald-950/70 text-[#15803d] dark:text-emerald-300',
  'bg-[#fef3c7] dark:bg-amber-950/70 text-[#b45309] dark:text-amber-300'
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
  const { isMobileView } = useUIConfig();
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

      return {
        summary,
        idx,
        myTodayTickets,
        completedToday,
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
    return { total, onField, standby, withIssues, fullQuota };
  }, [enrichedTechs]);

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
      {/* HEADER BAR (Stitch Field Dispatch Unit) */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#58149c] dark:text-[#dab9ff] block">
            FIELD DISPATCH UNIT · {displayContractor}
          </span>
          <h2
            className="text-xl sm:text-2xl font-extrabold text-[#1f1638] dark:text-white tracking-tight"
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
            className="btn-3d-secondary px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-[#58149c] dark:text-[#dab9ff] ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Live Sync</span>
          </button>

          {isLeaderRole && (
            <button
              type="button"
              onClick={() => setShowAddForm(prev => !prev)}
              className="btn-3d-primary px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
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
          className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#d8ccf3] dark:border-[#4b386b] p-4 sm:p-5 shadow-sm space-y-4 animate-fadeIn"
        >
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-[#e8ddff] dark:border-[#35105E]">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-[#eedbff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff] flex items-center justify-center">
                <UserPlus className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#1f1638] dark:text-white">
                  Daftarkan Teknisi Lapangan Baru
                </h3>
                <p className="text-[11px] text-[#7d7484] dark:text-[#CEC0E8]">
                  Terikat ke vendor <strong>{displayContractor}</strong> ({displayArea}). Password default:{' '}
                  <code className="font-mono font-bold text-[#58149c] dark:text-[#dab9ff]">12345678</code>
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="p-1.5 rounded-lg text-[#7d7484] hover:bg-[#f8f1ff] dark:hover:bg-[#261942] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className={`grid gap-3 text-xs ${isMobileView ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'}`}>
            <div>
              <label className="block font-bold text-[#1f1638] dark:text-[#f5eeff] mb-1">
                Nama Lengkap Teknisi *
              </label>
              <input
                type="text"
                required
                placeholder="Contoh: Budi Santoso"
                value={instName}
                onChange={e => setInstName(e.target.value)}
                className="w-full px-3 py-2 bg-[#f8f1ff] dark:bg-[#160D29] border border-[#cec3d4] dark:border-[#4b386b] rounded-xl text-xs text-[#1f1638] dark:text-white focus:outline-hidden focus:border-[#58149c]"
              />
            </div>

            <div>
              <label className="block font-bold text-[#1f1638] dark:text-[#f5eeff] mb-1">
                Username Login *
              </label>
              <input
                type="text"
                required
                placeholder="Contoh: budi_mjs"
                value={instUsername}
                onChange={e => setInstUsername(e.target.value)}
                className="w-full px-3 py-2 bg-[#f8f1ff] dark:bg-[#160D29] border border-[#cec3d4] dark:border-[#4b386b] rounded-xl text-xs text-[#1f1638] dark:text-white focus:outline-hidden focus:border-[#58149c]"
              />
            </div>

            <div>
              <label className="block font-bold text-[#1f1638] dark:text-[#f5eeff] mb-1">
                No. Telepon WhatsApp *
              </label>
              <input
                type="text"
                required
                placeholder="Contoh: 081234567890"
                value={instPhone}
                onChange={e => setInstPhone(e.target.value)}
                className="w-full px-3 py-2 bg-[#f8f1ff] dark:bg-[#160D29] border border-[#cec3d4] dark:border-[#4b386b] rounded-xl text-xs text-[#1f1638] dark:text-white focus:outline-hidden focus:border-[#58149c]"
              />
            </div>

            <div>
              <label className="block font-bold text-[#1f1638] dark:text-[#f5eeff] mb-1">
                Email (Opsional)
              </label>
              <input
                type="email"
                placeholder="teknisi@mitra.id"
                value={instEmail}
                onChange={e => setInstEmail(e.target.value)}
                className="w-full px-3 py-2 bg-[#f8f1ff] dark:bg-[#160D29] border border-[#cec3d4] dark:border-[#4b386b] rounded-xl text-xs text-[#1f1638] dark:text-white focus:outline-hidden focus:border-[#58149c]"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="btn-3d-secondary px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              className="btn-3d-primary px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Simpan Akun Teknisi</span>
            </button>
          </div>
        </form>
      )}

      {/* 3 PRIMARY KPI CARDS (Matching Stitch Screenshot 4) */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`text-left bg-white dark:bg-[#1E1238] rounded-2xl border p-3.5 sm:p-4 shadow-[0_2px_8px_rgba(31,22,56,0.04)] transition-all cursor-pointer ${
            statusFilter === 'all'
              ? 'border-[#58149c] ring-2 ring-[#dab9ff]/60 dark:border-[#a380fe]'
              : 'border-[#e8ddff] dark:border-[#35105E] hover:border-[#cec3d4]'
          }`}
        >
          <div className="w-8 h-8 rounded-xl bg-[#f3eaff] dark:bg-[#2E1B59] text-[#58149c] dark:text-[#dab9ff] flex items-center justify-center mb-2">
            <Users className="w-4 h-4" />
          </div>
          <div
            className="text-2xl font-extrabold text-[#1f1638] dark:text-white tabular-nums leading-none"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {String(metrics.total).padStart(2, '0')}
          </div>
          <div className="text-[11px] font-semibold text-[#7d7484] dark:text-[#CEC0E8] mt-1 truncate">
            Total Teknisi
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(prev => (prev === 'field' ? 'all' : 'field'))}
          className={`text-left bg-white dark:bg-[#1E1238] rounded-2xl border p-3.5 sm:p-4 shadow-[0_2px_8px_rgba(31,22,56,0.04)] transition-all cursor-pointer ${
            statusFilter === 'field'
              ? 'border-[#16A36A] ring-2 ring-emerald-300/60'
              : 'border-[#e8ddff] dark:border-[#35105E] hover:border-emerald-300'
          }`}
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-[#16A36A] dark:text-emerald-400 flex items-center justify-center mb-2">
            <Wrench className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="text-2xl font-extrabold text-[#1f1638] dark:text-white tabular-nums leading-none"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {String(metrics.onField).padStart(2, '0')}
            </span>
            <span className="w-2 h-2 rounded-full bg-[#16A36A]" />
          </div>
          <div className="text-[11px] font-semibold text-[#7d7484] dark:text-[#CEC0E8] mt-1 truncate">
            Di Lapangan
          </div>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter(prev => (prev === 'standby' ? 'all' : 'standby'))}
          className={`text-left bg-white dark:bg-[#1E1238] rounded-2xl border p-3.5 sm:p-4 shadow-[0_2px_8px_rgba(31,22,56,0.04)] transition-all cursor-pointer ${
            statusFilter === 'standby'
              ? 'border-[#2563EB] ring-2 ring-blue-300/60'
              : 'border-[#e8ddff] dark:border-[#35105E] hover:border-blue-300'
          }`}
        >
          <div className="w-8 h-8 rounded-xl bg-[#f3eaff] dark:bg-[#2E1B59] text-[#6a46c1] dark:text-[#d0bcff] flex items-center justify-center mb-2">
            <Clock className="w-4 h-4" />
          </div>
          <div
            className="text-2xl font-extrabold text-[#1f1638] dark:text-white tabular-nums leading-none"
            style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
          >
            {String(metrics.standby).padStart(2, '0')}
          </div>
          <div className="text-[11px] font-semibold text-[#7d7484] dark:text-[#CEC0E8] mt-1 truncate">
            Standby Camp
          </div>
        </button>
      </div>

      {/* AREA COVERAGE STRIP (Stitch Map Texture Card) */}
      <div className="relative overflow-hidden rounded-2xl border border-[#e8ddff] dark:border-[#35105E] bg-white dark:bg-[#1E1238] p-4 shadow-[0_2px_8px_rgba(31,22,56,0.04)]">
        <img
          src={gisMapStripImg}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 w-full h-full object-cover opacity-35 dark:opacity-15 pointer-events-none select-none"
        />
        <div className="relative z-10 flex items-center justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-[#58149c] dark:text-[#dab9ff]">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>AREA COVERAGE</span>
            </div>
            <div
              className="font-extrabold text-[15px] sm:text-base text-[#1f1638] dark:text-white truncate"
              style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
            >
              {displayArea} · {displayContractor}
            </div>
            <div className="text-[11.5px] text-[#4b4452] dark:text-[#CEC0E8] truncate">
              {clusterOptions.length > 0
                ? `${clusterOptions.length} Cluster Aktif: ${clusterOptions.slice(0, 3).join(', ')}${clusterOptions.length > 3 ? '...' : ''}`
                : `${todayTickets.length} Work Order terdaftar hari ini`}
            </div>
          </div>

          <button
            type="button"
            onClick={handleOpenAreaMap}
            className="btn-3d-secondary px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 text-[#58149c] dark:text-[#dab9ff] shrink-0 cursor-pointer"
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>GIS Map</span>
          </button>
        </div>
      </div>

      {/* SEARCH BAR + FILTER CHIPS */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-[#7d7484] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Cari nama teknisi, username, nomor WA, atau nomor WO..."
            className="w-full pl-10 pr-9 py-2.5 bg-white dark:bg-[#1E1238] border border-[#e8ddff] dark:border-[#35105E] rounded-2xl text-xs text-[#1f1638] dark:text-white placeholder:text-[#7d7484] shadow-[0_2px_6px_rgba(31,22,56,0.03)] focus:outline-hidden focus:border-[#58149c]"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7d7484] hover:text-[#1f1638] dark:hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5">
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
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap shrink-0 transition-all cursor-pointer ${
                  active
                    ? 'bg-[#58149c] text-white shadow-[0_2px_6px_rgba(88,20,156,0.25)]'
                    : 'bg-white dark:bg-[#1E1238] border border-[#e8ddff] dark:border-[#35105E] text-[#4b4452] dark:text-[#CEC0E8] hover:border-[#a380fe]'
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
        <div className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#e8ddff] dark:border-[#35105E] p-10 text-center space-y-2.5">
          <div className="w-11 h-11 rounded-2xl bg-[#f3eaff] dark:bg-[#2E1B59] text-[#58149c] dark:text-[#dab9ff] flex items-center justify-center mx-auto">
            <Users className="w-5 h-5" />
          </div>
          <h3 className="font-bold text-sm text-[#1f1638] dark:text-white">
            Tidak ada teknisi yang sesuai filter
          </h3>
          <p className="text-xs text-[#7d7484] dark:text-[#CEC0E8]">
            {technicians.length === 0
              ? `Belum ada teknisi terdaftar pada vendor ${displayContractor}. Klik "+ Tambah Teknisi" untuk mendaftarkan teknisi.`
              : 'Ubah kata kunci pencarian atau filter status di atas.'}
          </p>
        </div>
      ) : (
        <div className={`grid gap-3.5 ${isMobileView ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
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
                  cls: 'bg-[#fef3c7] dark:bg-amber-950/70 text-[#b45309] dark:text-amber-300 border-[#fcd34d] dark:border-amber-700',
                  dot: 'bg-[#d97706]'
                }
              : activeTicket
              ? {
                  label: `On Job (${activeTicket.woNumber})`,
                  cls: 'bg-[#dcfce7] dark:bg-emerald-950/70 text-[#15803d] dark:text-emerald-300 border-[#86efac] dark:border-emerald-700',
                  dot: 'bg-[#16A36A]'
                }
              : summary.isFull
              ? {
                  label: 'Kuota Harian Penuh',
                  cls: 'bg-[#ffdad6] dark:bg-rose-950/70 text-[#93000a] dark:text-rose-300 border-[#fca5a5] dark:border-rose-700',
                  dot: 'bg-[#ba1a1a]'
                }
              : {
                  label: 'Standby Basecamp',
                  cls: 'bg-[#e0f2fe] dark:bg-sky-950/70 text-[#1d4ed8] dark:text-sky-300 border-[#bae6fd] dark:border-sky-800',
                  dot: 'bg-[#2563EB]'
                };

            return (
              <div
                key={inst.id}
                className="bg-white dark:bg-[#1E1238] rounded-2xl border border-[#e8ddff] dark:border-[#35105E] p-4 shadow-[0_2px_10px_rgba(31,22,56,0.04)] flex flex-col justify-between gap-3.5"
              >
                {/* Header: Avatar + Name + Live Status Pill */}
                <div className="flex items-start justify-between gap-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`relative w-11 h-11 rounded-2xl ${AVATAR_TONES[idx % AVATAR_TONES.length]} font-extrabold text-sm flex items-center justify-center shrink-0 shadow-xs`}
                    >
                      {getInitials(inst.name)}
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-white dark:ring-[#1E1238] ${statusBadge.dot}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <h3
                        className="font-bold text-[14.5px] text-[#1f1638] dark:text-white truncate"
                        style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                      >
                        {inst.name}
                      </h3>
                      <div className="text-[11px] font-mono text-[#58149c] dark:text-[#dab9ff] truncate">
                        @{inst.username} · {inst.area || displayArea}
                      </div>
                      <div className="text-[10.5px] font-mono text-[#7d7484] dark:text-[#CEC0E8] truncate">
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
                  <div className="bg-[#f8f1ff] dark:bg-[#160D29] rounded-xl p-2.5 border border-[#e8ddff]/80 dark:border-[#35105E]">
                    <div className="text-[10px] font-semibold text-[#7d7484] dark:text-[#CEC0E8]">Beban WO</div>
                    <div className="mt-0.5 font-mono font-extrabold text-sm text-[#1f1638] dark:text-white tabular-nums">
                      {summary.assignedCount}
                      <span className="text-[#7d7484] text-xs font-semibold"> / {summary.maxLimit}</span>
                    </div>
                    <div className="mt-1.5 w-full h-1.5 bg-[#e8ddff] dark:bg-[#2E1B59] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          summary.isFull ? 'bg-[#ba1a1a]' : issueTicket ? 'bg-[#d97706]' : 'bg-[#58149c]'
                        }`}
                        style={{ width: `${Math.min(100, summary.utilizationPct)}%` }}
                      />
                    </div>
                  </div>

                  <div className="bg-[#f8f1ff] dark:bg-[#160D29] rounded-xl p-2.5 border border-[#e8ddff]/80 dark:border-[#35105E]">
                    <div className="text-[10px] font-semibold text-[#7d7484] dark:text-[#CEC0E8]">Selesai Hari Ini</div>
                    <div className="mt-0.5 font-mono font-extrabold text-sm text-[#16A36A] dark:text-emerald-400 tabular-nums">
                      {completedToday} <span className="text-[11px] font-semibold">WO</span>
                    </div>
                    <div className="text-[10px] text-[#7d7484] dark:text-[#CEC0E8] truncate mt-0.5">
                      {latestActiveOverallCount} aktif total
                    </div>
                  </div>

                  <div className="bg-[#f8f1ff] dark:bg-[#160D29] rounded-xl p-2.5 border border-[#e8ddff]/80 dark:border-[#35105E]">
                    <div className="text-[10px] font-semibold text-[#7d7484] dark:text-[#CEC0E8]">Sisa Kuota</div>
                    <div className="mt-0.5 font-mono font-extrabold text-sm text-[#1f1638] dark:text-white tabular-nums">
                      {summary.remainingSlots} <span className="text-[11px] font-semibold">Slot</span>
                    </div>
                    <div className="text-[10px] font-semibold text-[#58149c] dark:text-[#dab9ff] truncate mt-0.5">
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
                      className={`py-1 px-1 rounded-lg font-mono text-[10px] font-bold text-center tabular-nums truncate transition-colors ${
                        cell.state === 'ok'
                          ? 'bg-[#dcfce7] dark:bg-emerald-950/60 text-[#15803d] dark:text-emerald-300 border border-[#86efac] dark:border-emerald-800 cursor-pointer'
                          : cell.state === 'assigned'
                          ? 'bg-[#eedbff] dark:bg-[#35105E] text-[#58149c] dark:text-[#dab9ff] border border-[#d0bcff] dark:border-[#5b35b1] cursor-pointer'
                          : cell.state === 'locked'
                          ? 'bg-[#f1f5f9] dark:bg-[#261942] text-[#7d7484] border border-[#e2e8f0] dark:border-[#35105E]'
                          : 'bg-[#f8f1ff] dark:bg-[#160D29] text-[#16A36A] dark:text-emerald-400 border border-[#e8ddff] dark:border-[#35105E]'
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
                    <AlertTriangle className="w-4 h-4 text-[#d97706] shrink-0 mt-0.5" />
                    <div className="min-w-0 text-[11px] text-[#78350f] dark:text-amber-200">
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
                    className="w-full text-left flex items-center justify-between gap-2 text-[11.5px] text-[#4b4452] dark:text-[#CEC0E8] hover:text-[#58149c] dark:hover:text-[#dab9ff] cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5 min-w-0 truncate">
                      <MapPin className="w-3.5 h-3.5 text-[#58149c] dark:text-[#dab9ff] shrink-0" />
                      <span className="truncate">
                        {activeTicket.streetName || activeTicket.clusterName || activeTicket.customerName}
                      </span>
                    </span>
                    <span className="font-bold text-[#58149c] dark:text-[#dab9ff] shrink-0">
                      {activeTicket.slotTime || activeTicket.statusWOInstaller}
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5 text-[11.5px] text-[#7d7484] dark:text-[#CEC0E8]">
                    <ClipboardCheck className="w-3.5 h-3.5 text-[#16A36A] shrink-0" />
                    <span>Siap menerima penugasan Work Order untuk {displayArea}.</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => onSelectTechnicianDetail(inst)}
                    className="btn-3d-secondary flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-[#58149c] dark:text-[#dab9ff]" />
                    <span>Detail Profil</span>
                  </button>

                  {isStandby && !summary.isFull && isLeaderRole ? (
                    <button
                      type="button"
                      onClick={() => onAssignWorkOrderToTechnician(inst)}
                      className="btn-3d-primary flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ClipboardCheck className="w-3.5 h-3.5" />
                      <span>Tugaskan WO</span>
                    </button>
                  ) : hasValidPhone ? (
                    <a
                      href={waUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-3d-success flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                      <span>Panggil WA</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onAssignWorkOrderToTechnician(inst)}
                      disabled={!isLeaderRole || summary.isFull}
                      className="btn-3d-primary flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-45 cursor-pointer"
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

      {/* BOTTOM TEAM BROADCAST CTA */}
      <div className="pt-1 space-y-1.5 text-center">
        <button
          type="button"
          onClick={() => setIsBroadcastOpen(true)}
          className="btn-3d-primary w-full py-3 px-4 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
        >
          <Radio className="w-4 h-4" />
          <span>Broadcast Pesan ke Seluruh Tim ({metrics.total} Teknisi)</span>
        </button>
        <p className="text-[11px] text-[#7d7484] dark:text-[#CEC0E8]">
          Koordinasi cepat ke WhatsApp teknisi dalam cakupan {displayContractor}
        </p>
      </div>

      {/* BROADCAST COORDINATION MODAL */}
      {isBroadcastOpen && (
        <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white dark:bg-[#1E1238] w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl border border-[#e8ddff] dark:border-[#35105E] shadow-2xl overflow-hidden text-xs">
            <div className="px-5 py-4 bg-[#f8f1ff] dark:bg-[#261942] border-b border-[#e8ddff] dark:border-[#35105E] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#58149c] text-white flex items-center justify-center">
                  <Radio className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#1f1638] dark:text-white">
                    Broadcast Koordinasi Tim
                  </h3>
                  <p className="text-[11px] text-[#7d7484] dark:text-[#CEC0E8]">
                    {displayContractor} · {displayArea}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBroadcastOpen(false)}
                className="p-1.5 rounded-lg text-[#7d7484] hover:bg-white dark:hover:bg-[#35105E] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="block font-bold text-[#1f1638] dark:text-white mb-1.5">
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
                      className={`py-2 px-2 rounded-xl font-bold text-[11px] border cursor-pointer transition-colors ${
                        broadcastAudience === opt.id
                          ? 'bg-[#eedbff] dark:bg-[#35105E] border-[#58149c] text-[#58149c] dark:text-[#dab9ff]'
                          : 'bg-[#f8f1ff] dark:bg-[#160D29] border-[#e8ddff] dark:border-[#35105E] text-[#4b4452] dark:text-[#CEC0E8]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-[#1f1638] dark:text-white">
                    Isi Pesan Instruksi:
                  </label>
                  <button
                    type="button"
                    onClick={handleCopyBroadcast}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[#58149c] dark:text-[#dab9ff] hover:underline cursor-pointer"
                  >
                    {copiedBroadcast ? <Check className="w-3.5 h-3.5 text-[#16A36A]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedBroadcast ? 'Disalin' : 'Salin Teks'}</span>
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={broadcastMessage}
                  onChange={e => setBroadcastMessage(e.target.value)}
                  className="w-full p-3 bg-[#f8f1ff] dark:bg-[#160D29] border border-[#cec3d4] dark:border-[#4b386b] rounded-xl text-xs text-[#1f1638] dark:text-white focus:outline-hidden focus:border-[#58149c]"
                />
              </div>

              <div className="space-y-2">
                <div className="font-bold text-[#1f1638] dark:text-white">
                  Kirim Langsung via WhatsApp ({broadcastRecipients.length} Teknisi):
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-[#e8ddff] dark:divide-[#35105E] rounded-xl border border-[#e8ddff] dark:border-[#35105E]">
                  {broadcastRecipients.length === 0 ? (
                    <div className="p-4 text-center text-[#7d7484]">
                      Tidak ada teknisi pada kelompok penerima ini.
                    </div>
                  ) : (
                    broadcastRecipients.map(({ summary }) => {
                      const phone = summary.installer.phone || '';
                      const valid = isValidPhoneNumber(phone);
                      return (
                        <div key={summary.installer.id} className="px-3 py-2.5 flex items-center justify-between gap-2 bg-white dark:bg-[#1E1238]">
                          <div className="min-w-0">
                            <div className="font-bold text-[#1f1638] dark:text-white truncate">
                              {summary.installer.name}
                            </div>
                            <div className="text-[10.5px] font-mono text-[#7d7484]">
                              {phone || 'No. WA belum terdaftar'}
                            </div>
                          </div>
                          {valid ? (
                            <a
                              href={buildWhatsAppClickToChatUrl(phone, broadcastMessage).url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn-3d-success px-3 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                            >
                              <Send className="w-3 h-3" />
                              <span>Kirim WA</span>
                            </a>
                          ) : (
                            <span className="text-[10.5px] text-[#7d7484] italic shrink-0">No WA N/A</span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-[#f8f1ff] dark:bg-[#261942] border-t border-[#e8ddff] dark:border-[#35105E] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsBroadcastOpen(false)}
                className="btn-3d-secondary px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
