import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket } from '../../types/index.ts';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { DropdownActionItem } from '../common/ActionDropdownMenu';
import {
  Database,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  ShieldCheck,
  AlertCircle,
  Clock,
  Sparkles,
  Download,
  Calendar,
  Layers,
  ArrowRight,
  Eye,
  Check,
  X,
  FileCheck,
  BarChart3,
  Building2,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { parseAppointmentDate, formatAppointmentDateDisplay, getOperationalTodayDate, matchesScheduleDateFilter, ScheduleDateFilterMode } from '../../services/appointmentDateParser';
import { StatusAgentBadge, StatusInstallerBadge } from '../common/Badge';
import { ManagementDataDeleteModal } from './ManagementDataDeleteModal';
import { downloadProductionBackup } from '../../services/backupDownloadService';

interface ManagementDataPortalProps {
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

export const ManagementDataPortal: React.FC<ManagementDataPortalProps> = ({
  onSelectTicket,
  onOpenWhatsApp
}) => {
  const {
    tickets,
    contractors,
    currentUser,
    todayWIB,
    headerMappings,
    canonicalFields,
    updateTicket
  } = useApp();
  const { isCompactUI } = useResponsiveViewport();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'dashboard' | 'wo_data' | 'import_validation' | 'quality_monitoring'>('dashboard');

  // Search & Filter state for WO Data tab (Defaults to active today WIB)
  const [searchWo, setSearchWo] = useState('');
  const [searchCustomerId, setSearchCustomerId] = useState('');
  const [searchCustomerName, setSearchCustomerName] = useState('');
  const [selectedContractor, setSelectedContractor] = useState('ALL');
  const [selectedArea, setSelectedArea] = useState('ALL');
  const [dateFilterMode, setDateFilterMode] = useState<ScheduleDateFilterMode>('today');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [woPage, setWoPage] = useState(1);
  const [woPageSize, setWoPageSize] = useState(20);

  // Selected ticket for quality review
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  // WO Selection for Deletion (Requirement 5: Management Data Exclusive)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [ticketToDelete, setTicketToDelete] = useState<Ticket | null>(null);
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);

  const handleDownloadBackup = async () => {
    setIsDownloadingBackup(true);
    try {
      const res = await downloadProductionBackup();
      if (res.success) {
        toast.success(`Backup database (${res.size?.toLocaleString()} bytes) berhasil diverifikasi dan diunduh.`);
      } else {
        toast.error(res.error || 'Gagal mengunduh file backup database');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Terjadi kesalahan saat mengunduh backup');
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  // Operational Date from reactive Asia/Jakarta todayWIB (auto-resets at 00:00 WIB)
  const operationalDate = todayWIB || getOperationalTodayDate();

  // Metrics computation for Dashboard Data
  const metrics = useMemo(() => {
    const activeTickets = tickets.filter(t => !t.isDeleted);
    let total = activeTickets.length;
    let validCount = 0;
    let problematicCount = 0;
    let duplicateCount = 0;
    let missingAppointmentDateCount = 0;
    let awaitingValidationCount = 0;

    const seenWo = new Set<string>();

    activeTickets.forEach(t => {
      let isProblematic = false;

      // 1. Check WO uniqueness
      const wo = (t.woNumber || '').trim().toUpperCase();
      if (seenWo.has(wo)) {
        duplicateCount++;
        isProblematic = true;
      } else {
        seenWo.add(wo);
      }

      // 2. Check Customer ID 7 digit
      const cid = (t.idCustomer || t.customerId || '').trim();
      const isValidCid = /^[0-9]{7}$/.test(cid);
      if (!isValidCid) {
        isProblematic = true;
      }

      // 3. Check Appointment Date
      const appDateRes = parseAppointmentDate(t.appointmentDate);
      if (appDateRes.isEmpty || !appDateRes.date) {
        missingAppointmentDateCount++;
      } else if (!appDateRes.isValid) {
        isProblematic = true;
      }

      // 4. Contractor mapping
      if (!t.contactorName && !t.contractorName) {
        isProblematic = true;
      }

      if (isProblematic) {
        problematicCount++;
      } else {
        validCount++;
      }

      if (t.statusWOAgent === 'Pending' || t.statusWOInstaller === 'Unassigned') {
        awaitingValidationCount++;
      }
    });

    return {
      total,
      validCount,
      problematicCount,
      duplicateCount,
      missingAppointmentDateCount,
      awaitingValidationCount
    };
  }, [tickets]);

  // Filtered tickets in Data WO tab
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      if (t.isArchived || t.isDeleted) return false;

      if (searchWo && !String(t.woNumber ?? '').toLowerCase().includes(searchWo.toLowerCase().trim())) {
        return false;
      }

      if (searchCustomerId) {
        const cid = String(t.idCustomer || t.customerId || '').toLowerCase();
        if (!cid.includes(searchCustomerId.toLowerCase().trim())) return false;
      }

      if (searchCustomerName && !String(t.customerName ?? '').toLowerCase().includes(searchCustomerName.toLowerCase().trim())) {
        return false;
      }

      if (selectedContractor !== 'ALL') {
        const contr = String(t.contactorName || t.contractorName || '').toLowerCase();
        if (!contr.includes(selectedContractor.toLowerCase())) return false;
      }

      if (selectedArea !== 'ALL' && t.area !== selectedArea) {
        return false;
      }

      // Schedule appointment date filter
      if (dateFilterMode !== 'all') {
        const matches = matchesScheduleDateFilter(
          t.appointmentDate,
          dateFilterMode,
          operationalDate,
          { start: customStartDate, end: customEndDate }
        );
        if (!matches) return false;
      }

      return true;
    });
  }, [tickets, searchWo, searchCustomerId, searchCustomerName, selectedContractor, selectedArea, dateFilterMode, operationalDate, customStartDate, customEndDate]);

  // Unique areas
  const areas = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach(t => { if (t.area) set.add(t.area); });
    return Array.from(set);
  }, [tickets]);

  useEffect(() => {
    setWoPage(1);
  }, [searchWo, searchCustomerId, searchCustomerName, selectedContractor, selectedArea, dateFilterMode, customStartDate, customEndDate]);

  const effectiveWoPageSize = woPageSize === -1 ? Math.max(1, filteredTickets.length) : woPageSize;
  const totalWoPages = Math.max(1, Math.ceil(filteredTickets.length / effectiveWoPageSize));
  const safeWoPage = Math.min(woPage, totalWoPages);
  const paginatedWoTickets = useMemo(() => {
    if (woPageSize === -1) return filteredTickets;
    const start = (safeWoPage - 1) * woPageSize;
    return filteredTickets.slice(start, start + woPageSize);
  }, [filteredTickets, safeWoPage, woPageSize]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Banner */}
      <div className={`bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col justify-between gap-4 ${isCompactUI ? '' : 'md:flex-row md:items-center'}`}>
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-sky-950/50 border border-blue-200 dark:border-sky-800/60 rounded-full text-[#2563EB] dark:text-[#38BDF8] text-[11px] font-bold mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#38BDF8]" />
            <span>Portal Khusus Role Management Data</span>
          </div>
          <h2 className="text-lg sm:text-2xl font-extrabold text-[#0F172A] dark:text-white tracking-tight flex items-center gap-2">
            <FileCheck className="w-5 h-5 sm:w-6 sm:h-6 text-[#2563EB] dark:text-[#38BDF8] shrink-0" />
            <span>Manajemen &amp; Validasi Data Operasional</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
            Pusat kendali kualitas data, validasi ID 7-digit, audit duplikasi, verifikasi jadwal appointment, dan audit impor Work Order.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 min-w-0">
          {(currentUser.role === 'super_admin' || currentUser.role === 'management_data') && (
            <button
              type="button"
              onClick={handleDownloadBackup}
              disabled={isDownloadingBackup}
              className="min-h-[44px] sm:min-h-[38px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-[0.98] shrink-0"
              title="Unduh arsip cadangan produksi historis (JSON)"
            >
              {isDownloadingBackup ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Mengunduh Backup...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-white" />
                  <span>Download Backup Database</span>
                </>
              )}
            </button>
          )}

          {/* Tab Switcher */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar p-1 bg-slate-100 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`shrink-0 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-white dark:bg-[#0F172A] text-[#2563EB] dark:text-[#38BDF8] shadow-xs font-bold border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Dashboard Data
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('wo_data')}
              className={`shrink-0 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeTab === 'wo_data'
                  ? 'bg-white dark:bg-[#0F172A] text-[#2563EB] dark:text-[#38BDF8] shadow-xs font-bold border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Data WO ({filteredTickets.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('import_validation')}
              className={`shrink-0 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeTab === 'import_validation'
                  ? 'bg-white dark:bg-[#0F172A] text-[#2563EB] dark:text-[#38BDF8] shadow-xs font-bold border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Import &amp; Validasi
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('quality_monitoring')}
              className={`shrink-0 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                activeTab === 'quality_monitoring'
                  ? 'bg-white dark:bg-[#0F172A] text-[#2563EB] dark:text-[#38BDF8] shadow-xs font-bold border border-slate-200/80 dark:border-slate-700'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Kualitas Data
            </button>
          </div>
        </div>
      </div>

      {/* 1. TAB: DASHBOARD DATA */}
      {activeTab === 'dashboard' && (
        <div className="space-y-4 sm:space-y-6">
          {/* Metrics Grid */}
          <div className={`grid gap-3 sm:gap-3.5 ${isCompactUI ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>
            <div className="p-3.5 sm:p-4 bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase">Total WO</div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-[#0F172A] dark:text-white mt-1">{metrics.total}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Seluruh master record</div>
            </div>

            <div className="p-3.5 sm:p-4 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-2xl border border-emerald-200 dark:border-emerald-800/70 shadow-xs">
              <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase">Data Valid</div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">{metrics.validCount}</div>
              <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">Sesuai aturan data</div>
            </div>

            <div className="p-3.5 sm:p-4 bg-amber-50/70 dark:bg-amber-950/30 rounded-2xl border border-amber-200 dark:border-amber-800/70 shadow-xs">
              <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase">Bermasalah</div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-amber-700 dark:text-amber-300 mt-1">{metrics.problematicCount}</div>
              <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-0.5">Perlu koreksi staf</div>
            </div>

            <div className="p-3.5 sm:p-4 bg-rose-50/70 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-800/70 shadow-xs">
              <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300 uppercase">Duplikat WO</div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-rose-700 dark:text-rose-300 mt-1">{metrics.duplicateCount}</div>
              <div className="text-[10px] text-rose-600/80 dark:text-rose-400/80 mt-0.5">Nomor WO ganda</div>
            </div>

            <div className="p-3.5 sm:p-4 bg-sky-50/70 dark:bg-sky-950/30 rounded-2xl border border-sky-200 dark:border-sky-800/70 shadow-xs">
              <div className="text-[11px] font-bold text-sky-700 dark:text-sky-300 uppercase">Tanpa Jadwal</div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-sky-700 dark:text-sky-300 mt-1">{metrics.missingAppointmentDateCount}</div>
              <div className="text-[10px] text-sky-600/80 dark:text-sky-400/80 mt-0.5">Appointment kosong</div>
            </div>

            <div className="p-3.5 sm:p-4 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-200 dark:border-blue-800/70 shadow-xs">
              <div className="text-[11px] font-bold text-[#2563EB] dark:text-[#38BDF8] uppercase">Menunggu Validasi</div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-[#2563EB] dark:text-[#38BDF8] mt-1">{metrics.awaitingValidationCount}</div>
              <div className="text-[10px] text-blue-600/80 dark:text-sky-400/80 mt-0.5">Pending penugasan</div>
            </div>
          </div>

          {/* Quick Quality Summary & Instructions */}
          <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8]" />
              <span>Standar Kebijakan Integritas Data MoraJaws</span>
            </h3>

            <div className={`grid gap-3.5 text-xs ${isCompactUI ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-3'}`}>
              <div className="p-4 bg-slate-50 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="font-bold text-[#2563EB] dark:text-[#38BDF8]">1. Customer ID 7 Digit Murni</div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  Customer ID wajib tepat 7 digit numerik tanpa pembulatan ilmiah, prefix, atau sufiks.
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="font-bold text-[#2563EB] dark:text-[#38BDF8]">2. Appointment Date Presisi</div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  Tidak pernah mengasumsikan hari ini atau tanggal upload bila kosong. Format ditampilkan dalam zona waktu Indonesia (WIB).
                </p>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-700 space-y-1.5">
                <div className="font-bold text-[#2563EB] dark:text-[#38BDF8]">3. WO Number Unik (Zero Duplicate)</div>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  Satu nomor WO merepresentasikan satu pekerjaan tunggal. Duplikasi tidak diizinkan menimpa tanpa persetujuan khusus.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. TAB: DATA WO */}
      {activeTab === 'wo_data' && (
        <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-4">
          {/* Search Filters Row */}
          <div className={`grid gap-2.5 sm:gap-3 text-xs ${isCompactUI ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5'}`}>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari WO Number..."
                value={searchWo}
                onChange={e => setSearchWo(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] pl-8 pr-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Cari Customer ID (7 digit)..."
                value={searchCustomerId}
                onChange={e => setSearchCustomerId(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <div className="relative">
              <input
                type="text"
                placeholder="Cari Nama Pelanggan..."
                value={searchCustomerName}
                onChange={e => setSearchCustomerName(e.target.value)}
                className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
              />
            </div>

            <select
              value={selectedContractor}
              onChange={e => setSelectedContractor(e.target.value)}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <option value="ALL">Semua Mitra Kontraktor</option>
              {contractors.map((c, cIdx) => (
                <option key={`mgmt-contractor-${c.id || c.name}-${cIdx}`} value={c.name}>{c.name}</option>
              ))}
            </select>

            <select
              value={dateFilterMode}
              onChange={e => setDateFilterMode(e.target.value as ScheduleDateFilterMode)}
              className="w-full min-h-[44px] sm:min-h-[38px] px-3 py-2 bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
            >
              <option value="all">Semua Tanggal Appointment</option>
              <option value="today">Hari Ini ({operationalDate})</option>
              <option value="previous">Sebelumnya (Lewat)</option>
              <option value="upcoming">Mendatang</option>
              <option value="custom">Rentang Tanggal Khusus</option>
            </select>
          </div>

          {/* Custom Date Range if mode is custom */}
          {dateFilterMode === 'custom' && (
            <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
              <Calendar className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8] shrink-0" />
              <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                <span className="shrink-0 font-medium text-slate-600 dark:text-slate-300">Mulai:</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={e => setCustomStartDate(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] px-2.5 py-1 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-[160px]">
                <span className="shrink-0 font-medium text-slate-600 dark:text-slate-300">Sampai:</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={e => setCustomEndDate(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-[38px] px-2.5 py-1 bg-white dark:bg-[#0F172A] border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* Bulk Action Bar for Management Data Deletion */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs">
              <span className="font-bold text-rose-800 dark:text-rose-200">
                {selectedIds.size} Work Order terpilih untuk tindakan penghapusan
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsBulkDeleteModalOpen(true)}
                  className="min-h-[44px] sm:min-h-[38px] px-3.5 py-1.5 font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg flex items-center gap-1.5 shadow-xs cursor-pointer transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus {selectedIds.size} WO Terpilih</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="min-h-[44px] sm:min-h-[38px] px-3 py-1 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white rounded-lg cursor-pointer"
                >
                  Batal
                </button>
              </div>
            </div>
          )}

          <ResponsiveDataTable<Ticket>
            data={paginatedWoTickets}
            getRowKey={t => t.id}
            selectable
            selectedKeys={selectedIds}
            onToggleSelect={key => {
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
            onToggleSelectAll={() => {
              const allVisibleSelected =
                paginatedWoTickets.length > 0 && paginatedWoTickets.every(t => selectedIds.has(t.id));
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (allVisibleSelected) {
                  paginatedWoTickets.forEach(t => next.delete(t.id));
                } else {
                  paginatedWoTickets.forEach(t => next.add(t.id));
                }
                return next;
              });
            }}
            mobileTitle={t => (
              <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8]">
                {t.woNumber} — <span className="font-sans text-[#0F172A] dark:text-white">{t.customerName}</span>
              </span>
            )}
            mobileSubtitle={t => {
              const cid = (t.idCustomer || t.customerId || '').trim();
              const isCid7 = /^[0-9]{7}$/.test(cid);
              return (
                <span className="font-mono">
                  ID:{' '}
                  <strong className={isCid7 ? 'text-slate-800 dark:text-slate-200' : 'text-rose-600'}>
                    {cid || '-'}
                  </strong>{' '}
                  · {t.area || '-'}
                </span>
              );
            }}
            mobileStatus={t => {
              const cid = (t.idCustomer || t.customerId || '').trim();
              const isCid7 = /^[0-9]{7}$/.test(cid);
              const appDateParsed = parseAppointmentDate(t.appointmentDate);
              return (
                <>
                  <StatusAgentBadge status={t.statusWOAgent} />
                  <StatusInstallerBadge status={t.statusWOInstaller} />
                  {isCid7 && appDateParsed.isValid ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Valid</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Review</span>
                    </span>
                  )}
                </>
              );
            }}
            columns={[
              {
                key: 'woNumber',
                label: 'WO Number',
                priority: 'hidden_mobile',
                render: t => <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8]">{t.woNumber}</span>
              },
              {
                key: 'customerId',
                label: 'Customer ID',
                priority: 'hidden_mobile',
                render: t => {
                  const cid = (t.idCustomer || t.customerId || '').trim();
                  const isCid7 = /^[0-9]{7}$/.test(cid);
                  return <span className={`font-mono ${isCid7 ? 'text-slate-800 dark:text-slate-200' : 'text-rose-600 font-bold'}`}>{cid || '-'}</span>;
                }
              },
              {
                key: 'customerName',
                label: 'Nama Pelanggan',
                priority: 'hidden_mobile',
                render: t => <span className="font-semibold text-slate-800 dark:text-slate-200">{t.customerName}</span>
              },
              {
                key: 'appointmentDate',
                label: 'Appointment Date',
                priority: 'primary',
                render: t => {
                  const appDateParsed = parseAppointmentDate(t.appointmentDate);
                  return appDateParsed.date ? (
                    <span className="text-slate-800 dark:text-slate-200 font-medium whitespace-nowrap">
                      {formatAppointmentDateDisplay(appDateParsed.date)}
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 text-[11px] italic">Tanggal belum tersedia</span>
                  );
                }
              },
              {
                key: 'slotTime',
                label: 'Slot Time',
                priority: 'primary',
                render: t => <span className="text-slate-500 whitespace-nowrap">{t.slotTime || '-'}</span>
              },
              {
                key: 'contractor',
                label: 'Kontraktor',
                priority: 'secondary',
                render: t => <span className="text-slate-700 dark:text-slate-300">{t.contactorName || t.contractorName || '-'}</span>
              },
              {
                key: 'area',
                label: 'Area',
                priority: 'secondary',
                render: t => <span className="text-slate-500">{t.area || '-'}</span>
              },
              {
                key: 'statusAgent',
                label: 'Status Agent',
                priority: 'hidden_mobile',
                render: t => <StatusAgentBadge status={t.statusWOAgent} />
              },
              {
                key: 'statusInstaller',
                label: 'Status Lapangan',
                priority: 'hidden_mobile',
                render: t => <StatusInstallerBadge status={t.statusWOInstaller} />
              },
              {
                key: 'integrity',
                label: 'Integritas',
                align: 'center',
                priority: 'hidden_mobile',
                render: t => {
                  const cid = (t.idCustomer || t.customerId || '').trim();
                  const isCid7 = /^[0-9]{7}$/.test(cid);
                  const appDateParsed = parseAppointmentDate(t.appointmentDate);
                  return isCid7 && appDateParsed.isValid ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Valid</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Review</span>
                    </span>
                  );
                }
              }
            ] as ResponsiveColumn<Ticket>[]}
            getRowActions={t => {
              const actions: DropdownActionItem[] = [];
              if (onSelectTicket) {
                actions.push({
                  id: 'detail',
                  label: 'Lihat Detail Tiket',
                  icon: <Eye className="w-3.5 h-3.5" />,
                  onClick: () => onSelectTicket(t)
                });
              }
              actions.push({
                id: 'delete',
                label: 'Hapus Work Order',
                icon: <Trash2 className="w-3.5 h-3.5" />,
                tone: 'danger',
                onClick: () => setTicketToDelete(t)
              });
              return actions;
            }}
            renderDesktopActions={t => (
              <button
                type="button"
                onClick={() => setTicketToDelete(t)}
                className="px-2 py-1 bg-rose-50 hover:bg-rose-600 text-rose-600 hover:text-white dark:bg-rose-950/50 dark:hover:bg-rose-600 dark:text-rose-300 dark:hover:text-white rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 font-semibold text-[11px]"
                title="Hapus Work Order (Khusus Role Management Data)"
              >
                <Trash2 className="w-3 h-3" />
                <span>Hapus</span>
              </button>
            )}
            emptyState={{
              title: 'Tidak ada data WO cocok',
              description: 'Tidak ada data WO yang cocok dengan kriteria filter aktif.'
            }}
            pagination={{
              currentPage: safeWoPage,
              totalPages: totalWoPages,
              totalItems: filteredTickets.length,
              pageSize: woPageSize === -1 ? 'ALL' : woPageSize,
              onPageChange: setWoPage,
              onPageSizeChange: nextSize => {
                setWoPageSize(nextSize === 'ALL' ? -1 : nextSize);
                setWoPage(1);
              },
              pageSizeOptions: [10, 20, 50, 100, 'ALL'],
              itemLabel: 'WO'
            }}
          />
        </div>
      )}

      {/* 3. TAB: IMPORT & VALIDASI */}
      {activeTab === 'import_validation' && (
        <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-4">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8]" />
              <span>Pemeriksaan Mapping Header &amp; Kolom Terdaftar</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Daftar canonical field standard MoraJaws ({canonicalFields.length} field) yang digunakan untuk memvalidasi setiap baris impor.
            </p>
          </div>

          <ResponsiveDataTable
            data={canonicalFields}
            getRowKey={f => f.canonicalField}
            maxTableHeightClass="max-h-96"
            mobileTitle={f => <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8]">{f.canonicalField}</span>}
            mobileSubtitle={f => f.displayLabel}
            mobileStatus={f =>
              f.required ? (
                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 rounded text-[10px] font-bold">
                  Wajib
                </span>
              ) : (
                <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 rounded text-[10px]">
                  Opsional
                </span>
              )
            }
            columns={[
              {
                key: 'canonicalField',
                label: 'Field Canonical',
                priority: 'hidden_mobile',
                render: f => <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8]">{f.canonicalField}</span>
              },
              {
                key: 'displayLabel',
                label: 'Display Label',
                priority: 'hidden_mobile',
                render: f => <span className="font-medium text-slate-800 dark:text-slate-200">{f.displayLabel}</span>
              },
              {
                key: 'category',
                label: 'Kategori',
                priority: 'primary',
                render: f => <span className="capitalize text-slate-500">{f.category}</span>
              },
              {
                key: 'dataType',
                label: 'Tipe Data',
                priority: 'primary',
                render: f => <span className="font-mono text-slate-500">{f.dataType}</span>
              },
              {
                key: 'required',
                label: 'Status',
                priority: 'hidden_mobile',
                render: f =>
                  f.required ? (
                    <span className="px-1.5 py-0.5 bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 rounded text-[10px] font-bold">
                      Wajib
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 rounded text-[10px]">
                      Opsional
                    </span>
                  )
              },
              {
                key: 'aliases',
                label: 'Alias Dikenali',
                priority: 'secondary',
                render: f => (
                  <span className="text-[11px] text-slate-500 max-w-xs block truncate" title={f.aliases.join(', ')}>
                    {f.aliases.join(', ') || '-'}
                  </span>
                ),
                renderMobile: f => <span className="text-[11px] text-slate-500 break-words">{f.aliases.join(', ') || '-'}</span>
              }
            ]}
          />
        </div>
      )}

      {/* 4. TAB: MONITORING KUALITAS DATA */}
      {activeTab === 'quality_monitoring' && (
        <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-xs space-y-4">
          <div className="border-b border-slate-200 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>Antrean Peninjauan Data Bermasalah ({metrics.problematicCount})</span>
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Daftar tiket yang terdeteksi memiliki ketidaklengkapan field, nomor Customer ID non-7 digit, atau tanggal appointment bermasalah.
            </p>
          </div>

          {metrics.problematicCount === 0 ? (
            <div className="p-8 text-center text-xs text-emerald-600 dark:text-emerald-400 space-y-1">
              <CheckCircle2 className="w-8 h-8 mx-auto" />
              <div className="font-bold text-sm">Semua Data Memenuhi Standar Kualitas!</div>
              <div className="text-slate-500 text-xs">Tidak ada anomali duplikasi atau format tidak valid yang terdeteksi.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.filter(t => {
                const isCid7 = /^[0-9]{7}$/.test((t.idCustomer || t.customerId || '').trim());
                const appDate = parseAppointmentDate(t.appointmentDate);
                return !isCid7 || (!appDate.isEmpty && !appDate.isValid);
              }).map(t => {
                const cid = (t.idCustomer || t.customerId || '').trim();
                const isCid7 = /^[0-9]{7}$/.test(cid);
                const appDate = parseAppointmentDate(t.appointmentDate);

                return (
                  <div key={t.id} className="p-3.5 sm:p-4 bg-amber-50/50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 font-mono font-bold text-slate-900 dark:text-white">
                        <span>{t.woNumber}</span>
                        <span className="text-slate-400">·</span>
                        <span className="font-sans font-semibold text-slate-700 dark:text-slate-300">{t.customerName}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>ID Customer: <strong className={isCid7 ? 'text-emerald-600' : 'text-rose-600 font-bold'}>{cid || 'KOSONG'}</strong> ({isCid7 ? 'Valid' : 'Bukan 7 digit'})</span>
                        <span>Appointment Date: <strong className="text-slate-700 dark:text-slate-300">{t.appointmentDate || 'Belum diisi'}</strong> {appDate.error && `(${appDate.error})`}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {!isCid7 && cid.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            // Extract first 7 digits
                            const digits = cid.replace(/\D/g, '').slice(0, 7).padStart(7, '0');
                            updateTicket(t.id, { idCustomer: digits, customerId: digits });
                            toast.success(`Customer ID diperbaiki menjadi ${digits}`, 'ID Disesuaikan');
                          }}
                          className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs cursor-pointer transition-colors"
                        >
                          Auto-Fix 7 Digit
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Management Data Single Ticket Delete Confirmation Modal */}
      {ticketToDelete && (
        <ManagementDataDeleteModal
          isOpen={Boolean(ticketToDelete)}
          onClose={() => setTicketToDelete(null)}
          ticket={ticketToDelete}
          onSuccess={() => setTicketToDelete(null)}
        />
      )}

      {/* Management Data Bulk Delete Confirmation Modal */}
      {isBulkDeleteModalOpen && (
        <ManagementDataDeleteModal
          isOpen={isBulkDeleteModalOpen}
          onClose={() => setIsBulkDeleteModalOpen(false)}
          ticket={null}
          selectedTickets={filteredTickets.filter(t => selectedIds.has(t.id))}
          onSuccess={() => {
            setSelectedIds(new Set());
            setIsBulkDeleteModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
