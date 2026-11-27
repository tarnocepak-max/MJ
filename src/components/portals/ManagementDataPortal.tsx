import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket } from '../../types/index.ts';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { DropdownActionItem } from '../common/ActionDropdownMenu';
import { TableSelectionToolbar } from '../common/TableSelectionToolbar';
import { SortState, getNextSortDirection, sortDataArray } from '../../utils/tableSorting';
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
  ArrowUpRight
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { parseAppointmentDate, formatAppointmentDateDisplay, getOperationalTodayDate, matchesScheduleDateFilter, ScheduleDateFilterMode } from '../../services/appointmentDateParser';
import { StatusAgentBadge, StatusInstallerBadge } from '../common/Badge';
import { navigateToDataDeletion } from '../../services/deletionManagementService';
import { downloadProductionBackup } from '../../services/backupDownloadService';

interface ManagementDataPortalProps {
  onSelectTicket?: (ticket: Ticket, defaultTab?: 'overview' | 'report' | 'chat' | 'history') => void;
  onOpenWhatsApp?: (ticket: Ticket) => void;
}

export type ManagementQualityFilterKey =
  | 'ALL'
  | 'VALID'
  | 'PROBLEMATIC'
  | 'DUPLICATE'
  | 'MISSING_DATE'
  | 'AWAITING_VALIDATION';

export const MANAGEMENT_QUALITY_LABELS: Record<ManagementQualityFilterKey, string> = {
  ALL: 'Total WO (Semua Record Aktif)',
  VALID: 'Data Valid',
  PROBLEMATIC: 'Data Bermasalah',
  DUPLICATE: 'Duplikat WO',
  MISSING_DATE: 'Tanpa Jadwal (Appointment Kosong)',
  AWAITING_VALIDATION: 'Menunggu Validasi / Penugasan'
};

export interface TicketQualityEvaluation {
  isValid: boolean;
  isProblematic: boolean;
  isDuplicate: boolean;
  isMissingDate: boolean;
  isAwaitingValidation: boolean;
}

