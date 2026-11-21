import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
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
  const { isCompactUI } = useResponsiveViewport();
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
      t.statusWOAgent !== 'Pending' &&
      t.statusWOAgent !== 'Reschedule' &&
      (t.statusWOAgent === 'Done' ||
        t.statusWOAgent === 'Resolved' ||
        t.statusWOAgent === 'Closed' ||
        t.statusWOInstaller === 'Completed' ||
        t.statusWOInstaller === 'Installed');

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
      return <Home className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />;
    }
    if (lower.includes('repair') || lower.includes('gangguan') || lower.includes('maint')) {
      return <Wrench className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />;
    }
    return <Wifi className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />;
  };

  const activeScopeSubtitle =
    selectedArea !== 'ALL'
      ? `Area ${selectedArea}${selectedContractor !== 'ALL' ? ` • ${selectedContractor}` : ''}`
      : selectedContractor !== 'ALL'
      ? selectedContractor
      : 'Seluruh Area & Kontraktor';

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Periode Laporan Top Control */}
      <div className="card-3d-lavender p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />
            <h1 className="text-base sm:text-lg font-bold text-[#1F1638] dark:text-white font-display">
              Periode Laporan
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <span className="tactile-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold text-[#1F1638] dark:text-[#D8B4FE]">
              <span className={`w-2 h-2 rounded-full ${databaseStatus === 'offline' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span>Sinkron {wibTimeLabel} WIB</span>
            </span>

            <button
              type="button"
              onClick={() => setShowAdvancedFilters(prev => !prev)}
              className="btn-3d-lilac inline-flex items-center gap-1 px-3 py-1.5 min-h-[36px] rounded-full text-[11px] font-bold cursor-pointer"
            >
              <Filter className="w-3 h-3 text-[#5B289B] dark:text-[#D8B4FE]" />
              <span>Filter</span>
              {showAdvancedFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Segmented Period Bar */}
        <div className="mj-tactile-tab-bar grid grid-cols-3 p-1 gap-1">
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
                className={`min-h-[40px] sm:min-h-0 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  active
                    ? 'btn-3d-primary'
                    : 'text-[#5A4D73] dark:text-[#C5B3DF] hover:text-[#1F1638] dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#4B4452] dark:text-[#C5B3DF]">
          <div className="flex items-center gap-1.5 font-medium">
            <Calendar className="w-3.5 h-3.5 text-[#7D7484] dark:text-[#A493C2]" />
            <span>
              {startDate === endDate
                ? `${formatAppointmentDateDisplay(startDate)} (${startDate})`
                : `${startDate} s/d ${endDate} WIB`}
            </span>
          </div>
          <span className="font-bold text-[#5B289B] dark:text-[#D8B4FE] truncate">
            {activeScopeSubtitle}
          </span>
        </div>
      </div>

      {/* Collapsible Multi-Role Filter Toolbar (Area, Contractor, Custom Dates, Search) */}
      {showAdvancedFilters && (
        <div className="card-3d-lavender p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-[#E5D9FF] dark:border-[#361F5E] text-xs font-bold text-[#1F1638] dark:text-[#E8DDFF]">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />
              <span>Filter Area, Kontraktor & Tanggal Custom</span>
            </div>
            <button
              type="button"
              onClick={handleResetFilter}
              className="btn-3d-lilac inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Default</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-semibold text-[#4B4452] dark:text-[#C5B3DF] mb-1">
                Pilih Area
              </label>
              <select
                value={selectedArea}
                onChange={e => setSelectedArea(e.target.value)}
                className="tactile-debossed-input w-full px-2.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-[#1F1638] dark:text-white font-semibold"
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
              <label className="block text-[11px] font-semibold text-[#4B4452] dark:text-[#C5B3DF] mb-1">
                Pilih Kontraktor
              </label>
              <select
                value={selectedContractor}
                onChange={e => setSelectedContractor(e.target.value)}
                className="tactile-debossed-input w-full px-2.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-[#1F1638] dark:text-white font-semibold"
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
              <label className="block text-[11px] font-semibold text-[#4B4452] dark:text-[#C5B3DF] mb-1">
                Tgl Appointment Mulai
              </label>
              <input
                type="date"
                value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  setPeriodPreset('custom');
                }}
                className="tactile-debossed-input w-full px-2.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-[#1F1638] dark:text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#4B4452] dark:text-[#C5B3DF] mb-1">
                Tgl Appointment Akhir
              </label>
              <input
                type="date"
                value={endDate}
                onChange={e => {
                  setEndDate(e.target.value);
                  setPeriodPreset('custom');
                }}
                className="tactile-debossed-input w-full px-2.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-[#1F1638] dark:text-white font-mono"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-[#4B4452] dark:text-[#C5B3DF] mb-1">
                Cari WO / Teknisi / Mitra
              </label>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#7D7484] dark:text-[#A493C2] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Area, mitra, #WO..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="tactile-debossed-input w-full pl-8 pr-2.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-[#1F1638] dark:text-white"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Grid: RINGKASAN EKSEKUSI WO + KUALITAS REDAMAN */}
      <div className={isCompactUI ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch'}>
        {/* Hero Card: RINGKASAN EKSEKUSI WO */}
        <div className={`${isCompactUI ? '' : 'lg:col-span-7'} card-3d-lavender p-4 sm:p-5 flex flex-col justify-between gap-4`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#7D7484] dark:text-[#C5B3DF]">
                RINGKASAN EKSEKUSI WO
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-3xl sm:text-4xl font-bold font-mono text-[#1F1638] dark:text-white tabular-nums">
                  {grandTotal.totalWO}
                </span>
                <span className="text-xs sm:text-sm font-medium text-[#4B4452] dark:text-[#C5B3DF]">
                  Total Tiket Dispatch
                </span>
              </div>
            </div>

            <div className="text-right shrink-0">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{executionRates.completionPct}% Sukses</span>
              </span>
              <div className="mt-1 text-[11px] text-[#7D7484] dark:text-[#A493C2]">
                {grandTotal.complete} dari {grandTotal.totalWO} Rampung
              </div>
            </div>
          </div>

          {/* 3 Sub-Tiles: Selesai, Pending/Proses, Gagal/Batal */}
          <div className="grid grid-cols-3 gap-2.5">
            <div className="mj-tactile-well p-3 rounded-xl">
              <div className="flex items-center justify-between text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                <span>Selesai</span>
                <CheckCircle2 className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono text-[#1F1638] dark:text-white tabular-nums">
                {grandTotal.complete}
              </div>
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#A493C2] truncate">
                Target tercapai
              </div>
            </div>

            <div className="mj-tactile-well p-3 rounded-xl">
              <div className="flex items-center justify-between text-[11px] font-bold text-amber-700 dark:text-amber-400">
                <span>Pending</span>
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono text-[#1F1638] dark:text-white tabular-nums">
                {grandTotal.uncomplete}
              </div>
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#A493C2] truncate">
                Proses / Tunda
              </div>
            </div>

            <div className="mj-tactile-well p-3 rounded-xl">
              <div className="flex items-center justify-between text-[11px] font-bold text-rose-700 dark:text-rose-400">
                <span>Gagal/Batal</span>
                <XCircle className="w-3.5 h-3.5" />
              </div>
              <div className="mt-1.5 text-xl font-bold font-mono text-[#1F1638] dark:text-white tabular-nums">
                {grandTotal.cancel}
              </div>
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#A493C2] truncate">
                {grandTotal.unassign} blm assign
              </div>
            </div>
          </div>

          {/* Dark Purple Telemetry Bar: Assign Rate & Real Avg OPM */}
          <div className="rounded-xl bg-gradient-to-r from-[#160D29] via-[#27104A] to-[#1A0D36] text-white p-3.5 grid grid-cols-2 gap-3 border border-[#5B289B]/40 shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#5B289B]/35 border border-[#D8B4FE]/25 flex items-center justify-center text-[#D8B4FE] shrink-0">
                <Gauge className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] text-[#D8B4FE]">Assign Rate</div>
                <div className="text-lg font-bold font-mono leading-tight tabular-nums">
                  {executionRates.assignPct}%
                </div>
                <div className="text-[10px] text-[#E8DDFF]/75">
                  {grandTotal.assign}/{grandTotal.totalWO} Terdistribusi
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 border-l border-[#D8B4FE]/15 pl-3">
              <div className="w-9 h-9 rounded-lg bg-[#5B289B]/35 border border-[#D8B4FE]/25 flex items-center justify-center text-[#D8B4FE] shrink-0">
                <Radio className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] text-[#D8B4FE]">Rata-rata OPM</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-lg font-bold font-mono leading-tight tabular-nums">
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
                <div className="text-[10px] text-[#E8DDFF]/75">
                  {executionRates.opmCount > 0 ? `${executionRates.opmCount} data OPM` : 'Belum ada data OPM'}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column Card: KUALITAS REDAMAN & EKSEKUSI */}
        <div className={`${isCompactUI ? '' : 'lg:col-span-5'} card-3d-lavender bg-[#F8F1FF] dark:bg-[#1E1238] p-4 sm:p-5 flex flex-col justify-between gap-4`}>
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1.5 min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#5B289B] dark:text-[#D8B4FE]">
                {executionRates.opmCount > 0 ? 'KUALITAS REDAMAN OPTIK' : 'RINGKASAN KUALITAS OPERASIONAL'}
              </div>
              <h2 className="text-base sm:text-lg font-bold text-[#1F1638] dark:text-white leading-snug font-display">
                {executionRates.opmCount > 0
                  ? `${executionRates.optimalOpmCount} dari ${executionRates.opmCount} ONT Lolos Batas Optimal`
                  : `${grandTotal.complete} WO Selesai dari ${grandTotal.totalWO} Tiket`}
              </h2>
              <p className="text-xs text-[#4B4452] dark:text-[#C5B3DF] leading-relaxed">
                {executionRates.opmCount > 0
                  ? `Rata-rata redaman terukur ${executionRates.avgOpm} dBm (ambang batas optimal -24 dBm s/d -10 dBm).`
                  : `Tingkat penugasan teknisi mencapai ${executionRates.assignPct}% dengan ${grandTotal.unassign} tiket menunggu assign.`}
              </p>
            </div>

            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-2 border-white dark:border-[#4B2680] shadow-sm shrink-0 bg-[#E8DDFF] dark:bg-[#2E1654]">
              <img
                src={ftthInspectionImg}
                alt="Inspeksi Kualitas FTTH"
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Real Operational Quick Breakdown Pills */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E5D9FF] dark:border-[#361F5E] text-xs">
            <div className="mj-tactile-well rounded-xl p-2.5">
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#A493C2]">Teknisi Terassign</div>
              <div className="font-mono font-bold text-sm text-[#1F1638] dark:text-white tabular-nums">
                {grandTotal.assign} <span className="text-[10.5px] font-normal text-emerald-600 dark:text-emerald-400">WO</span>
              </div>
            </div>
            <div className="mj-tactile-well rounded-xl p-2.5">
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#A493C2]">Belum Di-assign</div>
              <div className="font-mono font-bold text-sm text-amber-600 dark:text-amber-400 tabular-nums">
                {grandTotal.unassign} <span className="text-[10.5px] font-normal">WO</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Middle 2-Column Grid: Distribusi Jenis Pekerjaan & WO Selesai Terakhir */}
      <div className={isCompactUI ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 lg:grid-cols-2 gap-4'}>
        {/* Distribusi Jenis Pekerjaan */}
        <div className="card-3d-lavender p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />
              <h2 className="text-sm font-display font-bold text-[#1F1638] dark:text-white">
                Distribusi Jenis Pekerjaan
              </h2>
            </div>
            <span className="text-[11px] font-semibold text-[#7D7484] dark:text-[#A493C2]">
              Total {categoryDistribution.length} Kategori
            </span>
          </div>

          {categoryDistribution.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#7D7484] dark:text-[#A493C2]">
              Belum ada data pekerjaan pada rentang tanggal yang dipilih.
            </div>
          ) : (
            <div className="space-y-2.5">
              {categoryDistribution.map(item => (
                <div
                  key={item.name}
                  className="mj-tactile-well p-3 rounded-xl space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#241145] border border-[#E5D9FF] dark:border-[#4B2680] flex items-center justify-center shrink-0">
                        {renderCategoryIcon(item.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#1F1638] dark:text-white truncate">
                          {item.name}
                        </div>
                        <div className="text-[10.5px] text-[#7D7484] dark:text-[#A493C2]">
                          {activeScopeSubtitle}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold font-mono text-[#5B289B] dark:text-[#D8B4FE] tabular-nums">
                        {item.count} WO
                      </div>
                      <div className="text-[10.5px] font-mono text-[#7D7484] dark:text-[#A493C2] tabular-nums">
                        {item.percent}%
                      </div>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#E8DDFF] dark:bg-[#2E1654] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#5B289B] to-[#8E52D9] dark:from-[#8E52D9] dark:to-[#D8B4FE] transition-all"
                      style={{ width: `${item.percent}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* WO Selesai / Terverifikasi Terakhir */}
        <div className="card-3d-lavender p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />
              <h2 className="text-sm font-display font-bold text-[#1F1638] dark:text-white">
                WO Selesai Terakhir
              </h2>
            </div>
            <span className="text-[11px] font-bold text-[#5B289B] dark:text-[#D8B4FE]">
              {recentCompletedTickets.length} Terbaru
            </span>
          </div>

          {recentCompletedTickets.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#7D7484] dark:text-[#A493C2]">
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
                    className="mj-tactile-well p-3 rounded-xl space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-xs text-[#1F1638] dark:text-white">
                            #{t.woNumber}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold">
                            {t.approvalStatus === 'APPROVED' ? 'Approved' : t.statusWOInstaller}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#4B4452] dark:text-[#C5B3DF] truncate mt-0.5">
                          {t.ticketCategory || 'Work Order'} • {t.customerName}
                        </div>
                      </div>
                      <span className="text-[10.5px] font-mono text-[#7D7484] dark:text-[#A493C2] shrink-0">
                        {timeDisplay}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E5D9FF] dark:border-[#361F5E] text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-[#F3EAFF] dark:bg-[#2E1654] border border-[#DFC7FF] dark:border-[#5B289B]/40 flex items-center justify-center font-bold text-[10px] text-[#5B289B] dark:text-[#D8B4FE] shrink-0">
                          {instInitials}
                        </div>
                        <span className="font-semibold text-[#1F1638] dark:text-white truncate">
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
      <div className="card-3d-lavender overflow-hidden">
        <div className="px-4 py-3.5 border-b border-[#E5D9FF] dark:border-[#361F5E] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />
            <div>
              <h3 className="text-xs sm:text-sm font-display font-bold text-[#1F1638] dark:text-white">
                Matriks Rekap Area & Kontraktor ({groupedData.length} Area)
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="btn-3d-emerald inline-flex items-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="btn-3d-primary inline-flex items-center gap-1.5 min-h-[40px] sm:min-h-[34px] px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
          </div>
        </div>

        {groupedData.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#F3EAFF] dark:bg-[#2E1654] text-[#5B289B] dark:text-[#D8B4FE] border border-[#DFC7FF] dark:border-[#5B289B]/40 flex items-center justify-center">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-[#1F1638] dark:text-[#E8DDFF] text-sm">
              Tidak Ada Data Work Order Sesuai Filter
            </h3>
            <p className="text-xs text-[#4B4452] dark:text-[#C5B3DF] max-w-md mx-auto">
              Tidak ditemukan tiket WO dengan Appointment Date pada rentang {startDate} s/d {endDate}.
            </p>
            <button
              type="button"
              onClick={handleResetFilter}
              className="btn-3d-primary min-h-[44px] sm:min-h-[38px] px-4 py-2 text-xs font-bold rounded-xl cursor-pointer"
            >
              Kembalikan ke Hari Ini
            </button>
          </div>
        ) : isCompactUI ? (
          /* Mobile Grouped Cards Representation for Hierarchical Area -> Contractor Matrix */
          <div className="p-3 space-y-4 bg-[#F8F1FF]/70 dark:bg-[#160D29]/70">
            {groupedData.map(group => (
              <div
                key={group.areaName}
                className="mj-tactile-card overflow-hidden"
              >
                <div className="px-3.5 py-2.5 bg-[#F3EAFF] dark:bg-[#241145] border-b border-[#E5D9FF] dark:border-[#3F2370] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <MapPin className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE] shrink-0" />
                    <span className="font-bold text-xs uppercase tracking-wide text-[#1F1638] dark:text-white truncate">
                      {group.areaName}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-[#5B289B] dark:text-[#D8B4FE] shrink-0 tabular-nums">
                    {group.contractors.length} Mitra · {group.subtotal.totalWO} WO
                  </span>
                </div>

                <div className="divide-y divide-[#E5D9FF]/60 dark:divide-[#361F5E]">
                  {group.contractors.map((c, cIdx) => (
                    <div key={`${group.areaName}-${c.contractorName}`} className="p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-mono text-[#7D7484] dark:text-[#A493C2]">#{cIdx + 1}</span>
                          <Building2 className="w-3.5 h-3.5 text-[#7D7484] dark:text-[#A493C2] shrink-0" />
                          <span className="text-xs font-bold text-[#1F1638] dark:text-white truncate">
                            {c.contractorName}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded-full bg-[#F3EAFF] dark:bg-[#2E1654] border border-[#DFC7FF] dark:border-[#5B289B]/40 font-mono text-xs font-extrabold text-[#5B289B] dark:text-[#D8B4FE] shrink-0 tabular-nums">
                          {c.totalWO} WO
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-1.5 text-center text-[10px]">
                        <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 py-1 px-1">
                          <div className="text-emerald-700 dark:text-emerald-400 font-semibold">Assign</div>
                          <div className="font-mono font-bold text-xs text-emerald-700 dark:text-emerald-300 tabular-nums">
                            {c.assign}
                          </div>
                        </div>
                        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 py-1 px-1">
                          <div className="text-amber-700 dark:text-amber-400 font-semibold">Unasgn</div>
                          <div className="font-mono font-bold text-xs text-amber-700 dark:text-amber-300 tabular-nums">
                            {c.unassign}
                          </div>
                        </div>
                        <div className="rounded-lg bg-teal-50 dark:bg-teal-950/40 py-1 px-1">
                          <div className="text-teal-700 dark:text-teal-400 font-semibold">Comp</div>
                          <div className="font-mono font-bold text-xs text-teal-700 dark:text-teal-300 tabular-nums">
                            {c.complete}
                          </div>
                        </div>
                        <div className="rounded-lg bg-[#F3EAFF] dark:bg-[#2E1654]/60 py-1 px-1">
                          <div className="text-[#5B289B] dark:text-[#D8B4FE] font-semibold">Pend</div>
                          <div className="font-mono font-bold text-xs text-[#5B289B] dark:text-[#E8DDFF] tabular-nums">
                            {c.uncomplete}
                          </div>
                        </div>
                        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 py-1 px-1">
                          <div className="text-rose-700 dark:text-rose-400 font-semibold">Cancel</div>
                          <div className="font-mono font-bold text-xs text-rose-700 dark:text-rose-300 tabular-nums">
                            {c.cancel}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="px-3.5 py-2 bg-[#F8F1FF] dark:bg-[#1E1238] border-t border-[#E5D9FF] dark:border-[#361F5E] flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold">
                  <span className="text-[#5B289B] dark:text-[#D8B4FE] uppercase">
                    Subtotal {group.areaName}
                  </span>
                  <span className="font-mono tabular-nums text-[#1F1638] dark:text-white">
                    {group.subtotal.totalWO} WO · Comp {group.subtotal.complete} · Pend {group.subtotal.uncomplete}
                  </span>
                </div>
              </div>
            ))}

            <div className="rounded-2xl bg-gradient-to-r from-[#160D29] via-[#27104A] to-[#1A0D36] text-white p-4 border border-[#5B289B]/50 space-y-2.5 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#D8B4FE]">GRAND TOTAL</span>
                <span className="font-mono text-lg font-extrabold tabular-nums">{grandTotal.totalWO} WO</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5 text-center text-[10px]">
                <div className="rounded-lg bg-white/10 py-1.5">
                  <div className="text-emerald-300">Assign</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.assign}</div>
                </div>
                <div className="rounded-lg bg-white/10 py-1.5">
                  <div className="text-amber-300">Unasgn</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.unassign}</div>
                </div>
                <div className="rounded-lg bg-white/10 py-1.5">
                  <div className="text-teal-300">Comp</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.complete}</div>
                </div>
                <div className="rounded-lg bg-white/10 py-1.5">
                  <div className="text-[#D8B4FE]">Pend</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.uncomplete}</div>
                </div>
                <div className="rounded-lg bg-white/10 py-1.5">
                  <div className="text-rose-300">Cancel</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.cancel}</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#241145] text-white font-bold border-b border-[#3F2370]">
                  <th className="py-3 px-4 w-12 text-center">No</th>
                  <th className="py-3 px-4">Nama Kontraktor</th>
                  <th className="py-3 px-3 text-right">Total WO</th>
                  <th className="py-3 px-3 text-right text-emerald-300">Assign</th>
                  <th className="py-3 px-3 text-right text-amber-300">Unassign</th>
                  <th className="py-3 px-3 text-right text-teal-300">Complete</th>
                  <th className="py-3 px-3 text-right text-[#D8B4FE]">Uncomplete</th>
                  <th className="py-3 px-3 text-right text-rose-300">Cancel</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5D9FF]/60 dark:divide-[#361F5E] text-[#4B4452] dark:text-[#C5B3DF]">
                {groupedData.map(group => (
                  <React.Fragment key={group.areaName}>
                    <tr className="bg-[#F3EAFF] dark:bg-[#241145] border-t-2 border-b border-[#DFC7FF] dark:border-[#3F2370]">
                      <td colSpan={8} className="py-2.5 px-4 font-bold text-xs text-[#1F1638] dark:text-white">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE] shrink-0" />
                            <span className="tracking-wide uppercase font-bold text-[12px]">
                              AREA: {group.areaName}
                            </span>
                            {group.areaName === 'Belum Ditentukan' && (
                              <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-normal">
                                Perlu Penyesuaian Data
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono text-[#5B289B] dark:text-[#D8B4FE] tabular-nums">
                            {group.contractors.length} Kontraktor | {group.subtotal.totalWO} WO
                          </span>
                        </div>
                      </td>
                    </tr>

                    {group.contractors.map((c, cIdx) => (
                      <tr
                        key={`${group.areaName}-${c.contractorName}`}
                        className="hover:bg-[#F8F1FF] dark:hover:bg-[#1E1238]/60 transition-colors"
                      >
                        <td className="py-2.5 px-4 text-center font-mono text-[#7D7484] dark:text-[#A493C2] text-[11px] tabular-nums">
                          {cIdx + 1}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-[#1F1638] dark:text-white flex items-center gap-2">
                          <Building2 className="w-3.5 h-3.5 text-[#7D7484] dark:text-[#A493C2] shrink-0" />
                          <span>{c.contractorName}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#1F1638] dark:text-white tabular-nums">
                          {c.totalWO}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {c.assign}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                          {c.unassign}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-teal-600 dark:text-teal-400 tabular-nums">
                          {c.complete}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-[#5B289B] dark:text-[#D8B4FE] tabular-nums">
                          {c.uncomplete}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                          {c.cancel}
                        </td>
                      </tr>
                    ))}

                    <tr className="bg-[#F8F1FF] dark:bg-[#1E1238] font-bold border-b border-t border-[#E5D9FF] dark:border-[#361F5E] text-[#1F1638] dark:text-white">
                      <td colSpan={2} className="py-2 px-4 text-right uppercase text-[11px] text-[#5B289B] dark:text-[#D8B4FE]">
                        Subtotal {group.areaName}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-extrabold text-[#5B289B] dark:text-[#D8B4FE] tabular-nums">
                        {group.subtotal.totalWO}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {group.subtotal.assign}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                        {group.subtotal.unassign}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-teal-600 dark:text-teal-400 tabular-nums">
                        {group.subtotal.complete}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-[#5B289B] dark:text-[#D8B4FE] tabular-nums">
                        {group.subtotal.uncomplete}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400 tabular-nums">
                        {group.subtotal.cancel}
                      </td>
                    </tr>
                  </React.Fragment>
                ))}

                <tr className="bg-[#160D29] text-white font-extrabold border-t-2 border-[#7135B5] text-sm">
                  <td colSpan={2} className="py-3 px-4 text-right uppercase tracking-wider text-xs text-[#D8B4FE]">
                    GRAND TOTAL KESELURUHAN
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-white text-base tabular-nums">
                    {grandTotal.totalWO}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-300 tabular-nums">
                    {grandTotal.assign}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-amber-300 tabular-nums">
                    {grandTotal.unassign}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-teal-300 tabular-nums">
                    {grandTotal.complete}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-[#D8B4FE] tabular-nums">
                    {grandTotal.uncomplete}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-300 tabular-nums">
                    {grandTotal.cancel}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom Export CTA Strip */}
      <div className="card-3d-lavender p-4 text-center space-y-2">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={handleExportExcel}
            className="btn-3d-lilac flex-1 max-w-md mx-auto sm:mx-0 min-h-[44px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Download className="w-4 h-4 text-[#5B289B] dark:text-[#D8B4FE]" />
            <span>Export Laporan Rekap (Excel)</span>
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="btn-3d-primary flex-1 max-w-md mx-auto sm:mx-0 min-h-[44px] py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak / Simpan PDF</span>
          </button>
        </div>
        <p className="text-[11px] text-[#7D7484] dark:text-[#A493C2]">
          Format laporan resmi operasional NOC & Dispatch MoraJaws • Data langsung dari database produksi
        </p>
      </div>
    </div>
  );
};
