import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { Ticket } from '../../types';
import {
  Building2,
  MapPin,
  Calendar,
  Printer,
  Layers,
  CheckCircle2,
  Clock,
  XCircle,
  FileSpreadsheet,
  Radio,
  Gauge,
  PieChart,
  Wrench,
  Home,
  Wifi,
  Download,
  Eye,
  TrendingUp,
  Award
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  getJakartaDateString,
  getTicketAppointmentDate,
  formatAppointmentDateDisplay
} from '../../services/appointmentDateParser';
import { useToast } from '../../context/ToastContext';
import { ResponsiveModal } from '../common/ResponsiveModal';
import ftthInspectionImg from '../../assets/images/leader_ftth_inspection_1794890485687.jpg';
import {
  HeaderCategoryDropdown,
  HeaderDateSortFilterPopover,
  HeaderSearchPopover,
  HeaderSortButton,
  TableResetFilterButton
} from '../common/InteractiveTableHeader';
import {
  SortState,
  getNextSortDirection,
  sortDataArray
} from '../../utils/tableSorting';

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
  const defaultArea = isLeader && leaderArea ? leaderArea : 'ALL';
  const defaultContractor = isLeader && leaderContractor ? leaderContractor : 'ALL';
  const [selectedArea, setSelectedArea] = useState<string>(defaultArea);
  const [selectedContractor, setSelectedContractor] = useState<string>(defaultContractor);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('today');
  const [startDate, setStartDate] = useState<string>(todayWIB);
  const [endDate, setEndDate] = useState<string>(todayWIB);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortState, setSortState] = useState<SortState>({ column: null, direction: null });
  const [detailScope, setDetailScope] = useState<{ areaName: string; contractorName?: string } | null>(null);

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

  const activeFilterCount =
    (selectedArea !== defaultArea ? 1 : 0) +
    (selectedContractor !== defaultContractor ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0) +
    (periodPreset !== 'today' || startDate !== todayWIB || endDate !== todayWIB ? 1 : 0);

  // Handle Reset Filter
  const handleResetFilter = () => {
    setSelectedArea(defaultArea);
    setSelectedContractor(defaultContractor);
    setPeriodPreset('today');
    setStartDate(todayWIB);
    setEndDate(todayWIB);
    setSearchQuery('');
    setSortState({ column: null, direction: null });
    toast.info('Filter dikembalikan ke pengaturan default (Hari ini WIB).', 'Filter Direset');
  };

  const handleSort = (columnKey: string) => {
    setSortState(prev => {
      const nextDir = getNextSortDirection(prev.column, prev.direction, columnKey);
      return {
        column: nextDir ? columnKey : null,
        direction: nextDir
      };
    });
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

    const areaEntries = Array.from(areaMap.entries()).map(([areaName, contractorsInArea]) => {
      const rawContractors = Array.from(contractorsInArea.values());
      const contractors =
        sortState.column && sortState.direction && sortState.column !== 'areaName'
          ? sortDataArray(rawContractors, sortState, (c: ContractorRowData, col: string) => {
              if (col === 'contractorName') return c.contractorName;
              if (col === 'completionRate') {
                return c.totalWO > 0 ? c.complete / c.totalWO : 0;
              }
              return (c as any)[col] ?? 0;
            })
          : rawContractors.sort((a, b) => a.contractorName.localeCompare(b.contractorName));

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

      return {
        areaName,
        contractors,
        subtotal
      };
    });

    if (sortState.column && sortState.direction) {
      return sortDataArray(areaEntries, sortState, (g: AreaGroupData, col: string) => {
        if (col === 'areaName' || col === 'contractorName') return g.areaName;
        if (col === 'completionRate') {
          return g.subtotal.totalWO > 0 ? g.subtotal.complete / g.subtotal.totalWO : 0;
        }
        return (g.subtotal as any)[col] ?? 0;
      });
    }

    return areaEntries.sort((a, b) => {
      if (a.areaName === 'Belum Ditentukan') return 1;
      if (b.areaName === 'Belum Ditentukan') return -1;
      return a.areaName.localeCompare(b.areaName);
    });
  }, [filteredTickets, sortState]);

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

  // Real 7-day completion trend across consecutive WIB dates ending at endDate || todayWIB
  const dailyTrend = useMemo(() => {
    const anchorStr = endDate || todayWIB;
    const anchorDate = new Date(`${anchorStr}T12:00:00+07:00`);
    const daysList: Array<{ dateKey: string; dayLabel: string; total: number; complete: number }> = [];
    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

    for (let offset = -6; offset <= 0; offset++) {
      const d = new Date(anchorDate.getTime() + offset * 86400000);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const dateKey = `${yyyy}-${mm}-${dd}`;
      daysList.push({
        dateKey,
        dayLabel: dayNames[d.getUTCDay()] || dd,
        total: 0,
        complete: 0
      });
    }

    const dayMap = new Map(daysList.map(item => [item.dateKey, item]));
    activeTickets.forEach(t => {
      const appt = getTicketAppointmentDate(t);
      if (!appt || !dayMap.has(appt)) return;

      const ticketArea = (t.area || '').trim() || 'Belum Ditentukan';
      if (selectedArea !== 'ALL' && ticketArea.toLowerCase() !== selectedArea.toLowerCase()) return;

      const ticketContractor =
        (t.contactorName || t.contractorName || (t as any).contractor || (t as any).vendorName || '').trim() ||
        'Belum Ditentukan';
      if (selectedContractor !== 'ALL' && ticketContractor.toLowerCase() !== selectedContractor.toLowerCase()) return;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          ticketArea.toLowerCase().includes(q) ||
          ticketContractor.toLowerCase().includes(q) ||
          String(t.woNumber ?? '').toLowerCase().includes(q) ||
          String(t.installerName ?? '').toLowerCase().includes(q);
        if (!match) return;
      }

      const bucket = dayMap.get(appt)!;
      bucket.total += 1;
      if (classifyTicketStatus(t).isComplete) {
        bucket.complete += 1;
      }
    });

    const maxCount = Math.max(1, ...daysList.map(d => Math.max(d.complete, d.total)));
    const totalDaysWithVolume = daysList.filter(d => d.total > 0).length;
    const sumTotal = daysList.reduce((acc, d) => acc + d.total, 0);
    const targetDaily = totalDaysWithVolume > 0 ? Math.round(sumTotal / totalDaysWithVolume) : 0;

    return { days: daysList, maxCount, targetDaily };
  }, [activeTickets, endDate, todayWIB, selectedArea, selectedContractor, searchQuery]);

  // Top performing area from groupedData
  const topCluster = useMemo(() => {
    if (groupedData.length === 0) return null;
    return [...groupedData]
      .filter(g => g.subtotal.totalWO > 0)
      .sort((a, b) => {
        const rateA = a.subtotal.totalWO > 0 ? a.subtotal.complete / a.subtotal.totalWO : 0;
        const rateB = b.subtotal.totalWO > 0 ? b.subtotal.complete / b.subtotal.totalWO : 0;
        if (rateB !== rateA) return rateB - rateA;
        return b.subtotal.complete - a.subtotal.complete;
      })[0] || null;
  }, [groupedData]);

  // Drill-down tickets for "Lihat Rincian" modal
  const detailTickets = useMemo(() => {
    if (!detailScope) return [];
    return filteredTickets.filter(t => {
      const areaKey = (t.area || '').trim() || 'Belum Ditentukan';
      if (areaKey !== detailScope.areaName) return false;
      if (detailScope.contractorName) {
        const contractorKey =
          (t.contactorName || t.contractorName || (t as any).contractor || (t as any).vendorName || '').trim() ||
          'Belum Ditentukan';
        if (contractorKey !== detailScope.contractorName) return false;
      }
      return true;
    });
  }, [detailScope, filteredTickets]);

  // List of available areas and contractors (strictly scoped when Leader role)
  const availableAreas = useMemo(() => {
    const set = new Set<string>();
    activeTickets.forEach(t => {
      const a = (t.area || '').trim();
      if (a) {
        if (!isLeader || !leaderArea || a.toLowerCase() === leaderArea.toLowerCase()) {
          set.add(a);
        }
      }
    });
    if (!isLeader || !leaderArea) {
      areasList.forEach(a => set.add(a));
    } else if (leaderArea) {
      set.add(leaderArea);
    }
    return Array.from(set).sort();
  }, [activeTickets, areasList, isLeader, leaderArea]);

  const availableContractors = useMemo(() => {
    const set = new Set<string>();
    activeTickets.forEach(t => {
      const c = (t.contactorName || t.contractorName || (t as any).contractor || (t as any).vendorName || '').trim();
      if (c) {
        if (!isLeader || !leaderContractor || c.toLowerCase() === leaderContractor.toLowerCase()) {
          set.add(c);
        }
      }
    });
    if (!isLeader || !leaderContractor) {
      contractorsList.forEach(c => set.add(c));
    } else if (leaderContractor) {
      set.add(leaderContractor);
    }
    return Array.from(set).sort();
  }, [activeTickets, contractorsList, isLeader, leaderContractor]);

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
      return <Home className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />;
    }
    if (lower.includes('repair') || lower.includes('gangguan') || lower.includes('maint')) {
      return <Wrench className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />;
    }
    return <Wifi className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />;
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
            <Calendar className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
            <h1 className="text-base sm:text-lg font-bold text-[#26364A] dark:text-white font-display">
              Periode Laporan
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="tactile-chip inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold text-[#26364A] dark:text-[#D8B4FE]">
              <span className={`w-2 h-2 rounded-full ${databaseStatus === 'offline' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <span>Sinkron {wibTimeLabel} WIB</span>
            </span>

            <HeaderDateSortFilterPopover
              label={periodPreset === 'custom' ? `${startDate || '?'}..${endDate || '?'}` : 'Rentang Tanggal'}
              exactDate={startDate === endDate ? startDate : ''}
              dateFrom={startDate !== endDate ? startDate : ''}
              dateTo={startDate !== endDate ? endDate : ''}
              onChangeDates={({ exactDate, dateFrom, dateTo }) => {
                if (exactDate) {
                  setStartDate(exactDate);
                  setEndDate(exactDate);
                  setPeriodPreset(exactDate === todayWIB ? 'today' : 'custom');
                } else {
                  setStartDate(dateFrom || todayWIB);
                  setEndDate(dateTo || dateFrom || todayWIB);
                  setPeriodPreset('custom');
                }
              }}
            />

            <TableResetFilterButton
              activeCount={activeFilterCount}
              onReset={handleResetFilter}
              label="Reset Search/Filter"
              testId="contractor-recap-reset-filters"
            />
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
                    : 'text-[#52647A] dark:text-[#C5B3DF] hover:text-[#26364A] dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#52647A] dark:text-[#C5B3DF]">
          <div className="flex items-center gap-1.5 font-medium">
            <Calendar className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A493C2]" />
            <span>
              {startDate === endDate
                ? `${formatAppointmentDateDisplay(startDate)} (${startDate})`
                : `${startDate} s/d ${endDate} WIB`}
            </span>
          </div>
          <span className="font-bold text-[#5145A6] dark:text-[#D8B4FE] truncate">
            {activeScopeSubtitle}
          </span>
        </div>

        {isCompactUI && (
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-[#DDE6F0] dark:border-[#361F5E]">
            <HeaderCategoryDropdown
              label="Area"
              value={selectedArea}
              defaultValue={defaultArea}
              allLabel="Semua Area"
              options={[
                ...(!isLeader || !leaderArea ? [{ value: 'ALL', label: `Semua Area (${availableAreas.length})` }] : []),
                ...availableAreas.map(area => ({ value: area, label: area }))
              ]}
              onChange={val => setSelectedArea(val)}
            />
            <HeaderCategoryDropdown
              label="Kontraktor"
              value={selectedContractor}
              defaultValue={defaultContractor}
              allLabel="Semua Kontraktor"
              options={[
                ...(!isLeader || !leaderContractor ? [{ value: 'ALL', label: `Semua Kontraktor (${availableContractors.length})` }] : []),
                ...availableContractors.map(c => ({ value: c, label: c }))
              ]}
              onChange={val => setSelectedContractor(val)}
            />
            <HeaderSearchPopover
              label="Cari WO / Mitra"
              value={searchQuery}
              onChange={val => setSearchQuery(val)}
              placeholder="Cari area, mitra, #WO..."
            />
          </div>
        )}
      </div>

      {/* 01 / REKAPITULASI OPERASIONAL: 5-Card Executive KPI Strip */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 px-1">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#5145A6] dark:text-[#D8B4FE]">
              <span className="px-2 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#2E1459] border border-[#C5BEEF] dark:border-[#5B35B1]">
                01 / REKAPITULASI OPERASIONAL
              </span>
              <span className="text-[#8492A5] dark:text-[#A493C2]">{activeScopeSubtitle}</span>
            </div>
            <h2 className="font-display text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white mt-1">
              Rekap Work Order (Mitra &amp; Area)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="btn-3d-lilac px-3 py-1.5 min-h-[36px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
              <span>Cetak Ringkasan</span>
            </button>
            <button
              type="button"
              onClick={handleExportExcel}
              className="btn-3d-darkpurple px-3.5 py-1.5 min-h-[36px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-[#D8B4FE]" />
              <span>Export Rekap Excel</span>
            </button>
          </div>
        </div>

        {/* 5 KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {/* KPI 1: Total WO Masuk */}
          <div className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
                TOTAL WO MASUK
              </span>
              <span className="w-7 h-7 rounded-lg bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#D8B4FE] flex items-center justify-center shrink-0">
                <Layers className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-display text-2xl sm:text-3xl font-extrabold font-mono text-[#26364A] dark:text-white tabular-nums">
                {grandTotal.totalWO}
              </span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF]">
                {executionRates.assignPct}% Assign
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-[#DDE6F0] dark:bg-[#2E1654] overflow-hidden">
              <div className="h-full rounded-full bg-[#6657C8] dark:bg-[#58149C] transition-all" style={{ width: `${Math.min(100, executionRates.assignPct)}%` }} />
            </div>
          </div>

          {/* KPI 2: HIGHLIGHTED HERO CARD */}
          <div className="rounded-2xl p-4 bg-gradient-to-br from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#240C45] dark:via-[#35105E] dark:to-[#480123] text-[#26364A] dark:text-white border border-[#C5BEEF] dark:border-[#7135B5]/50 shadow-sm dark:shadow-[0_10px_24px_-6px_rgba(53,16,94,0.45)] flex flex-col justify-between gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                TOTAL SELESAI / COMPLETE
              </span>
              <span className="w-7 h-7 rounded-lg bg-white/80 dark:bg-white/15 border border-[#C5BEEF] dark:border-white/20 text-[#2E7D8B] dark:text-white flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl sm:text-3xl font-extrabold font-mono text-[#26364A] dark:text-white tabular-nums">
                {grandTotal.complete}
              </span>
              <span className="text-xs font-mono font-bold text-[#2E7D8B] dark:text-[#DAB9FF]">
                {executionRates.completionPct}%
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-[#DDE6F0] dark:bg-white/15 overflow-hidden">
              <div className="h-full rounded-full bg-[#6657C8] dark:bg-[#DAB9FF] transition-all" style={{ width: `${executionRates.completionPct}%` }} />
            </div>
          </div>

          {/* KPI 3: Dalam Proses / Check-in */}
          <div className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
                DALAM PROSES / CHECK-IN
              </span>
              <span className="w-7 h-7 rounded-lg bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#D8B4FE] flex items-center justify-center shrink-0">
                <Gauge className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl sm:text-3xl font-extrabold font-mono text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                {grandTotal.uncomplete}
              </span>
              <span className="text-xs font-mono font-bold text-[#8492A5] dark:text-[#A493C2]">
                {grandTotal.totalWO > 0 ? Math.round((grandTotal.uncomplete / grandTotal.totalWO) * 1000) / 10 : 0}%
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-[#DDE6F0] dark:bg-[#2E1654] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#6657C8] dark:bg-[#7135B5] transition-all"
                style={{ width: `${grandTotal.totalWO > 0 ? Math.min(100, Math.round((grandTotal.uncomplete / grandTotal.totalWO) * 100)) : 0}%` }}
              />
            </div>
          </div>

          {/* KPI 4: Belum Di-Assign / Pending Queue */}
          <div className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between gap-2.5">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
                BELUM DI-ASSIGN
              </span>
              <span className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
                <Clock className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl sm:text-3xl font-extrabold font-mono text-[#26364A] dark:text-white tabular-nums">
                {grandTotal.unassign}
              </span>
              <span className="text-xs font-mono font-bold text-amber-600 dark:text-amber-400">
                {grandTotal.totalWO > 0 ? Math.round((grandTotal.unassign / grandTotal.totalWO) * 1000) / 10 : 0}%
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-amber-100 dark:bg-amber-950 overflow-hidden">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${grandTotal.totalWO > 0 ? Math.min(100, Math.round((grandTotal.unassign / grandTotal.totalWO) * 100)) : 0}%` }}
              />
            </div>
          </div>

          {/* KPI 5: Cancel (Maroon) */}
          <div className="card-3d-lavender rounded-2xl p-4 flex flex-col justify-between gap-2.5 col-span-2 sm:col-span-1">
            <div className="flex items-start justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#881337] dark:text-rose-300">
                CANCEL
              </span>
              <span className="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/60 text-[#881337] dark:text-rose-300 flex items-center justify-center shrink-0">
                <XCircle className="w-3.5 h-3.5" />
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-2xl sm:text-3xl font-extrabold font-mono text-[#881337] dark:text-rose-300 tabular-nums">
                {grandTotal.cancel}
              </span>
              <span className="text-xs font-mono font-bold text-[#881337]/80 dark:text-rose-400">
                {grandTotal.totalWO > 0 ? Math.round((grandTotal.cancel / grandTotal.totalWO) * 1000) / 10 : 0}%
              </span>
            </div>
            <div className="h-1 w-full rounded-full bg-rose-100 dark:bg-rose-950 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#881337] transition-all"
                style={{ width: `${grandTotal.totalWO > 0 ? Math.min(100, Math.round((grandTotal.cancel / grandTotal.totalWO) * 100)) : 0}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 02 / TREN HARIAN (8 COL SVG CHART) & EVALUASI CEPAT TOP CLUSTER (4 COL) */}
      <div className={isCompactUI ? 'grid grid-cols-1 gap-4' : 'grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch'}>
        {/* Left 8 Cols: Real 7-Day SVG Bar Chart */}
        <div className={`${isCompactUI ? '' : 'lg:col-span-8'} card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#5145A6] dark:text-[#D8B4FE]">
                02 / TREN HARIAN (7 HARI HINGGA {endDate || todayWIB})
              </div>
              <h3 className="font-display text-base font-extrabold text-[#26364A] dark:text-white mt-0.5 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
                <span>Tren Penyelesaian Work Order</span>
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1.5 text-[#26364A] dark:text-white">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#6657C8] dark:bg-[#58149C]" />
                <span>Selesai (Complete)</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-[#8492A5] dark:text-[#A493C2]">
                <span className="w-3 border-t-2 border-dashed border-[#881337]" />
                <span>Rata Target ({dailyTrend.targetDaily} WO)</span>
              </span>
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg viewBox="0 0 640 190" className="w-full min-w-[420px] h-44 overflow-visible" role="img" aria-label="Grafik Tren Penyelesaian Work Order 7 Hari">
              {/* Target dashed line */}
              {dailyTrend.targetDaily > 0 && (
                <>
                  <line
                    x1="16"
                    x2="624"
                    y1={Math.round(145 - (dailyTrend.targetDaily / dailyTrend.maxCount) * 110)}
                    y2={Math.round(145 - (dailyTrend.targetDaily / dailyTrend.maxCount) * 110)}
                    stroke="#881337"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                    opacity="0.7"
                  />
                  <text
                    x="18"
                    y={Math.max(14, Math.round(145 - (dailyTrend.targetDaily / dailyTrend.maxCount) * 110) - 6)}
                    className="fill-[#881337] dark:fill-rose-300 text-[10px] font-mono font-bold"
                  >
                    Avg {dailyTrend.targetDaily} WO
                  </text>
                </>
              )}

              {/* 7 Daily Bars */}
              {dailyTrend.days.map((day, idx) => {
                const slotW = 86;
                const centerX = 48 + idx * slotW;
                const barW = 42;
                const totalH = day.total > 0 ? Math.max(8, Math.round((day.total / dailyTrend.maxCount) * 110)) : 4;
                const compH = day.complete > 0 ? Math.max(8, Math.round((day.complete / dailyTrend.maxCount) * 110)) : 0;
                const isPeak = day.complete > 0 && day.complete === Math.max(...dailyTrend.days.map(d => d.complete));

                return (
                  <g key={day.dateKey}>
                    {/* Background total WO bar */}
                    <rect
                      x={centerX - barW / 2}
                      y={145 - totalH}
                      width={barW}
                      height={totalH}
                      rx="8"
                      className="fill-[#EAE8FF] dark:fill-[#2E1459]"
                    />
                    {/* Foreground completed WO bar */}
                    {compH > 0 && (
                      <rect
                        x={centerX - barW / 2}
                        y={145 - compH}
                        width={barW}
                        height={compH}
                        rx="8"
                        className={isPeak ? 'fill-[#5145A6] dark:fill-[#35105E]' : 'fill-[#2E7D8B] dark:fill-[#7135B5]'}
                      />
                    )}
                    {/* Value Label */}
                    <text
                      x={centerX}
                      y={145 - Math.max(totalH, compH) - 6}
                      textAnchor="middle"
                      className="fill-[#26364A] dark:fill-white text-[11px] font-mono font-bold"
                    >
                      {day.complete}/{day.total}
                    </text>
                    {/* Day Name & Date */}
                    <text
                      x={centerX}
                      y={166}
                      textAnchor="middle"
                      className="fill-[#52647A] dark:fill-[#E9D5FF] text-[11px] font-bold"
                    >
                      {day.dayLabel}
                    </text>
                    <text
                      x={centerX}
                      y={180}
                      textAnchor="middle"
                      className="fill-[#8492A5] dark:fill-[#A493C2] text-[9.5px] font-mono"
                    >
                      {day.dateKey.slice(5)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Right 4 Cols: Evaluasi Cepat (Performa Kluster Terbaik + OPM & Assign Rate) */}
        <div className={`${isCompactUI ? '' : 'lg:col-span-4'} card-3d-lavender bg-[#F4F7FB] dark:bg-[#1E1238] rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4`}>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[#5145A6] dark:text-[#D8B4FE]">
                  EVALUASI CEPAT
                </div>
                <h3 className="font-display text-base font-extrabold text-[#26364A] dark:text-white mt-0.5">
                  Performa Kluster Terbaik
                </h3>
              </div>
              <div className="w-10 h-10 rounded-xl overflow-hidden border border-[#C5BEEF] dark:border-[#5B35B1] shrink-0">
                <img src={ftthInspectionImg} alt="Inspeksi FTTH" className="w-full h-full object-cover" />
              </div>
            </div>

            {topCluster ? (
              <div className="mj-tactile-well p-3.5 rounded-xl flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                    <Award className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-[#26364A] dark:text-white truncate">
                      {topCluster.areaName}
                    </div>
                    <div className="text-[11px] text-[#8492A5] dark:text-[#A493C2] font-mono">
                      {topCluster.subtotal.complete} / {topCluster.subtotal.totalWO} WO Selesai
                    </div>
                  </div>
                </div>
                <span className="font-display text-lg font-extrabold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums shrink-0">
                  {topCluster.subtotal.totalWO > 0
                    ? `${Math.round((topCluster.subtotal.complete / topCluster.subtotal.totalWO) * 1000) / 10}%`
                    : '0%'}
                </span>
              </div>
            ) : (
              <div className="mj-tactile-well p-3.5 rounded-xl text-xs text-[#8492A5] dark:text-[#A493C2]">
                Belum ada kluster area pada rentang tanggal ini.
              </div>
            )}
          </div>

          {/* Telemetry Bar: Assign Rate & Real Avg OPM */}
          <div className="rounded-xl bg-gradient-to-r from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#160D29] dark:via-[#27104A] dark:to-[#480123] text-[#26364A] dark:text-white p-3.5 grid grid-cols-2 gap-3 border border-[#C5BEEF] dark:border-[#7135B5]/40 shadow-sm">
            <div className="min-w-0">
              <div className="text-[10px] text-[#5145A6] dark:text-[#D8B4FE] uppercase font-bold">Assign Rate</div>
              <div className="text-lg font-bold font-mono leading-tight tabular-nums mt-0.5">
                {executionRates.assignPct}%
              </div>
              <div className="text-[10px] text-[#52647A] dark:text-[#E8DDFF]/75 truncate">
                {grandTotal.assign}/{grandTotal.totalWO} Terassign
              </div>
            </div>
            <div className="border-l border-[#C5BEEF] dark:border-[#D8B4FE]/20 pl-3 min-w-0">
              <div className="text-[10px] text-[#2E7D8B] dark:text-[#D8B4FE] uppercase font-bold">Rata-rata OPM</div>
              <div className="text-lg font-bold font-mono leading-tight tabular-nums mt-0.5">
                {executionRates.avgOpm !== null ? `${executionRates.avgOpm} dBm` : 'N/A'}
              </div>
              <div className="text-[10px] text-[#52647A] dark:text-[#E8DDFF]/75 truncate">
                {executionRates.opmCount > 0 ? `${executionRates.optimalOpmCount}/${executionRates.opmCount} Optimal` : 'Belum ada data OPM'}
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
              <PieChart className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
              <h2 className="text-sm font-display font-bold text-[#26364A] dark:text-white">
                Distribusi Jenis Pekerjaan
              </h2>
            </div>
            <span className="text-[11px] font-semibold text-[#8492A5] dark:text-[#A493C2]">
              Total {categoryDistribution.length} Kategori
            </span>
          </div>

          {categoryDistribution.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#8492A5] dark:text-[#A493C2]">
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
                      <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#241145] border border-[#DDE6F0] dark:border-[#4B2680] flex items-center justify-center shrink-0">
                        {renderCategoryIcon(item.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                          {item.name}
                        </div>
                        <div className="text-[10.5px] text-[#8492A5] dark:text-[#A493C2]">
                          {activeScopeSubtitle}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs font-bold font-mono text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                        {item.count} WO
                      </div>
                      <div className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#A493C2] tabular-nums">
                        {item.percent}%
                      </div>
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#DDE6F0] dark:bg-[#2E1654] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#5145A6] to-[#2E7D8B] dark:from-[#8E52D9] dark:to-[#D8B4FE] transition-all"
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
              <CheckCircle2 className="w-4 h-4 text-[#2E7D8B] dark:text-[#D8B4FE]" />
              <h2 className="text-sm font-display font-bold text-[#26364A] dark:text-white">
                WO Selesai Terakhir
              </h2>
            </div>
            <span className="text-[11px] font-bold text-[#5145A6] dark:text-[#D8B4FE]">
              {recentCompletedTickets.length} Terbaru
            </span>
          </div>

          {recentCompletedTickets.length === 0 ? (
            <div className="py-8 text-center text-xs text-[#8492A5] dark:text-[#A493C2]">
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
                          <span className="font-mono font-bold text-xs text-[#26364A] dark:text-white">
                            #{t.woNumber}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[10px] font-bold">
                            {t.approvalStatus === 'APPROVED' ? 'Approved' : t.statusWOInstaller}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#52647A] dark:text-[#C5B3DF] truncate mt-0.5">
                          {t.ticketCategory || 'Work Order'} • {t.customerName}
                        </div>
                      </div>
                      <span className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#A493C2] shrink-0">
                        {timeDisplay}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#DDE6F0] dark:border-[#361F5E] text-[11px]">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-[#EAE8FF] dark:bg-[#2E1654] border border-[#C5BEEF] dark:border-[#5B289B]/40 flex items-center justify-center font-bold text-[10px] text-[#5145A6] dark:text-[#D8B4FE] shrink-0">
                          {instInitials}
                        </div>
                        <span className="font-semibold text-[#26364A] dark:text-white truncate">
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
        <div className="px-4 py-3.5 border-b border-[#DDE6F0] dark:border-[#361F5E] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
            <div>
              <h3 className="text-xs sm:text-sm font-display font-bold text-[#26364A] dark:text-white">
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
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#DDF4F4] dark:bg-[#2E1654] text-[#2E7D8B] dark:text-[#D8B4FE] border border-[#BDE4E8] dark:border-[#5B289B]/40 flex items-center justify-center">
              <Layers className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-[#26364A] dark:text-[#E8DDFF] text-sm">
              Tidak Ada Data Work Order Sesuai Filter
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#C5B3DF] max-w-md mx-auto">
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
          <div className="p-3 space-y-4 bg-[#F4F7FB]/80 dark:bg-[#160D29]/70">
            {groupedData.map(group => (
              <div
                key={group.areaName}
                className="mj-tactile-card overflow-hidden"
              >
                <div className="px-3.5 py-2.5 bg-[#EDF3F8] dark:bg-[#241145] border-b border-[#DDE6F0] dark:border-[#3F2370] flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <MapPin className="w-4 h-4 text-[#2E7D8B] dark:text-[#D8B4FE] shrink-0" />
                    <span className="font-bold text-xs uppercase tracking-wide text-[#26364A] dark:text-white truncate">
                      {group.areaName}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] shrink-0 tabular-nums">
                    {group.contractors.length} Mitra · {group.subtotal.totalWO} WO
                  </span>
                </div>

                <div className="divide-y divide-[#E2E8F0] dark:divide-[#361F5E]">
                  {group.contractors.map((c, cIdx) => {
                    const rowRate = c.totalWO > 0 ? Math.round((c.complete / c.totalWO) * 1000) / 10 : 0;
                    return (
                      <div key={`${group.areaName}-${c.contractorName}`} className="p-3 space-y-2.5 bg-white dark:bg-transparent">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-mono text-[#8492A5] dark:text-[#A493C2]">#{cIdx + 1}</span>
                            <Building2 className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A493C2] shrink-0" />
                            <span className="text-xs font-bold text-[#26364A] dark:text-white truncate">
                              {c.contractorName}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#2E1654] border border-[#C5BEEF] dark:border-[#5B289B]/40 font-mono text-xs font-extrabold text-[#5145A6] dark:text-[#D8B4FE] shrink-0 tabular-nums">
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
                          <div className="rounded-lg bg-[#EAE8FF] dark:bg-[#2E1654] py-1 px-1">
                            <div className="text-[#5145A6] dark:text-[#D8B4FE] font-semibold">Comp</div>
                            <div className="font-mono font-bold text-xs text-[#5145A6] dark:text-white tabular-nums">
                              {c.complete}
                            </div>
                          </div>
                          <div className="rounded-lg bg-[#DDF4F4]/80 dark:bg-[#2E1654]/60 py-1 px-1">
                            <div className="text-[#2E7D8B] dark:text-[#D8B4FE] font-semibold">Pend</div>
                            <div className="font-mono font-bold text-xs text-[#2E7D8B] dark:text-[#E8DDFF] tabular-nums">
                              {c.uncomplete}
                            </div>
                          </div>
                          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 py-1 px-1">
                            <div className="text-[#881337] dark:text-rose-400 font-semibold">Cancel</div>
                            <div className="font-mono font-bold text-xs text-[#881337] dark:text-rose-300 tabular-nums">
                              {c.cancel}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-1">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="h-1.5 flex-1 rounded-full bg-[#DDE6F0] dark:bg-[#2E1654] overflow-hidden">
                              <div className="h-full rounded-full bg-[#5145A6] dark:bg-[#58149C]" style={{ width: `${rowRate}%` }} />
                            </div>
                            <span className="font-mono text-[10.5px] font-bold text-[#5145A6] dark:text-[#D8B4FE] shrink-0">
                              {rowRate}%
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setDetailScope({ areaName: group.areaName, contractorName: c.contractorName })}
                            className="btn-3d-darkpurple px-2.5 py-1 rounded-lg text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer shrink-0"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Lihat Rincian</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="px-3.5 py-2 bg-[#F4F7FB] dark:bg-[#1E1238] border-t border-[#DDE6F0] dark:border-[#361F5E] flex flex-wrap items-center justify-between gap-2 text-[11px] font-bold">
                  <span className="text-[#5145A6] dark:text-[#D8B4FE] uppercase">
                    Subtotal {group.areaName}
                  </span>
                  <span className="font-mono tabular-nums text-[#26364A] dark:text-white">
                    {group.subtotal.totalWO} WO · Comp {group.subtotal.complete} · Pend {group.subtotal.uncomplete}
                  </span>
                </div>
              </div>
            ))}

            <div className="rounded-2xl bg-gradient-to-r from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#160D29] dark:via-[#27104A] dark:to-[#480123] text-[#26364A] dark:text-white p-4 border border-[#C5BEEF] dark:border-[#7135B5]/50 space-y-2.5 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">GRAND TOTAL</span>
                <span className="font-mono text-lg font-extrabold tabular-nums">{grandTotal.totalWO} WO</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5 text-center text-[10px]">
                <div className="rounded-lg bg-white/80 dark:bg-white/10 border border-[#DDE6F0] dark:border-transparent py-1.5">
                  <div className="text-emerald-700 dark:text-emerald-300 font-semibold">Assign</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.assign}</div>
                </div>
                <div className="rounded-lg bg-white/80 dark:bg-white/10 border border-[#DDE6F0] dark:border-transparent py-1.5">
                  <div className="text-amber-700 dark:text-amber-300 font-semibold">Unasgn</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.unassign}</div>
                </div>
                <div className="rounded-lg bg-white/80 dark:bg-white/10 border border-[#DDE6F0] dark:border-transparent py-1.5">
                  <div className="text-[#5145A6] dark:text-[#DAB9FF] font-semibold">Comp</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.complete}</div>
                </div>
                <div className="rounded-lg bg-white/80 dark:bg-white/10 border border-[#DDE6F0] dark:border-transparent py-1.5">
                  <div className="text-[#2E7D8B] dark:text-[#D8B4FE] font-semibold">Pend</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.uncomplete}</div>
                </div>
                <div className="rounded-lg bg-white/80 dark:bg-white/10 border border-[#DDE6F0] dark:border-transparent py-1.5">
                  <div className="text-rose-700 dark:text-rose-300 font-semibold">Cancel</div>
                  <div className="font-mono font-bold text-xs tabular-nums">{grandTotal.cancel}</div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#EDF3F8] dark:bg-[#241145] text-[#26364A] dark:text-white font-bold border-b border-[#DDE6F0] dark:border-[#3F2370]">
                  <th className="py-3 px-4 w-12 text-center">No</th>
                  <th className="py-3 px-4 min-w-[260px]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <HeaderCategoryDropdown
                        label="Area"
                        value={selectedArea}
                        defaultValue={defaultArea}
                        allLabel="Semua Area"
                        options={[
                          ...(!isLeader || !leaderArea ? [{ value: 'ALL', label: `Semua Area (${availableAreas.length})` }] : []),
                          ...availableAreas.map(area => ({ value: area, label: area }))
                        ]}
                        onChange={val => setSelectedArea(val)}
                        sortActive={sortState.column === 'areaName'}
                        sortDir={sortState.column === 'areaName' ? sortState.direction : null}
                        onCycleSort={() => handleSort('areaName')}
                      />
                      <HeaderCategoryDropdown
                        label="Kontraktor"
                        value={selectedContractor}
                        defaultValue={defaultContractor}
                        allLabel="Semua Kontraktor"
                        options={[
                          ...(!isLeader || !leaderContractor ? [{ value: 'ALL', label: `Semua Kontraktor (${availableContractors.length})` }] : []),
                          ...availableContractors.map(c => ({ value: c, label: c }))
                        ]}
                        onChange={val => setSelectedContractor(val)}
                        sortActive={sortState.column === 'contractorName'}
                        sortDir={sortState.column === 'contractorName' ? sortState.direction : null}
                        onCycleSort={() => handleSort('contractorName')}
                      />
                      <HeaderSearchPopover
                        label="Cari"
                        value={searchQuery}
                        onChange={val => setSearchQuery(val)}
                        placeholder="Area, mitra, #WO..."
                      />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right">
                    <div className="flex justify-end">
                      <HeaderSortButton
                        label="Total WO"
                        active={sortState.column === 'totalWO'}
                        direction={sortState.column === 'totalWO' ? sortState.direction : null}
                        onClick={() => handleSort('totalWO')}
                      />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right text-emerald-700 dark:text-emerald-300">
                    <div className="flex justify-end">
                      <HeaderSortButton
                        label="Assign"
                        active={sortState.column === 'assign'}
                        direction={sortState.column === 'assign' ? sortState.direction : null}
                        onClick={() => handleSort('assign')}
                      />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right text-amber-700 dark:text-amber-300">
                    <div className="flex justify-end">
                      <HeaderSortButton
                        label="Unassign"
                        active={sortState.column === 'unassign'}
                        direction={sortState.column === 'unassign' ? sortState.direction : null}
                        onClick={() => handleSort('unassign')}
                      />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right text-[#5145A6] dark:text-[#DAB9FF]">
                    <div className="flex justify-end">
                      <HeaderSortButton
                        label="Complete"
                        active={sortState.column === 'complete'}
                        direction={sortState.column === 'complete' ? sortState.direction : null}
                        onClick={() => handleSort('complete')}
                      />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right text-[#2E7D8B] dark:text-[#D8B4FE]">
                    <div className="flex justify-end">
                      <HeaderSortButton
                        label="Pending"
                        active={sortState.column === 'uncomplete'}
                        direction={sortState.column === 'uncomplete' ? sortState.direction : null}
                        onClick={() => handleSort('uncomplete')}
                      />
                    </div>
                  </th>
                  <th className="py-3 px-3 text-right text-rose-700 dark:text-rose-300">
                    <div className="flex justify-end">
                      <HeaderSortButton
                        label="Cancel"
                        active={sortState.column === 'cancel'}
                        direction={sortState.column === 'cancel' ? sortState.direction : null}
                        onClick={() => handleSort('cancel')}
                      />
                    </div>
                  </th>
                  <th className="py-3 px-4 min-w-[165px]">
                    <HeaderSortButton
                      label="Tingkat Penyelesaian"
                      active={sortState.column === 'completionRate'}
                      direction={sortState.column === 'completionRate' ? sortState.direction : null}
                      onClick={() => handleSort('completionRate')}
                    />
                  </th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#361F5E] text-[#52647A] dark:text-[#C5B3DF]">
                {groupedData.map(group => {
                  const groupRate =
                    group.subtotal.totalWO > 0
                      ? Math.round((group.subtotal.complete / group.subtotal.totalWO) * 1000) / 10
                      : 0;
                  return (
                    <React.Fragment key={group.areaName}>
                      <tr className="bg-[#EDF3F8] dark:bg-[#241145] border-t-2 border-b border-[#DDE6F0] dark:border-[#3F2370]">
                        <td colSpan={10} className="py-2.5 px-4 font-bold text-xs text-[#26364A] dark:text-white">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <MapPin className="w-4 h-4 text-[#2E7D8B] dark:text-[#D8B4FE] shrink-0" />
                              <span className="tracking-wide uppercase font-bold text-[12px]">
                                AREA: {group.areaName}
                              </span>
                              {group.areaName === 'Belum Ditentukan' && (
                                <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 font-normal">
                                  Perlu Penyesuaian Data
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] font-mono text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                              {group.contractors.length} Kontraktor | {group.subtotal.totalWO} WO ({groupRate}% Selesai)
                            </span>
                          </div>
                        </td>
                      </tr>

                      {group.contractors.map((c, cIdx) => {
                        const rowRate = c.totalWO > 0 ? Math.round((c.complete / c.totalWO) * 1000) / 10 : 0;
                        return (
                          <tr
                            key={`${group.areaName}-${c.contractorName}`}
                            className="odd:bg-white even:bg-[#F8FAFD] dark:odd:bg-transparent dark:even:bg-transparent hover:bg-[#EDF3F8] dark:hover:bg-[#1E1238]/60 transition-colors"
                          >
                            <td className="py-2.5 px-4 text-center font-mono text-[#8492A5] dark:text-[#A493C2] text-[11px] tabular-nums">
                              {cIdx + 1}
                            </td>
                            <td className="py-2.5 px-4 font-semibold text-[#26364A] dark:text-white">
                              <div className="flex items-center gap-2">
                                <Building2 className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE] shrink-0" />
                                <span>{c.contractorName}</span>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[#26364A] dark:text-white tabular-nums">
                              {c.totalWO}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                              {c.assign}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                              {c.unassign}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                              {c.complete}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[#2E7D8B] dark:text-[#E9D5FF] tabular-nums">
                              {c.uncomplete}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold text-[#881337] dark:text-rose-400 tabular-nums">
                              {c.cancel}
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 rounded-full bg-[#DDE6F0] dark:bg-[#2E1654] overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-[#5145A6] to-[#2E7D8B] dark:from-[#58149C] dark:to-[#7135B5]"
                                    style={{ width: `${rowRate}%` }}
                                  />
                                </div>
                                <span className="font-mono text-[11px] font-bold text-[#26364A] dark:text-white tabular-nums w-11 text-right">
                                  {rowRate}%
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  setDetailScope({ areaName: group.areaName, contractorName: c.contractorName })
                                }
                                className="btn-3d-darkpurple px-3 py-1 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3 h-3" />
                                <span>Lihat Rincian</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      <tr className="bg-[#F4F7FB] dark:bg-[#1E1238] font-bold border-b border-t border-[#DDE6F0] dark:border-[#361F5E] text-[#26364A] dark:text-white">
                        <td colSpan={2} className="py-2 px-4 text-right uppercase text-[11px] text-[#5145A6] dark:text-[#D8B4FE]">
                          Subtotal {group.areaName}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-extrabold text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                          {group.subtotal.totalWO}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                          {group.subtotal.assign}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                          {group.subtotal.unassign}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                          {group.subtotal.complete}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-[#2E7D8B] dark:text-[#E9D5FF] tabular-nums">
                          {group.subtotal.uncomplete}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-bold text-[#881337] dark:text-rose-400 tabular-nums">
                          {group.subtotal.cancel}
                        </td>
                        <td className="py-2 px-4 font-mono text-[11px] font-extrabold text-[#5145A6] dark:text-[#D8B4FE] text-right">
                          {groupRate}%
                        </td>
                        <td className="py-2 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => setDetailScope({ areaName: group.areaName })}
                            className="btn-3d-lilac px-2.5 py-1 rounded-lg text-[10.5px] font-bold cursor-pointer"
                          >
                            Semua Area
                          </button>
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })}

                <tr className="bg-gradient-to-r from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] dark:from-[#160D29] dark:via-[#27104A] dark:to-[#480123] text-[#26364A] dark:text-white font-extrabold border-t-2 border-[#C5BEEF] dark:border-[#7135B5] text-sm">
                  <td colSpan={2} className="py-3 px-4 text-right uppercase tracking-wider text-xs text-[#5145A6] dark:text-[#D8B4FE]">
                    GRAND TOTAL KESELURUHAN
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-[#26364A] dark:text-white text-base tabular-nums">
                    {grandTotal.totalWO}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">
                    {grandTotal.assign}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-amber-700 dark:text-amber-300 tabular-nums">
                    {grandTotal.unassign}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                    {grandTotal.complete}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-[#2E7D8B] dark:text-[#E9D5FF] tabular-nums">
                    {grandTotal.uncomplete}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-700 dark:text-rose-300 tabular-nums">
                    {grandTotal.cancel}
                  </td>
                  <td colSpan={2} className="py-3 px-4 text-right font-mono text-xs text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                    Completion: {executionRates.completionPct}%
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
            <Download className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
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
        <p className="text-[11px] text-[#8492A5] dark:text-[#A493C2]">
          Format laporan resmi operasional NOC &amp; Dispatch MoraJaws • Data langsung dari database produksi
        </p>
      </div>

      {/* Drill-down Rincian Modal */}
      {detailScope && (
        <ResponsiveModal
          isOpen={Boolean(detailScope)}
          onClose={() => setDetailScope(null)}
          title={`Rincian Work Order — ${detailScope.areaName}`}
          subtitle={
            detailScope.contractorName
              ? `${detailScope.contractorName} • ${detailTickets.length} WO`
              : `Seluruh Kontraktor di Area ${detailScope.areaName} • ${detailTickets.length} WO`
          }
          icon={<Layers className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />}
          size="xl"
        >
          <div className="p-4 sm:p-5 space-y-3 max-h-[70vh] overflow-y-auto">
            {detailTickets.length === 0 ? (
              <div className="p-8 text-center text-xs text-[#8492A5] dark:text-[#A493C2]">
                Tidak ada Work Order aktif pada cakupan ini.
              </div>
            ) : (
              <div className="divide-y divide-[#DDE6F0] dark:divide-[#361F5E] rounded-xl border border-[#DDE6F0] dark:border-[#361F5E] overflow-hidden">
                {detailTickets.map(t => (
                  <div
                    key={t.id}
                    className="p-3 bg-white dark:bg-[#160D29] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">#{t.woNumber}</span>
                        <span className="font-bold text-[#26364A] dark:text-white">{t.customerName}</span>
                        <span className="text-[10.5px] font-mono text-[#8492A5] dark:text-[#A493C2]">
                          {t.appointmentDate || getTicketAppointmentDate(t) || '-'}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] truncate mt-0.5">
                        Teknisi: <strong>{t.installerName || 'Belum Di-assign'}</strong> · {t.streetName || t.clusterName || '-'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF]">
                        {t.statusWOInstaller || t.statusWOAgent || 'Open'}
                      </span>
                      {t.approvalStatus && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                          {t.approvalStatus}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ResponsiveModal>
      )}
    </div>
  );
};