export function evaluateManagementWoQuality(tickets: Ticket[]) {
  const activeTickets = (tickets || []).filter(t => !t.isDeleted && !t.isArchived);
  let validCount = 0;
  let problematicCount = 0;
  let duplicateCount = 0;
  let missingAppointmentDateCount = 0;
  let awaitingValidationCount = 0;

  const seenWo = new Set<string>();
  const flagsById = new Map<string, TicketQualityEvaluation>();

  activeTickets.forEach(t => {
    let isProblematic = false;
    let isDuplicate = false;
    let isMissingDate = false;

    const wo = (t.woNumber || '').trim().toUpperCase();
    if (wo && seenWo.has(wo)) {
      duplicateCount++;
      isDuplicate = true;
      isProblematic = true;
    } else if (wo) {
      seenWo.add(wo);
    }

    const cid = (t.idCustomer || t.customerId || '').trim();
    const isValidCid = /^[0-9]{7}$/.test(cid);
    if (!isValidCid) {
      isProblematic = true;
    }

    const appDateRes = parseAppointmentDate(t.appointmentDate);
    if (appDateRes.isEmpty || !appDateRes.date) {
      missingAppointmentDateCount++;
      isMissingDate = true;
    } else if (!appDateRes.isValid) {
      isProblematic = true;
    }

    if (!t.contactorName && !t.contractorName) {
      isProblematic = true;
    }

    if (isProblematic) {
      problematicCount++;
    } else {
      validCount++;
    }

    const isAwaitingValidation = t.statusWOAgent === 'Pending' || t.statusWOInstaller === 'Unassigned';
    if (isAwaitingValidation) {
      awaitingValidationCount++;
    }

    flagsById.set(t.id, {
      isValid: !isProblematic,
      isProblematic,
      isDuplicate,
      isMissingDate,
      isAwaitingValidation
    });
  });

  return {
    metrics: {
      total: activeTickets.length,
      validCount,
      problematicCount,
      duplicateCount,
      missingAppointmentDateCount,
      awaitingValidationCount
    },
    flagsById
  };
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
  const [qualityFilter, setQualityFilter] = useState<ManagementQualityFilterKey>('ALL');
  const [isQualityKpiBannerActive, setIsQualityKpiBannerActive] = useState(false);

  // Search & Filter state for WO Data tab
  const [searchWo, setSearchWo] = useState('');
  const [searchCustomerId, setSearchCustomerId] = useState('');
  const [searchCustomerName, setSearchCustomerName] = useState('');
  const [selectedContractor, setSelectedContractor] = useState('ALL');
  const [selectedArea, setSelectedArea] = useState('ALL');
  const [exactAppointmentDate, setExactAppointmentDate] = useState('');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [sortState, setSortState] = useState<SortState>({ column: null, direction: null });
  const [canonicalSearch, setCanonicalSearch] = useState('');
  const [canonicalCategoryFilter, setCanonicalCategoryFilter] = useState('ALL');
  const [canonicalSortState, setCanonicalSortState] = useState<SortState>({ column: null, direction: null });
  const [woPage, setWoPage] = useState(1);
  const [woPageSize, setWoPageSize] = useState(20);

  // Selected ticket for quality review
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  // WO Selection for centralized Data Deletion redirect
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  // Metrics & row-level quality flags computation for Dashboard Data + Data WO filter parity
  const { metrics, flagsById } = useMemo(() => evaluateManagementWoQuality(tickets), [tickets]);

  // Filtered tickets in Data WO tab
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      if (t.isArchived || t.isDeleted) return false;

      if (qualityFilter !== 'ALL') {
        const qFlags = flagsById.get(t.id);
        if (!qFlags) return false;
        if (qualityFilter === 'VALID' && !qFlags.isValid) return false;
        if (qualityFilter === 'PROBLEMATIC' && !qFlags.isProblematic) return false;
        if (qualityFilter === 'DUPLICATE' && !qFlags.isDuplicate) return false;
        if (qualityFilter === 'MISSING_DATE' && !qFlags.isMissingDate) return false;
        if (qualityFilter === 'AWAITING_VALIDATION' && !qFlags.isAwaitingValidation) return false;
      }

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
        const contr = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
        if (contr !== selectedContractor.toLowerCase()) return false;
      }

      if (selectedArea !== 'ALL' && t.area !== selectedArea) {
        return false;
      }

      if (exactAppointmentDate || customStartDate || customEndDate) {
        const parsed = parseAppointmentDate(t.appointmentDate);
        const ticketDate = parsed.date || '';
        if (!ticketDate) return false;
        if (exactAppointmentDate && ticketDate !== exactAppointmentDate) return false;
        if (customStartDate && ticketDate < customStartDate) return false;
        if (customEndDate && ticketDate > customEndDate) return false;
      }

      return true;
    });
  }, [tickets, qualityFilter, flagsById, searchWo, searchCustomerId, searchCustomerName, selectedContractor, selectedArea, exactAppointmentDate, customStartDate, customEndDate]);

  const sortedTickets = useMemo(() => {
    return sortDataArray(filteredTickets, sortState, (t: Ticket, col: string) => {
      if (col === 'woNumber') return t.woNumber;
      if (col === 'customerId') return t.idCustomer || t.customerId || null;
      if (col === 'customerName') return t.customerName || null;
      if (col === 'appointmentDate') {
        const parsed = parseAppointmentDate(t.appointmentDate);
        return parsed.date || t.appointmentDate || null;
      }
      if (col === 'slotTime') return t.slotTime || null;
      if (col === 'contractor') return t.contactorName || t.contractorName || null;
      if (col === 'area') return t.area || null;
      if (col === 'statusAgent') return t.statusWOAgent || null;
      if (col === 'statusInstaller') return t.statusWOInstaller || null;
      return (t as any)[col];
    });
  }, [filteredTickets, sortState]);

  const handleSortWo = (colKey: string) => {
    setSortState(prev => {
      const nextDir = getNextSortDirection(prev.column, prev.direction, colKey);
      return { column: nextDir ? colKey : null, direction: nextDir };
    });
    setWoPage(1);
  };

  const woActiveFilterCount =
    (qualityFilter !== 'ALL' ? 1 : 0) +
    (searchWo.trim() ? 1 : 0) +
    (searchCustomerId.trim() ? 1 : 0) +
    (searchCustomerName.trim() ? 1 : 0) +
    (selectedContractor !== 'ALL' ? 1 : 0) +
    (selectedArea !== 'ALL' ? 1 : 0) +
    (exactAppointmentDate || customStartDate || customEndDate ? 1 : 0);

  const resetWoFilters = () => {
    setQualityFilter('ALL');
    setIsQualityKpiBannerActive(false);
    setSearchWo('');
    setSearchCustomerId('');
    setSearchCustomerName('');
    setSelectedContractor('ALL');
    setSelectedArea('ALL');
    setExactAppointmentDate('');
    setCustomStartDate('');
    setCustomEndDate('');
    setWoPage(1);
  };

  const handleQualityKpiDrillDown = (key: ManagementQualityFilterKey) => {
    setSearchWo('');
    setSearchCustomerId('');
    setSearchCustomerName('');
    setSelectedContractor('ALL');
    setSelectedArea('ALL');
    setExactAppointmentDate('');
    setCustomStartDate('');
    setCustomEndDate('');
    setQualityFilter(key);
    setIsQualityKpiBannerActive(true);
    setWoPage(1);
    setActiveTab('wo_data');
  };

  // Unique areas & contractors from live data
  const areas = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach(t => { if (t.area?.trim()) set.add(t.area.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const contractorOptions = useMemo(() => {
    const set = new Set<string>();
    contractors.forEach(c => { if (c.name?.trim()) set.add(c.name.trim()); });
    tickets.forEach(t => {
      const name = (t.contactorName || t.contractorName || '').trim();
      if (name) set.add(name);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b)).map(name => ({ value: name, label: name }));
  }, [contractors, tickets]);

  useEffect(() => {
    setWoPage(1);
  }, [searchWo, searchCustomerId, searchCustomerName, selectedContractor, selectedArea, exactAppointmentDate, customStartDate, customEndDate]);

  const effectiveWoPageSize = woPageSize === -1 ? Math.max(1, sortedTickets.length) : woPageSize;
  const totalWoPages = Math.max(1, Math.ceil(sortedTickets.length / effectiveWoPageSize));
  const safeWoPage = Math.min(woPage, totalWoPages);
  const paginatedWoTickets = useMemo(() => {
    if (woPageSize === -1) return sortedTickets;
    const start = (safeWoPage - 1) * woPageSize;
    return sortedTickets.slice(start, start + woPageSize);
  }, [sortedTickets, safeWoPage, woPageSize]);

  const filteredCanonicalFields = useMemo(() => {
    const q = canonicalSearch.trim().toLowerCase();
    const list = canonicalFields.filter(f => {
      if (canonicalCategoryFilter !== 'ALL' && f.category !== canonicalCategoryFilter) return false;
      if (q) {
        const hay = `${f.canonicalField} ${f.displayLabel} ${f.aliases.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return sortDataArray(list, canonicalSortState, (f, col) => (f as any)[col] ?? null);
  }, [canonicalFields, canonicalSearch, canonicalCategoryFilter, canonicalSortState]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header Banner */}
      <div className={`bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col justify-between gap-4 ${isCompactUI ? '' : 'md:flex-row md:items-center'}`}>
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-sky-950/50 border border-blue-200 dark:border-sky-800/60 rounded-full text-[#2563EB] dark:text-[#38BDF8] text-[11px] font-bold mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#38BDF8]" />
            <span>Portal Pengelolaan &amp; Validasi Data (Superadmin)</span>
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
          {currentUser.role === 'super_admin' && (
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
          {/* Metrics Grid (Interactive KPI → Direct to Data WO Table) */}
          <div className={`grid gap-3 sm:gap-3.5 ${isCompactUI ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'}`}>
            <button
              type="button"
              onClick={() => handleQualityKpiDrillDown('ALL')}
              className="p-3.5 sm:p-4 bg-white dark:bg-[#0F172A] hover:border-[#2563EB]/60 dark:hover:border-[#38BDF8]/60 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs text-left transition-all cursor-pointer active:scale-[0.985]"
              title="Lihat seluruh WO pada Data WO"
            >
              <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase flex items-center justify-between gap-1">
                <span>Total WO</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-[#0F172A] dark:text-white mt-1">{metrics.total}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Seluruh master record</div>
            </button>

            <button
              type="button"
              onClick={() => handleQualityKpiDrillDown('VALID')}
              className="p-3.5 sm:p-4 bg-emerald-50/70 dark:bg-emerald-950/30 hover:border-emerald-400 dark:hover:border-emerald-600 rounded-2xl border border-emerald-200 dark:border-emerald-800/70 shadow-xs text-left transition-all cursor-pointer active:scale-[0.985]"
              title="Filter Data WO dengan status Valid"
            >
              <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 uppercase flex items-center justify-between gap-1">
                <span>Data Valid</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-1">{metrics.validCount}</div>
              <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">Sesuai aturan data</div>
            </button>

            <button
              type="button"
              onClick={() => handleQualityKpiDrillDown('PROBLEMATIC')}
              className="p-3.5 sm:p-4 bg-amber-50/70 dark:bg-amber-950/30 hover:border-amber-400 dark:hover:border-amber-600 rounded-2xl border border-amber-200 dark:border-amber-800/70 shadow-xs text-left transition-all cursor-pointer active:scale-[0.985]"
              title="Filter Data WO yang Bermasalah"
            >
              <div className="text-[11px] font-bold text-amber-700 dark:text-amber-300 uppercase flex items-center justify-between gap-1">
                <span>Bermasalah</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-amber-700 dark:text-amber-300 mt-1">{metrics.problematicCount}</div>
              <div className="text-[10px] text-amber-600/80 dark:text-amber-400/80 mt-0.5">Perlu koreksi staf</div>
            </button>

            <button
              type="button"
              onClick={() => handleQualityKpiDrillDown('DUPLICATE')}
              className="p-3.5 sm:p-4 bg-rose-50/70 dark:bg-rose-950/30 hover:border-rose-400 dark:hover:border-rose-600 rounded-2xl border border-rose-200 dark:border-rose-800/70 shadow-xs text-left transition-all cursor-pointer active:scale-[0.985]"
              title="Filter Data WO Duplikat"
            >
              <div className="text-[11px] font-bold text-rose-700 dark:text-rose-300 uppercase flex items-center justify-between gap-1">
                <span>Duplikat WO</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-rose-700 dark:text-rose-300 mt-1">{metrics.duplicateCount}</div>
              <div className="text-[10px] text-rose-600/80 dark:text-rose-400/80 mt-0.5">Nomor WO ganda</div>
            </button>

            <button
              type="button"
              onClick={() => handleQualityKpiDrillDown('MISSING_DATE')}
              className="p-3.5 sm:p-4 bg-sky-50/70 dark:bg-sky-950/30 hover:border-sky-400 dark:hover:border-sky-600 rounded-2xl border border-sky-200 dark:border-sky-800/70 shadow-xs text-left transition-all cursor-pointer active:scale-[0.985]"
              title="Filter Data WO Tanpa Jadwal"
            >
              <div className="text-[11px] font-bold text-sky-700 dark:text-sky-300 uppercase flex items-center justify-between gap-1">
                <span>Tanpa Jadwal</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-sky-700 dark:text-sky-300 mt-1">{metrics.missingAppointmentDateCount}</div>
              <div className="text-[10px] text-sky-600/80 dark:text-sky-400/80 mt-0.5">Appointment kosong</div>
            </button>

            <button
              type="button"
              onClick={() => handleQualityKpiDrillDown('AWAITING_VALIDATION')}
              className="p-3.5 sm:p-4 bg-blue-50/70 dark:bg-blue-950/30 hover:border-blue-400 dark:hover:border-sky-600 rounded-2xl border border-blue-200 dark:border-blue-800/70 shadow-xs text-left transition-all cursor-pointer active:scale-[0.985]"
              title="Filter Data WO Menunggu Validasi"
            >
              <div className="text-[11px] font-bold text-[#2563EB] dark:text-[#38BDF8] uppercase flex items-center justify-between gap-1">
                <span className="truncate">Menunggu Validasi</span>
                <ArrowUpRight className="w-3.5 h-3.5 opacity-60 shrink-0" />
              </div>
              <div className="text-2xl font-extrabold font-mono tabular-nums text-[#2563EB] dark:text-[#38BDF8] mt-1">{metrics.awaitingValidationCount}</div>
              <div className="text-[10px] text-blue-600/80 dark:text-sky-400/80 mt-0.5">Pending penugasan</div>
            </button>
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
          {(qualityFilter !== 'ALL' || isQualityKpiBannerActive) && (
            <div className="rounded-xl bg-blue-50/90 dark:bg-sky-950/40 border border-blue-200 dark:border-sky-800/70 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-[#2563EB] dark:bg-sky-600 text-white font-bold text-[10.5px]">
                  Filter KPI Dashboard
                </span>
                <span className="font-bold text-[#0F172A] dark:text-white">
                  {MANAGEMENT_QUALITY_LABELS[qualityFilter]}
                </span>
                <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8] tabular-nums">
                  ({filteredTickets.length} WO ditemukan)
                </span>
              </div>
              <button
                type="button"
                onClick={resetWoFilters}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white dark:bg-[#1E293B] border border-blue-200 dark:border-sky-700 text-[#0F172A] dark:text-white font-bold hover:bg-blue-100/60 dark:hover:bg-sky-900/50 cursor-pointer transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>Tampilkan Semua Data</span>
              </button>
            </div>
          )}
          <ResponsiveDataTable<Ticket>
            data={paginatedWoTickets}
            getRowKey={t => t.id}
            sortKey={sortState.column}
            sortDirection={sortState.direction}
            onSort={handleSortWo}
            activeFilterCount={woActiveFilterCount}
            onResetFilters={resetWoFilters}
            selectionToolbar={
              <TableSelectionToolbar
                selectedCount={selectedIds.size}
                label="Work Order dipilih"
                onClearSelection={() => setSelectedIds(new Set())}
                className="mb-1"
              >
                <button
                  type="button"
                  onClick={() => {
                    const selectedList = sortedTickets.filter(t => selectedIds.has(t.id));
                    navigateToDataDeletion({
                      category: 'work_orders',
                      mode: 'soft_delete',
                      search: selectedList.length === 1 ? selectedList[0].woNumber : ''
                    });
                  }}
                  className="btn-3d-primary min-h-[36px] px-3.5 py-1.5 font-bold rounded-lg flex items-center gap-1.5 text-xs cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Kelola di Data Deletion</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </TableSelectionToolbar>
            }
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
                sortable: true,
                headerControl: {
                  kind: 'search',
                  value: searchWo,
                  onChange: setSearchWo,
                  placeholder: 'Cari WO Number...'
                },
                render: t => <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8]">{t.woNumber}</span>
              },
              {
                key: 'customerId',
                label: 'Customer ID',
                priority: 'hidden_mobile',
                sortable: true,
                headerControl: {
                  kind: 'search',
                  value: searchCustomerId,
                  onChange: setSearchCustomerId,
                  placeholder: 'Cari Customer ID...'
                },
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
                sortable: true,
                headerControl: {
                  kind: 'search',
                  value: searchCustomerName,
                  onChange: setSearchCustomerName,
                  placeholder: 'Cari Nama Pelanggan...'
                },
                render: t => <span className="font-semibold text-slate-800 dark:text-slate-200">{t.customerName}</span>
              },
              {
                key: 'appointmentDate',
                label: 'Appointment Date',
                priority: 'primary',
                sortable: true,
                headerControl: {
                  kind: 'date',
                  exactDate: exactAppointmentDate,
                  dateFrom: customStartDate,
                  dateTo: customEndDate,
                  supportsExactDate: true,
                  onChangeDates: next => {
                    setExactAppointmentDate(next.exactDate);
                    setCustomStartDate(next.dateFrom);
                    setCustomEndDate(next.dateTo);
                  }
                },
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
                sortable: true,
                render: t => <span className="text-slate-500 whitespace-nowrap">{t.slotTime || '-'}</span>
              },
              {
                key: 'contractor',
                label: 'Kontraktor',
                priority: 'secondary',
                sortable: true,
                headerControl: {
                  kind: 'select',
                  value: selectedContractor,
                  defaultValue: 'ALL',
                  allLabel: 'Semua Kontraktor',
                  options: contractorOptions,
                  onChange: setSelectedContractor
                },
                render: t => <span className="text-slate-700 dark:text-slate-300">{t.contactorName || t.contractorName || '-'}</span>
              },
              {
                key: 'area',
                label: 'Area',
                priority: 'secondary',
                sortable: true,
                headerControl: {
                  kind: 'select',
                  value: selectedArea,
                  defaultValue: 'ALL',
                  allLabel: 'Semua Area',
                  options: areas.map(a => ({ value: a, label: a })),
                  onChange: setSelectedArea
                },
                render: t => <span className="text-slate-500">{t.area || '-'}</span>
              },
              {
                key: 'statusAgent',
                label: 'Status Agent',
                priority: 'hidden_mobile',
                sortable: true,
                render: t => <StatusAgentBadge status={t.statusWOAgent} />
              },
              {
                key: 'statusInstaller',
                label: 'Status Lapangan',
                priority: 'hidden_mobile',
                sortable: true,
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
              return actions;
            }}
            renderDesktopActions={t => (
              <button
                type="button"
                onClick={() => (onSelectTicket ? onSelectTicket(t) : navigateToDataDeletion({ category: 'work_orders', search: t.woNumber }))}
                className="px-2 py-1 bg-[#F0EDFF] hover:bg-[#6657C8] text-[#5145A6] hover:text-white dark:bg-[#27104A] dark:hover:bg-[#7135b5] dark:text-[#D8B4FE] dark:hover:text-white rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1 font-semibold text-[11px]"
                title="Lihat Detail Work Order"
              >
                <Eye className="w-3 h-3" />
                <span>Detail</span>
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
            data={filteredCanonicalFields}
            getRowKey={f => f.canonicalField}
            maxTableHeightClass="max-h-96"
            sortKey={canonicalSortState.column}
            sortDirection={canonicalSortState.direction}
            onSort={colKey => {
              setCanonicalSortState(prev => {
                const nextDir = getNextSortDirection(prev.column, prev.direction, colKey);
                return { column: nextDir ? colKey : null, direction: nextDir };
              });
            }}
            activeFilterCount={(canonicalSearch.trim() ? 1 : 0) + (canonicalCategoryFilter !== 'ALL' ? 1 : 0)}
            onResetFilters={() => {
              setCanonicalSearch('');
              setCanonicalCategoryFilter('ALL');
            }}
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
                sortable: true,
                headerControl: {
                  kind: 'search',
                  value: canonicalSearch,
                  onChange: setCanonicalSearch,
                  placeholder: 'Cari field / alias...'
                },
                render: f => <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8]">{f.canonicalField}</span>
              },
              {
                key: 'displayLabel',
                label: 'Display Label',
                priority: 'hidden_mobile',
                sortable: true,
                render: f => <span className="font-medium text-slate-800 dark:text-slate-200">{f.displayLabel}</span>
              },
              {
                key: 'category',
                label: 'Kategori',
                priority: 'primary',
                sortable: true,
                headerControl: {
                  kind: 'select',
                  value: canonicalCategoryFilter,
                  defaultValue: 'ALL',
                  allLabel: 'Semua Kategori',
                  options: Array.from(new Set(canonicalFields.map(cf => cf.category).filter(Boolean))).map(c => ({
                    value: c,
                    label: c
                  })),
                  onChange: setCanonicalCategoryFilter
                },
                render: f => <span className="capitalize text-slate-500">{f.category}</span>
              },
              {
                key: 'dataType',
                label: 'Tipe Data',
                priority: 'primary',
                sortable: true,
                render: f => <span className="font-mono text-slate-500">{f.dataType}</span>
              },
              {
                key: 'required',
                label: 'Status',
                priority: 'hidden_mobile',
                sortable: true,
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
    </div>
  );
};
