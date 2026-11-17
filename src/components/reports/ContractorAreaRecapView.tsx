import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import { Ticket } from '../../types';
import {
  Building2,
  MapPin,
  Calendar,
  Search,
  RotateCcw,
  Printer,
  Layers,
  CheckCircle2,
  Clock,
  XCircle,
  UserCheck,
  FileSpreadsheet,
  Filter,
  Radio,
  Gauge,
  PieChart,
  Wrench,
  Home,
  Wifi,
  ChevronDown,
  ChevronUp,
  Download
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  getJakartaDateString,
  getTicketAppointmentDate,
  formatAppointmentDateDisplay
} from '../../services/appointmentDateParser';
import { useToast } from '../../context/ToastContext';
import ftthInspectionImg from '../../assets/images/leader_ftth_inspection_1794890485687.jpg';

interface ContractorRowData {
  contractorName: string;
  totalWO: number;
  assign: number;
  unassign: number;
  complete: number;
  uncomplete: number;
  cancel: number;
}

interface AreaGroupData {
  areaName: string;
  contractors: ContractorRowData[];
  subtotal: ContractorRowData;
}

type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

export const ContractorAreaRecapView: React.FC = () => {
  const { tickets, contractorsList, areasList, currentUser, databaseStatus, todayWIB: contextTodayWIB } = useApp();
  const { isMobileView } = useUIConfig();
  const { toast } = useToast();

  const isLeader = currentUser?.role === 'leader';
  const leaderContractor = currentUser?.contractor || '';
  const leaderArea = currentUser?.area || '';

  const todayWIB = contextTodayWIB || getJakartaDateString(0);

  // Filters: Default to leader contractor & area if leader role
  const [selectedArea, setSelectedArea] = useState<string>(() => (isLeader && leaderArea ? leaderArea : 'ALL'));
  const [selectedContractor, setSelectedContractor] = useState<string>(() => (isLeader && leaderContractor ? leaderContractor : 'ALL'));
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('today');
  const [startDate, setStartDate] = useState<string>(todayWIB);
  const [endDate, setEndDate] = useState<string>(todayWIB);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState<boolean>(() => !isLeader);

  const wibTimeLabel = useMemo(() => {
    try {
      return new Date().toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Jakarta'
      });
    } catch {
      return 'WIB';
    }
  }, [tickets.length, startDate, endDate]);

  const handleSelectPeriod = (preset: 'today' | 'week' | 'month') => {
    setPeriodPreset(preset);
    if (preset === 'today') {
      setStartDate(todayWIB);
      setEndDate(todayWIB);
    } else if (preset === 'week') {
      setStartDate(getJakartaDateString(-6));
      setEndDate(todayWIB);
    } else if (preset === 'month') {
      const monthStart = `${todayWIB.slice(0, 8)}01`;
      setStartDate(monthStart);
      setEndDate(todayWIB);
    }
  };

  // Handle Reset Filter
  const handleResetFilter = () => {
    setSelectedArea(isLeader && leaderArea ? leaderArea : 'ALL');
    setSelectedContractor(isLeader && leaderContractor ? leaderContractor : 'ALL');
    setPeriodPreset('today');
    setStartDate(todayWIB);
    setEndDate(todayWIB);
    setSearchQuery('');
    toast.info('Filter dikembalikan ke pengaturan default (Hari ini WIB).', 'Filter Direset');
  };

  // Base list of active, non-deleted tickets
  const activeTickets = useMemo(() => {
    return tickets.filter(t => !t.isArchived && !t.isDeleted);
  }, [tickets]);

  // Filtered tickets based on appointment date range, area, contractor & search
  const filteredTickets = useMemo(() => {
    return activeTickets.filter(t => {
      const ticketApptDate = getTicketAppointmentDate(t);
      if (!ticketApptDate) return false;

      if (startDate && ticketApptDate < startDate) return false;
      if (endDate && ticketApptDate > endDate) return false;

      const ticketArea = (t.area || '').trim() || 'Belum Ditentukan';
      if (selectedArea !== 'ALL' && ticketArea.toLowerCase() !== selectedArea.toLowerCase()) {
        return false;
      }

      const ticketContractor =
        (t.contactorName || t.contractorName || (t as any).contractor || (t as any).vendorName || '').trim() ||
        'Belum Ditentukan';
      if (selectedContractor !== 'ALL' && ticketContractor.toLowerCase() !== selectedContractor.toLowerCase()) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchArea = ticketArea.toLowerCase().includes(q);
        const matchContractor = ticketContractor.toLowerCase().includes(q);
        const matchWo = String(t.woNumber ?? '').toLowerCase().includes(q);
        const matchInst = String(t.installerName ?? '').toLowerCase().includes(q);
        if (!matchArea && !matchContractor && !matchWo && !matchInst) return false;
      }

      return true;
    });
  }, [activeTickets, startDate, endDate, selectedArea, selectedContractor, searchQuery]);

  // Helper to categorize ticket operational status
  const classifyTicketStatus = (t: Ticket): { isAssign: boolean; isComplete: boolean; isCancel: boolean; isUncomplete: boolean } => {
    const isAssign = Boolean(t.installerName && t.installerName.trim());

    const isCancel =
      t.statusWOInstaller === 'Failed / Cancelled' ||
      t.statusWOAgent === 'Cancelled' ||
      (t as any).statusWOInstaller === 'Cancel' ||
      (t as any).statusWOAgent === 'Cancel' ||
      t.statusWhatsApp === 'cancelled';

    const isComplete =
      !isCancel &&
      (t.statusWOInstaller === 'Completed' ||
        t.statusWOInstaller === 'Installed' ||
        t.statusWOAgent === 'Resolved' ||
        t.statusWOAgent === 'Closed');

    const isUncomplete = !isCancel && !isComplete;

    return {
      isAssign,
      isComplete,
      isCancel,
      isUncomplete
    };
  };

  // Grouped data: Area (Tingkat 1) -> Contractor (Tingkat 2)
  const groupedData = useMemo(() => {
    const areaMap = new Map<string, Map<string, ContractorRowData>>();
    const processedTicketIds = new Set<string>();

    filteredTickets.forEach(t => {
      if (processedTicketIds.has(t.id)) return;
      processedTicketIds.add(t.id);

      const areaKey = (t.area || '').trim() || 'Belum Ditentukan';
      const contractorKey =
        (t.contactorName || t.contractorName || (t as any).contractor || (t as any).vendorName || '').trim() ||
        'Belum Ditentukan';

      if (!areaMap.has(areaKey)) {
        areaMap.set(areaKey, new Map<string, ContractorRowData>());
      }
      const contractorsInArea = areaMap.get(areaKey)!;

      if (!contractorsInArea.has(contractorKey)) {
        contractorsInArea.set(contractorKey, {
          contractorName: contractorKey,
          totalWO: 0,
          assign: 0,
          unassign: 0,
          complete: 0,
          uncomplete: 0,
          cancel: 0
        });
      }

      const row = contractorsInArea.get(contractorKey)!;
      const { isAssign, isComplete, isCancel, isUncomplete } = classifyTicketStatus(t);

      row.totalWO += 1;
      if (isAssign) row.assign += 1;
      else row.unassign += 1;

      if (isComplete) row.complete += 1;
      else if (isCancel) row.cancel += 1;
      else if (isUncomplete) row.uncomplete += 1;
    });

    const result: AreaGroupData[] = [];

    Array.from(areaMap.entries())
      .sort(([a], [b]) => {
        if (a === 'Belum Ditentukan') return 1;
        if (b === 'Belum Ditentukan') return -1;
        return a.localeCompare(b);
      })
      .forEach(([areaName, contractorsInArea]) => {
        const contractors = Array.from(contractorsInArea.values()).sort((a, b) =>
          a.contractorName.localeCompare(b.contractorName)
        );

        const subtotal: ContractorRowData = {
          contractorName: `Subtotal ${areaName}`,
          totalWO: 0,
          assign: 0,
          unassign: 0,
          complete: 0,
          uncomplete: 0,
          cancel: 0
        };

        contractors.forEach(c => {
          subtotal.totalWO += c.totalWO;
          subtotal.assign += c.assign;
          subtotal.unassign += c.unassign;
          subtotal.complete += c.complete;
          subtotal.uncomplete += c.uncomplete;
          subtotal.cancel += c.cancel;
        });

        result.push({
          areaName,
          contractors,
          subtotal
        });
      });

    return result;
  }, [filteredTickets]);

  // Grand Total calculation
  const grandTotal = useMemo<ContractorRowData>(() => {
    const total: ContractorRowData = {
      contractorName: 'GRAND TOTAL',
      totalWO: 0,
      assign: 0,
      unassign: 0,
      complete: 0,
      uncomplete: 0,
      cancel: 0
    };

    groupedData.forEach(group => {
      total.totalWO += group.subtotal.totalWO;
      total.assign += group.subtotal.assign;
      total.unassign += group.subtotal.unassign;
      total.complete += group.subtotal.complete;
      total.uncomplete += group.subtotal.uncomplete;
      total.cancel += group.subtotal.cancel;
    });

    return total;
  }, [groupedData]);

  // Real metrics derived strictly from filteredTickets
  const executionRates = useMemo(() => {
    const completionPct = grandTotal.totalWO > 0 ? Math.round((grandTotal.complete / grandTotal.totalWO) * 100) : 0;
    const assignPct = grandTotal.totalWO > 0 ? Math.round((grandTotal.assign / grandTotal.totalWO) * 1000) / 10 : 0;

    let opmSum = 0;
    let opmCount = 0;
    let optimalOpmCount = 0;

    filteredTickets.forEach(t => {
      const rawOpm = t.technicalReport?.opticalPowerDbm || t.technicalReport?.opticalPowerRx || t.fatRedamanDbm;
      if (rawOpm === undefined || rawOpm === null || String(rawOpm).trim() === '') return;
      const numeric = parseFloat(String(rawOpm).replace(/[^0-9.-]/g, ''));
      if (Number.isFinite(numeric)) {
        opmSum += numeric;
        opmCount += 1;
        if (numeric >= -24 && numeric <= -10) {
          optimalOpmCount += 1;
        }
      }
    });

    const avgOpm = opmCount > 0 ? Math.round((opmSum / opmCount) * 10) / 10 : null;
    return {
      completionPct,
      assignPct,
      avgOpm,
      opmCount,
      optimalOpmCount
    };
  }, [filteredTickets, grandTotal]);

  // Dynamic category breakdown from filteredTickets.ticketCategory
  const categoryDistribution = useMemo(() => {
    const counts = new Map<string, number>();
    filteredTickets.forEach(t => {
      const cat = String(t.ticketCategory || 'Lainnya').trim() || 'Lainnya';
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    const total = filteredTickets.length;
    return Array.from(counts.entries())
      .map(([name, count]) => ({
        name,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredTickets]);

  // Top 4 most recent completed / verified tickets from filteredTickets
  const recentCompletedTickets = useMemo(() => {
    return filteredTickets
      .filter(t => classifyTicketStatus(t).isComplete)
      .sort((a, b) => {
        const timeA = new Date(a.checkOutAt || a.updatedAt || a.createdAt || 0).getTime();
        const timeB = new Date(b.checkOutAt || b.updatedAt || b.createdAt || 0).getTime();
        return timeB - timeA;
      })
      .slice(0, 4);
  }, [filteredTickets]);

  // List of available areas and contractors from dataset
  const availableAreas = useMemo(() => {
    const set = new Set<string>();
    activeTickets.forEach(t => {
      const a = (t.area || '').trim();
      if (a) set.add(a);
    });
    areasList.forEach(a => set.add(a));
    return Array.from(set).sort();
  }, [activeTickets, areasList]);

  const availableContractors = useMemo(() => {
    const set = new Set<string>();
    activeTickets.forEach(t => {
      const c = (t.contactorName || t.contractorName || (t as any).contractor || (t as any).vendorName || '').trim();
      if (c) set.add(c);
    });
    contractorsList.forEach(c => set.add(c));
    return Array.from(set).sort();
  }, [activeTickets, contractorsList]);

  // Export to Excel (.xlsx)
  const handleExportExcel = () => {
    try {
      const rows: any[] = [];
      rows.push(['REKAP TOTAL WORK ORDER PER KONTRAKTOR BERDASARKAN AREA']);
      rows.push([`Rentang Tanggal Appointment: ${startDate || 'Semua'} s/d ${endDate || 'Semua'} (WIB)`]);
      rows.push([`Waktu Unduh: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`]);
      rows.push([]);
      rows.push(['Area', 'Nama Kontraktor', 'Total WO', 'Assign', 'Unassign', 'Complete', 'Uncomplete', 'Cancel']);

      groupedData.forEach(group => {
        group.contractors.forEach((c, idx) => {
          rows.push([
            idx === 0 ? group.areaName : '',
            c.contractorName,
            c.totalWO,
            c.assign,
            c.unassign,
            c.complete,
            c.uncomplete,
            c.cancel
          ]);
        });
        rows.push([
          `TOTAL ${group.areaName.toUpperCase()}`,
          '-',
          group.subtotal.totalWO,
          group.subtotal.assign,
          group.subtotal.unassign,
          group.subtotal.complete,
          group.subtotal.uncomplete,
          group.subtotal.cancel
        ]);
        rows.push([]);
      });

      rows.push([
        'GRAND TOTAL KESELURUHAN',
        '-',
        grandTotal.totalWO,
        grandTotal.assign,
        grandTotal.unassign,
        grandTotal.complete,
        grandTotal.uncomplete,
        grandTotal.cancel
      ]);

      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Rekap WO Area & Kontraktor');

      const fileName = `Rekap_WO_Area_Kontraktor_${startDate || 'all'}_sd_${endDate || 'all'}.xlsx`;
      XLSX.writeFile(workbook, fileName);

      toast.success(`Berkas Excel berhasil diunduh: ${fileName}`, 'Ekspor Sukses');
    } catch (err: any) {
      console.error('Export Excel failed:', err);
      toast.error('Gagal mengekspor data ke Excel.', 'Ekspor Gagal');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const renderCategoryIcon = (categoryName: string) => {
    const lower = categoryName.toLowerCase();
    if (lower.includes('pasang') || lower.includes('install') || lower.includes('psb')) {
      return <Home className="w-4 h-4 text-[#58149c]" />;
    }
    if (lower.includes('repair') || lower.includes('gangguan') || lower.includes('maint')) {
      return <Wrench className="w-4 h-4 text-[#58149c]" />;
    }
    return <Wifi className="w-4 h-4 text-[#58149c]" />;
  };

  const activeScopeSubtitle =
    selectedArea !== 'ALL'
      ? `Area ${selectedArea}${selectedContractor !== 'ALL' ? ` • ${selectedContractor}` : ''}`
      : selectedContractor !== 'ALL'
      ? selectedContractor
      : 'Seluruh Area & Kontraktor';

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Stitch Periode Laporan Top Control */}
      <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 p-4 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#58149c] dark:text-[#d0bcff]" />
            <h1 className="text-base sm:text-lg font-bold text-[#1f1638] dark:text-white font-['Plus_Jakarta_Sans',sans-serif]">
              Periode Laporan
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f3eaff] dark:bg-[#251545] border border-[#e8ddff] dark:border-purple-800 text-[11px] font-bold text-[#58149c] dark:text-[#d0bcff]">
              <span className={`w-2 h-2 rounded-full ${databaseStatus === 'offline' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span>Sinkron {wibTimeLabel} WIB</span>
            </span>

            <button
              type="button"
              onClick={() => setShowAdvancedFilters(prev => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white dark:bg-[#251545] border border-[#e8ddff] dark:border-purple-800 text-[11px] font-bold text-[#4b4452] dark:text-slate-200 hover:bg-[#f8f1ff] cursor-pointer"
            >
              <Filter className="w-3 h-3 text-[#7C3AED]" />
              <span>Filter</span>
              {showAdvancedFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Segmented Period Bar */}
        <div className="grid grid-cols-3 p-1 rounded-xl bg-[#f3eaff] dark:bg-[#251545] border border-[#e8ddff] dark:border-purple-900/60 gap-1">
          {[
            { id: 'today' as const, label: 'Hari Ini' },
            { id: 'week' as const, label: 'Minggu Ini' },
            { id: 'month' as const, label: 'Bulan Ini' }
          ].map(tab => {
            const active = periodPreset === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSelectPeriod(tab.id)}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? 'bg-white dark:bg-[#1A0E2E] text-[#58149c] dark:text-white shadow-xs'
                    : 'text-[#4b4452] dark:text-slate-300 hover:text-[#1f1638]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4b4452] dark:text-slate-300">
          <div className="flex items-center gap-1.5 font-medium">
            <Calendar className="w-3.5 h-3.5 text-[#7d7484]" />
            <span>
              {startDate === endDate
                ? `${formatAppointmentDateDisplay(startDate)} (${startDate})`
                : `${startDate} s/d ${endDate} WIB`}
            </span>
          </div>
          <span className="font-bold text-[#58149c] dark:text-[#d0bcff] truncate">
            {activeScopeSubtitle}
          </span>
        </div>
      </div>

      {/* Collapsible Multi-Role Filter Toolbar (Area, Contractor, Custom Dates, Search) */}
      {showAdvancedFilters && (
        <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/50 p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#f3eaff] dark:border-slate-800 text-xs font-bold text-[#1f1638] dark:text-slate-200">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#7C3AED]" />
              <span>Filter Area, Kontraktor & Tanggal Custom</span>
            </div>
            <button
              type="button"
              onClick={handleResetFilter}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#f3eaff] hover:bg-[#e8ddff] text-[#58149c] text-[11px] font-bold cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Default</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-[#4b4452] dark:text-slate-400 mb-1">
                Pilih Area
              </label>
              <select
                value={selectedArea}
                onChange={e => setSelectedArea(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#f8f1ff] dark:bg-slate-800 border border-[#e8ddff] dark:border-slate-700 rounded-xl text-[#1f1638] dark:text-white font-semibold"
              >
                <option value="ALL">Semua Area ({availableAreas.length})</option>
                {availableAreas.map(area => (
                  <option key={area} value={area}>
                    {area}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#4b4452] dark:text-slate-400 mb-1">
                Pilih Kontraktor
              </label>
              <select
                value={selectedContractor}
                onChange={e => setSelectedContractor(e.target.value)}
                className="w-full px-2.5 py-2 bg-[#f8f1ff] dark:bg-slate-800 border border-[#e8ddff] dark:border-slate-700 rounded-xl text-[#1f1638] dark:text-white font-semibold"
              >
                <option value="ALL">Semua Kontraktor ({availableContractors.length})</option>
                {availableContractors.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#4b4452] dark:text-slate-400 mb-1">
                Tgl Appointment Mulai
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  setPeriodPreset('custom');
                }}
                className="w-full px-2.5 py-2 bg-[#f8f1ff] dark:bg-slate-800 border border-[#e8ddff] dark:border-slate-700 rounded-xl text-[#1f1638] dark:text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#4b4452] dark:text-slate-400 mb-1">
                Tgl Appointment Akhir
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => {
                  setEndDate(e.target.value);
                  setPeriodPreset('custom');
                }}
                className="w-full px-2.5 py-2 bg-[#f8f1ff] dark:bg-slate-800 border border-[#e8ddff] dark:border-slate-700 rounded-xl text-[#1f1638] dark:text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#4b4452] dark:text-slate-400 mb-1">
                Cari WO / Teknisi / Mitra
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#7d7484] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Area, mitra, #WO..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-2 bg-[#f8f1ff] dark:bg-slate-800 border border-[#e8ddff] dark:border-slate-700 rounded-xl text-[#1f1638] dark:text-white"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Grid: RINGKASAN EKSEKUSI WO + KUALITAS REDAMAN */}
      <div className={isMobileView ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch'}>
        {/* Hero Card: RINGKASAN EKSEKUSI WO */}
        <div className={`${isMobileView ? '' : 'lg:col-span-7'} bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 p-4 sm:p-5 shadow-xs flex flex-col justify-between gap-4`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#4b4452] dark:text-slate-300">
                RINGKASAN EKSEKUSI WO
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl sm:text-4xl font-bold font-mono text-[#1f1638] dark:text-white tabular-nums">
                  {grandTotal.totalWO}
                </span>
                <span className="text-xs sm:text-sm font-medium text-[#4b4452] dark:text-slate-300">
                  Total Tiket Dispatch
                </span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{executionRates.completionPct}% Sukses</span>
              </span>
              <div className="mt-1 text-[11px] text-[#4b4452] dark:text-slate-400">
                {grandTotal.complete} dari {grandTotal.totalWO} Rampung
              </div>
            </div>
          </div>

          {/* 3 Sub-Tiles: Selesai, Pending/Proses, Gagal/Batal */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="p-3 rounded-xl bg-[#f8f1ff] dark:bg-[#251545] border border-[#e8ddff] dark:border-purple-900/50">
              <div className="flex items-center justify-between text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                <span>Selesai</span>
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono text-[#1f1638] dark:text-white">
                {grandTotal.complete}
              </div>
              <div className="text-[10.5px] text-[#4b4452] dark:text-slate-400 truncate">
                Target tercapai
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#f8f1ff] dark:bg-[#251545] border border-[#e8ddff] dark:border-purple-900/50">
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-700 dark:text-amber-400">
                <span>Pending</span>
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono text-[#1f1638] dark:text-white">
                {grandTotal.uncomplete}
              </div>
              <div className="text-[10.5px] text-[#4b4452] dark:text-slate-400 truncate">
                Proses / Tunda
              </div>
            </div>

            <div className="p-3 rounded-xl bg-[#f8f1ff] dark:bg-[#251545] border border-[#e8ddff] dark:border-purple-900/50">
              <div className="flex items-center justify-between text-[11px] font-bold text-rose-700 dark:text-rose-400">
                <span>Gagal/Batal</span>
                <XCircle className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono text-[#1f1638] dark:text-white">
                {grandTotal.cancel}
              </div>
              <div className="text-[10.5px] text-[#4b4452] dark:text-slate-400 truncate">
                {grandTotal.unassign} blm assign
              </div>
            </div>
          </div>

          {/* Dark Violet Telemetry Bar: Assign Rate & Real Avg OPM */}
          <div className="rounded-xl bg-[#342b4e] text-white p-3.5 grid grid-cols-2 gap-3 border border-[#4c3e70]">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-[#d0bcff] shrink-0">
                <Gauge className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] text-[#d0bcff]">Assign Rate</div>
                <div className="text-lg font-bold font-mono leading-tight">
                  {executionRates.assignPct}%
                </div>
                <div className="text-[10px] text-purple-200/80">
                  {grandTotal.assign}/{grandTotal.totalWO} Terdistribusi
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 border-l border-white/10 pl-3">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center text-[#d0bcff] shrink-0">
                <Radio className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] text-[#d0bcff]">Rata-rata OPM</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-lg font-bold font-mono leading-tight">
                    {executionRates.avgOpm !== null ? `${executionRates.avgOpm} dBm` : 'N/A'}
                  </span>
                  {executionRates.avgOpm !== null && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        executionRates.avgOpm < -25
                          ? 'bg-rose-500/25 text-rose-200'
                          : 'bg-emerald-500/25 text-emerald-200'
                      }`}
                    >
                      {executionRates.avgOpm < -25 ? 'Tinggi' : 'Baik'}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-purple-200/80">
                  {executionRates.opmCount > 0 ? `${executionRates.opmCount} data OPM` : 'Belum ada data OPM'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column Card: KUALITAS REDAMAN & EKSEKUSI */}
        <div className={`${isMobileView ? '' : 'lg:col-span-5'} bg-[#f3eaff] dark:bg-[#251545] rounded-2xl border border-[#e8ddff] dark:border-purple-800/60 p-4 sm:p-5 flex flex-col justify-between gap-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#58149c] dark:text-[#d0bcff]">
                {executionRates.opmCount > 0 ? 'KUALITAS REDAMAN OPTIK' : 'RINGKASAN KUALITAS OPERASIONAL'}
              </div>
              <h2 className="text-base sm:text-lg font-bold text-[#1f1638] dark:text-white leading-snug font-['Plus_Jakarta_Sans',sans-serif]">
                {executionRates.opmCount > 0
                  ? `${executionRates.optimalOpmCount} dari ${executionRates.opmCount} ONT Lolos Batas Optimal`
                  : `${grandTotal.complete} WO Selesai dari ${grandTotal.totalWO} Tiket`}
              </h2>
              <p className="text-xs text-[#4b4452] dark:text-purple-100/80 leading-relaxed">
                {executionRates.opmCount > 0
                  ? `Rata-rata redaman terukur ${executionRates.avgOpm} dBm (ambang batas optimal -24 dBm s/d -10 dBm).`
                  : `Tingkat penugasan teknisi mencapai ${executionRates.assignPct}% dengan ${grandTotal.unassign} tiket menunggu assign.`}
              </p>
            </div>

            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-2 border-white dark:border-purple-800 shadow-sm shrink-0 bg-gradient-to-br from-[#ede9fe] to-[#d8b4fe]">
              <img
                src={ftthInspectionImg}
                alt="Inspeksi Kualitas FTTH"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Real Operational Quick Breakdown Pills */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#e8ddff] dark:border-purple-800/50 text-xs">
            <div className="bg-white/80 dark:bg-[#1A0E2E] rounded-xl p-2.5 border border-[#e8ddff] dark:border-purple-900/50">
              <div className="text-[10.5px] text-[#4b4452] dark:text-slate-400">Teknisi Terassign</div>
              <div className="font-mono font-bold text-sm text-[#1f1638] dark:text-white">
                {grandTotal.assign} <span className="text-[10.5px] font-normal text-emerald-600">WO</span>
              </div>
            </div>
            <div className="bg-white/80 dark:bg-[#1A0E2E] rounded-xl p-2.5 border border-[#e8ddff] dark:border-purple-900/50">
              <div className="text-[10.5px] text-[#4b4452] dark:text-slate-400">Belum Di-assign</div>
              <div className="font-mono font-bold text-sm text-amber-600 dark:text-amber-400">
                {grandTotal.unassign} <span className="text-[10.5px] font-normal">WO</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Middle 2-Column Grid: Distribusi Jenis Pekerjaan & WO Selesai Terakhir */}
      <div className={isMobileView ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 lg:grid-cols-2 gap-4'}>
        {/* Distribusi Jenis Pekerjaan */}
        <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 p-4 sm:p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-[#58149c] dark:text-[#d0bcff]" />
              <h2 className="text-sm font-bold text-[#1f1638] dark:text-white">
                Distribusi Jenis Pekerjaan
              </h2>
            </div>
            <span className="text-[11px] font-semibold text-[#4b4452] dark:text-slate-400">
              Total {categoryDistribution.length} Kategori
            </span>
          </div>

          {categoryDistribution.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-400">
              Belum ada data pekerjaan pada rentang tanggal yang dipilih.
            </div>
          ) : (
            <div className="space-y-2.5">
              {categoryDistribution.map(item => (
                <div
                  key={item.name}
                  className="p-3 rounded-xl bg-[#f8f1ff] dark:bg-[#251545]/70 border border-[#e8ddff] dark:border-purple-900/50 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#1A0E2E] border border-[#e8ddff] flex items-center justify-center shrink-0">
                        {renderCategoryIcon(item.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#1f1638] dark:text-white truncate">
                          {item.name}
                        </div>
                        <div className="text-[10.5px] text-[#4b4452] dark:text-slate-400">
                          {activeScopeSubtitle}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold font-mono text-[#58149c] dark:text-[#d0bcff]">
                        {item.count} WO
                      </div>
                      <div className="text-[10.5px] font-mono text-[#4b4452] dark:text-slate-400">
                        {item.percent}%
                      </div>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#e8ddff] dark:bg-purple-950 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#58149c] transition-all"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* WO Selesai / Terverifikasi Terakhir */}
        <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 p-4 sm:p-5 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#58149c] dark:text-[#d0bcff]" />
              <h2 className="text-sm font-bold text-[#1f1638] dark:text-white">
                WO Selesai Terakhir
              </h2>
            </div>
            <span className="text-[11px] font-bold text-[#58149c] dark:text-[#d0bcff]">
              {recentCompletedTickets.length} Terbaru
            </span>
          </div>

          {recentCompletedTickets.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Belum ada WO berstatus Selesai (Completed) pada periode ini.
            </div>
          ) : (
            <div className="space-y-2.5">
              {recentCompletedTickets.map(t => {
                const instInitials = (t.installerName || 'TK')
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map(s => s[0]?.toUpperCase() || '')
                  .join('');
                const opmVal = t.technicalReport?.opticalPowerDbm || t.technicalReport?.opticalPowerRx || t.fatRedamanDbm;
                const timeDisplay = t.checkOutAt
                  ? new Date(t.checkOutAt).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Jakarta'
                    }) + ' WIB'
                  : t.appointmentDate || '-';

                return (
                  <div
                    key={t.id}
                    className="p-3 rounded-xl bg-[#f8f1ff] dark:bg-[#251545]/70 border border-[#e8ddff] dark:border-purple-900/50 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-xs text-[#1f1638] dark:text-white">
                            #{t.woNumber}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">
                            {t.approvalStatus === 'APPROVED' ? 'Approved' : t.statusWOInstaller}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#4b4452] dark:text-slate-300 truncate mt-0.5">
                          {t.ticketCategory || 'Work Order'} • {t.customerName}
                        </div>
                      </div>
                      <span className="text-[10.5px] font-mono text-[#4b4452] dark:text-slate-400 shrink-0">
                        {timeDisplay}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#e8ddff] dark:border-purple-800/50 text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-white dark:bg-[#1A0E2E] border border-[#e8ddff] flex items-center justify-center font-bold text-[10px] text-[#58149c] shrink-0">
                          {instInitials}
                        </div>
                        <span className="font-semibold text-[#1f1638] dark:text-white truncate">
                          {t.installerName || 'Teknisi'}
                        </span>
                      </div>
                      <span className="font-mono text-[10.5px] text-emerald-700 dark:text-emerald-300 font-semibold shrink-0">
                        {opmVal
                          ? `OPM: ${String(opmVal).toLowerCase().includes('dbm') ? opmVal : `${opmVal} dBm`}`
                          : [t.fdtCode || t.fatCode, t.fatPort ? `Port ${t.fatPort}` : ''].filter(Boolean).join(' / ') || t.area || '-'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Hierarchical Table: Area (Tingkat 1) -> Contractor (Tingkat 2) */}
      <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 shadow-xs overflow-hidden">
        <div className="px-4 py-3.5 border-b border-[#e8ddff] dark:border-purple-900/50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#58149c] dark:text-[#d0bcff]" />
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-[#1f1638] dark:text-white">
                Matriks Rekap Area & Kontraktor ({groupedData.length} Area)
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#58149c] hover:bg-[#3B1D78] text-white text-xs font-bold shadow-xs cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
          </div>
        </div>

        {groupedData.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#f3eaff] dark:bg-purple-950/60 text-[#58149c] flex items-center justify-center">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-[#1f1638] dark:text-slate-200 text-sm">
              Tidak Ada Data Work Order Sesuai Filter
            </h3>
            <p className="text-xs text-[#4b4452] dark:text-slate-400 max-w-md mx-auto">
              Tidak ditemukan tiket WO dengan Appointment Date pada rentang {startDate} s/d {endDate}.
            </p>
            <button
              type="button"
              onClick={handleResetFilter}
              className="px-4 py-2 bg-[#58149c] hover:bg-[#3B1D78] text-white text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Kembalikan ke Hari Ini
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gradient-to-r from-[#1f1638] to-[#342b4e] text-white font-bold border-b border-[#342b4e]">
                  <th className="py-3 px-4 w-12 text-center">No</th>
                  <th className="py-3 px-4">Nama Kontraktor</th>
                  <th className="py-3 px-3 text-right">Total WO</th>
                  <th className="py-3 px-3 text-right text-emerald-300">Assign</th>
                  <th className="py-3 px-3 text-right text-amber-300">Unassign</th>
                  <th className="py-3 px-3 text-right text-teal-300">Complete</th>
                  <th className="py-3 px-3 text-right text-blue-300">Uncomplete</th>
                  <th className="py-3 px-3 text-right text-rose-300">Cancel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {groupedData.map(group => (
                  <React.Fragment key={group.areaName}>
                    <tr className="bg-[#f3eaff] dark:bg-[#2C184D] border-t-2 border-b border-[#e8ddff] dark:border-purple-800/80">
                      <td colSpan={8} className="py-2.5 px-4 font-bold text-xs text-[#58149c] dark:text-[#E9D5FF]">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-[#7C3AED] shrink-0" />
                            <span className="tracking-wide uppercase font-bold text-[12px]">
                              AREA: {group.areaName}
                            </span>
                            {group.areaName === 'Belum Ditentukan' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-normal">
                                Perlu Penyesuaian Data
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-[#58149c] dark:text-[#D8B4FE]">
                            {group.contractors.length} Kontraktor | {group.subtotal.totalWO} WO
                          </span>
                        </div>
                      </td>
                    </tr>

                    {group.contractors.map((c, cIdx) => (
                      <tr
                        key={`${group.areaName}-${c.contractorName}`}
                        className="hover:bg-[#f8f1ff] dark:hover:bg-purple-950/20 transition-colors"
                      >
                        <td className="py-2.5 px-4 text-center font-mono text-slate-400 text-[11px]">
                          {cIdx + 1}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-[#1f1638] dark:text-white flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-[#7d7484] shrink-0" />
                          <span>{c.contractorName}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#1f1638] dark:text-white">
                          {c.totalWO}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {c.assign}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                          {c.unassign}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-teal-600 dark:text-teal-400">
                          {c.complete}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                          {c.uncomplete}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                          {c.cancel}
                        </td>
                      </tr>
                    ))}

                    <tr className="bg-[#f8f1ff] dark:bg-[#1E1136] font-bold border-b border-t border-[#e8ddff] dark:border-purple-900/60 text-[#1f1638] dark:text-white">
                      <td colSpan={2} className="py-2 px-4 text-right uppercase text-[11px] text-[#58149c] dark:text-[#D8B4FE]">
                        Subtotal {group.areaName}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-extrabold text-[#58149c] dark:text-[#D8B4FE]">
                        {group.subtotal.totalWO}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {group.subtotal.assign}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400">
                        {group.subtotal.unassign}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-teal-600 dark:text-teal-400">
                        {group.subtotal.complete}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-blue-600 dark:text-blue-400">
                        {group.subtotal.uncomplete}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                        {group.subtotal.cancel}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}

                <tr className="bg-gradient-to-r from-[#1f1638] to-[#342b4e] text-white font-extrabold border-t-2 border-[#7C3AED] text-sm">
                  <td colSpan={2} className="py-3 px-4 text-right uppercase tracking-wider text-xs">
                    GRAND TOTAL KESELURUHAN
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-white text-base">
                    {grandTotal.totalWO}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-300">
                    {grandTotal.assign}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-amber-300">
                    {grandTotal.unassign}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-teal-300">
                    {grandTotal.complete}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-blue-300">
                    {grandTotal.uncomplete}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-300">
                    {grandTotal.cancel}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Stitch Bottom Export CTA Strip */}
      <div className="bg-white dark:bg-[#1A0E2E] rounded-2xl border border-[#e8ddff] dark:border-purple-900/60 p-4 text-center space-y-2 shadow-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={handleExportExcel}
            className="flex-1 max-w-md mx-auto sm:mx-0 py-2.5 px-4 rounded-xl bg-white dark:bg-[#251545] hover:bg-[#f3eaff] border border-[#cec3d4] dark:border-purple-800 text-[#58149c] dark:text-[#d0bcff] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>Export Laporan Rekap (Excel)</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex-1 max-w-md mx-auto sm:mx-0 py-2.5 px-4 rounded-xl bg-[#58149c] hover:bg-[#6a46c1] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak / Simpan PDF</span>
          </button>
        </div>
        <p className="text-[11px] text-[#4b4452] dark:text-slate-400">
          Format laporan resmi operasional NOC & Dispatch MoraJaws • Data langsung dari database produksi
        </p>
      </div>
    </div>
  );
};
