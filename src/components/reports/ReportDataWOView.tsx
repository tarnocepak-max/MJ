import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { Ticket } from '../../types';
import {
  FileSpreadsheet,
  Download,
  BarChart3,
  Building2,
  Wrench,
  MapPin,
  Calendar,
  Clock,
  Copy,
  Archive,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ArrowUpDown
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useToast } from '../../context/ToastContext';
import { getJakartaDateString, parseAppointmentDate } from '../../services/appointmentDateParser';
import { classifyWorkOrder } from '../../services/woClassificationService';
import { StatusAgentBadge, StatusInstallerBadge } from '../common/Badge';
import { HistoryProgressReportView } from './HistoryProgressReportView';
import {
  HeaderSearchPopover,
  HeaderCategoryDropdown,
  HeaderDateSortFilterPopover,
  TableResetFilterButton
} from '../common/InteractiveTableHeader';
import { PaginationBar } from '../common/PaginationBar';
import {
  SortState,
  getNextSortDirection,
  sortDataArray
} from '../../utils/tableSorting';

interface ColumnFilters {
  woNumber: string;
  customerId: string;
  customerName: string;
  slotTime: string;
  remarks: string;
}

const initialFilters: ColumnFilters = {
  woNumber: '',
  customerId: '',
  customerName: '',
  slotTime: '',
  remarks: ''
};

export const ReportDataWOView: React.FC = () => {
  const { tickets, contractors } = useApp();
  const { isCompactUI } = useResponsiveViewport();
  const { toast } = useToast();

  const [reportType, setReportType] = useState<
    | 'all_wo'
    | 'history_progress'
    | 'wo_agent'
    | 'wo_installer'
    | 'pending'
    | 'completed'
    | 'overdue'
    | 'reassign_history'
    | 'contractor_sla'
    | 'incomplete_data'
  >('all_wo');

  const [contractorFilter, setContractorFilter] = useState('ALL');
  const [areaFilter, setAreaFilter] = useState('ALL');
  const [installerFilter, setInstallerFilter] = useState('ALL');
  const [statusInstallerFilter, setStatusInstallerFilter] = useState('ALL');
  const [exactAppointmentDate, setExactAppointmentDate] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});

  // Feature 2: Individual Column Filters
  const [colFilters, setColFilters] = useState<ColumnFilters>(initialFilters);

  // Feature 3: Global 3-State Sorting
  const [sortState, setSortState] = useState<SortState>({
    column: 'woNumber',
    direction: 'asc'
  });

  // Pagination
  const [pageSize, setPageSize] = useState<number | 'ALL'>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Centralized Overdue calculation (past appointment date in Asia/Jakarta and not completed/closed)
  const isOverdue = (t: Ticket): boolean => {
    return classifyWorkOrder(t, getJakartaDateString(0)).classification === 'OVERDUE';
  };

  // Base list
  const activeTickets = useMemo(() => tickets.filter(t => !t.isArchived && !t.isDeleted), [tickets]);

  const areaOptions = useMemo(() => {
    const set = new Set<string>();
    activeTickets.forEach(t => {
      const a = String(t.area || '').trim();
      if (a) set.add(a);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [activeTickets]);

  const installerOptions = useMemo(() => {
    const set = new Set<string>();
    activeTickets.forEach(t => {
      const inst = String(t.installerName || '').trim();
      if (inst) set.add(inst);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [activeTickets]);

  const statusInstallerOptions = useMemo(() => {
    const set = new Set<string>();
    activeTickets.forEach(t => {
      const st = String(t.statusWOInstaller || '').trim();
      if (st) set.add(st);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [activeTickets]);

  // Report-specific data subset
  const reportData = useMemo(() => {
    return activeTickets.filter(t => {
      // 1. Report Type Filter
      if (reportType === 'wo_agent') {
        if (!t.agentId && !t.remarksAgent) return false;
      } else if (reportType === 'wo_installer') {
        if (!t.installerName) return false;
      } else if (reportType === 'pending') {
        if (
          t.statusWOInstaller !== 'Pending Technical' &&
          t.statusWOAgent !== 'Pending' &&
          t.statusWOAgent !== 'Reschedule'
        )
          return false;
      } else if (reportType === 'completed') {
        if (
          t.statusWOInstaller !== 'Completed' &&
          t.statusWOAgent !== 'Done' &&
          t.statusWOAgent !== 'Closed' &&
          t.statusWOAgent !== 'Resolved'
        )
          return false;
      } else if (reportType === 'overdue') {
        if (!isOverdue(t)) return false;
      } else if (reportType === 'reassign_history') {
        if (!t.assignmentHistory || t.assignmentHistory.length === 0) return false;
      } else if (reportType === 'incomplete_data') {
        const isCid7 = /^[0-9]{7}$/.test((t.idCustomer || t.customerId || '').trim());
        const hasAppDate = Boolean(t.appointmentDate && t.appointmentDate.trim());
        const hasPhone = Boolean(t.customerPhone && t.customerPhone.trim());
        if (isCid7 && hasAppDate && hasPhone) return false;
      }

      // 2. Category Dropdown Filters from Headers
      if (contractorFilter !== 'ALL') {
        const c = (t.contactorName || t.contractorName || '').trim();
        if (c !== contractorFilter) return false;
      }
      if (areaFilter !== 'ALL' && (t.area || '').trim() !== areaFilter) return false;
      if (installerFilter !== 'ALL') {
        const inst = String(t.installerName || '').trim();
        if (installerFilter === '__UNASSIGNED__') {
          if (inst) return false;
        } else if (inst !== installerFilter) {
          return false;
        }
      }
      if (statusInstallerFilter !== 'ALL' && String(t.statusWOInstaller || '').trim() !== statusInstallerFilter) {
        return false;
      }

      // 3. Appointment Date Filter (Exact or Range)
      const parsedDate = parseAppointmentDate(t.appointmentDate).date || '';
      if (exactAppointmentDate && parsedDate !== exactAppointmentDate) return false;
      if (dateStart && (!parsedDate || parsedDate < dateStart)) return false;
      if (dateEnd && (!parsedDate || parsedDate > dateEnd)) return false;

      // 4. Individual Column Search Popovers (AND logic)
      if (colFilters.woNumber.trim()) {
        const q = colFilters.woNumber.toLowerCase().trim();
        if (!(t.woNumber ? String(t.woNumber).toLowerCase() : '').includes(q)) return false;
      }
      if (colFilters.customerId.trim()) {
        const q = colFilters.customerId.toLowerCase().trim();
        const cid = String(t.idCustomer || t.customerId || '').toLowerCase();
        if (!cid.includes(q)) return false;
      }
      if (colFilters.customerName.trim()) {
        const q = colFilters.customerName.toLowerCase().trim();
        if (!String(t.customerName ?? '').toLowerCase().includes(q)) return false;
      }
      if (colFilters.slotTime.trim()) {
        const q = colFilters.slotTime.toLowerCase().trim();
        if (!String(t.slotTime ?? '').toLowerCase().includes(q)) return false;
      }
      if (colFilters.remarks.trim()) {
        const q = colFilters.remarks.toLowerCase().trim();
        const r = String(t.remarksWOInstaller || t.remarksAgent || '').toLowerCase();
        if (!r.includes(q)) return false;
      }

      return true;
    });
  }, [
    activeTickets,
    reportType,
    contractorFilter,
    areaFilter,
    installerFilter,
    statusInstallerFilter,
    exactAppointmentDate,
    dateStart,
    dateEnd,
    colFilters
  ]);

  // Handle 3-state sort column click
  const handleSort = (columnKey: string) => {
    setSortState(prev => {
      const nextDir = getNextSortDirection(prev.column, prev.direction, columnKey);
      return {
        column: nextDir ? columnKey : null,
        direction: nextDir
      };
    });
    setCurrentPage(1);
  };

  // Sort reportData based on sortState
  const sortedReportData = useMemo(() => {
    return sortDataArray(reportData, sortState, (item: Ticket, col: string) => {
      switch (col) {
        case 'woNumber':
          return item.woNumber;
        case 'customerId':
          return item.idCustomer || item.customerId || '';
        case 'customerName':
          return item.customerName || '';
        case 'area':
          return item.area || '';
        case 'appointmentDate':
          return item.appointmentDate || '';
        case 'slotTime':
          return item.slotTime || '';
        case 'contractor':
          return item.contactorName || item.contractorName || '';
        case 'installer':
          return item.installerName || '';
        case 'statusInstaller':
          return item.statusWOInstaller || '';
        case 'remarks':
          return item.remarksWOInstaller || item.remarksAgent || '';
        default:
          return (item as any)[col];
      }
    });
  }, [reportData, sortState]);

  // Paginated Data
  const paginatedData = useMemo(() => {
    if (pageSize === 'ALL') return sortedReportData;
    const startIdx = (currentPage - 1) * pageSize;
    return sortedReportData.slice(startIdx, startIdx + pageSize);
  }, [sortedReportData, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    if (pageSize === 'ALL') return 1;
    return Math.max(1, Math.ceil(sortedReportData.length / pageSize));
  }, [sortedReportData.length, pageSize]);

  // Reset all filters
  const handleResetFilters = () => {
    setColFilters(initialFilters);
    setContractorFilter('ALL');
    setAreaFilter('ALL');
    setInstallerFilter('ALL');
    setStatusInstallerFilter('ALL');
    setExactAppointmentDate('');
    setDateStart('');
    setDateEnd('');
    setSortState({ column: null, direction: null });
    setCurrentPage(1);
    toast.info('Semua filter kolom dan pencarian telah di-reset.', 'Filter Dikosongkan');
  };

  // Copy Data to Clipboard (TSV)
  const handleCopyData = async () => {
    if (sortedReportData.length === 0) {
      toast.warning('Tidak ada data untuk disalin.', 'Data Kosong');
      return;
    }
    const header = [
      'No',
      'WO Number',
      'Customer ID',
      'Customer Name',
      'Phone',
      'Appointment Date',
      'Slot Time',
      'Area',
      'Contractor',
      'Installer',
      'Status Installer',
      'Catatan / Remarks'
    ].join('\t');

    const rows = sortedReportData.map((t, idx) =>
      [
        idx + 1,
        t.woNumber || '',
        t.idCustomer || t.customerId || '',
        t.customerName || '',
        t.customerPhone || '',
        t.appointmentDate || '',
        t.slotTime || '',
        t.area || '',
        t.contactorName || t.contractorName || '',
        t.installerName || '',
        t.statusWOInstaller || '',
        t.remarksWOInstaller || t.remarksAgent || ''
      ].join('\t')
    );

    const tsvText = [header, ...rows].join('\n');
    try {
      await navigator.clipboard.writeText(tsvText);
      toast.success(`${sortedReportData.length} baris data berhasil disalin ke clipboard!`, 'Salin Berhasil');
    } catch (err) {
      toast.error('Gagal menyalin data ke clipboard browser.', 'Gagal Salin');
    }
  };

  // Export to Excel (Current Filtered View)
  const handleExportExcel = () => {
    if (sortedReportData.length === 0) {
      toast.warning('Tidak ada data pada laporan ini untuk diekspor.', 'Data Kosong');
      return;
    }
    const rows = sortedReportData.map((t, idx) => ({
      'No': idx + 1,
      'WO Number': t.woNumber,
      'Customer ID': t.idCustomer || t.customerId,
      'Customer Name': t.customerName,
      'Phone': t.customerPhone,
      'Appointment Date': t.appointmentDate || '',
      'Slot Time': t.slotTime,
      'Area': t.area,
      'Cluster': t.clusterName,
      'Contractor': t.contactorName || t.contractorName,
      'Leader': t.leaderName,
      'Installer': t.installerName,
      'Status Agent': t.statusWOAgent,
      'Status Installer': t.statusWOInstaller,
      'Work Result': t.technicalReport?.workResult || '-',
      'Remarks': t.remarksWOInstaller || t.remarksAgent || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Laporan_WO');
    const fileName = `MoraJaws_Laporan_${reportType}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast.success(`Laporan ${sortedReportData.length} baris berhasil diekspor ke Excel.`, 'Ekspor Berhasil');
  };

  // Export ALL Work Orders in Database
  const handleExportAllWO = () => {
    if (activeTickets.length === 0) {
      toast.warning('Database Work Order kosong.', 'Data Kosong');
      return;
    }
    const rows = activeTickets.map((t, idx) => ({
      'No': idx + 1,
      'WO Number': t.woNumber,
      'Customer ID': t.idCustomer || t.customerId,
      'Customer Name': t.customerName,
      'Phone': t.customerPhone,
      'Appointment Date': t.appointmentDate || '',
      'Slot Time': t.slotTime,
      'Area': t.area,
      'Cluster': t.clusterName,
      'Contractor': t.contactorName || t.contractorName,
      'Leader': t.leaderName,
      'Installer': t.installerName,
      'Status Agent': t.statusWOAgent,
      'Status Installer': t.statusWOInstaller,
      'Work Result': t.technicalReport?.workResult || '-',
      'Remarks': t.remarksWOInstaller || t.remarksAgent || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Semua_Master_WO');
    const fileName = `MoraJaws_ALL_WO_MASTER_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    toast.success(`Seluruh ${activeTickets.length} Work Order berhasil diunduh.`, 'Download All WO Selesai');
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (sortedReportData.length === 0) return;
    const rows = sortedReportData.map(t => ({
      'WO Number': t.woNumber,
      'Customer ID': t.idCustomer || t.customerId,
      'Customer Name': t.customerName,
      'Phone': t.customerPhone,
      'Appointment Date': t.appointmentDate || '',
      'Slot Time': t.slotTime,
      'Area': t.area,
      'Contractor': t.contactorName || t.contractorName,
      'Installer': t.installerName,
      'Status': t.statusWOInstaller
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MoraJaws_Laporan_${reportType}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Laporan CSV berhasil diunduh.', 'Ekspor CSV');
  };

  const activeFilterCount =
    (contractorFilter !== 'ALL' ? 1 : 0) +
    (areaFilter !== 'ALL' ? 1 : 0) +
    (installerFilter !== 'ALL' ? 1 : 0) +
    (statusInstallerFilter !== 'ALL' ? 1 : 0) +
    (exactAppointmentDate || dateStart || dateEnd ? 1 : 0) +
    Object.values(colFilters).filter(v => Boolean(v.trim())).length;
  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className={`card-3d-lavender p-4 sm:p-5 flex flex-col justify-between gap-3.5 ${isCompactUI ? '' : 'lg:flex-row lg:items-center'}`}>
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#6657C8] to-[#2E7D8B] dark:from-[#5B289B] dark:to-[#35105E] text-white flex items-center justify-center font-bold shadow-sm shrink-0">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm sm:text-base font-display font-extrabold text-[#26364A] dark:text-white tracking-tight">
                Pusat Laporan &amp; Rekapitulasi Data Work Order
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#EAE8FF] dark:bg-[#6b103b] text-[#5145A6] dark:text-white border border-[#C5BEEF] dark:border-[#9E245E]/60 whitespace-nowrap">
                Column Search &amp; Global Sort
              </span>
            </div>
            <p className="text-xs text-[#52647A] dark:text-[#C5B3DF] mt-0.5 leading-relaxed">
              DataTable interaktif dengan pencarian mandiri per-kolom, pengurutan 3-state, dan ekspor multi-format.
            </p>
          </div>
        </div>

        {/* Action Buttons Toolbar */}
        <div className="grid grid-cols-2 sm:flex items-center gap-2 flex-wrap shrink-0">
          <button
            type="button"
            onClick={handleCopyData}
            className="btn-3d-ceramic px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
            title="Salin data tabel yang tampil ke clipboard (TSV format)"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Salin Data</span>
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="btn-3d-lilac px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            className="btn-3d-emerald px-3.5 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Ekspor XLSX</span>
          </button>

          <button
            type="button"
            onClick={handleExportAllWO}
            className="btn-3d-primary px-3.5 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            title="Download seluruh Work Order master tanpa terpengaruh filter"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Download All WO</span>
          </button>
        </div>
      </div>

      {/* Report Types Tabs */}
      <div className="mj-tactile-tab-bar flex items-center gap-1.5 overflow-x-auto p-1.5 text-xs font-semibold no-scrollbar">
        {[
          { id: 'all_wo', label: 'Semua WO', count: activeTickets.length },
          { id: 'history_progress', label: 'History Progress Report', count: activeTickets.reduce((acc, t) => acc + (t.progressReports?.length || 0), 0) },
          {
            id: 'completed',
            label: 'WO Selesai',
            count: activeTickets.filter(
              t =>
                t.statusWOInstaller === 'Completed' ||
                t.statusWOAgent === 'Done' ||
                t.statusWOAgent === 'Closed'
            ).length
          },
          {
            id: 'pending',
            label: 'Pending / Reschedule',
            count: activeTickets.filter(
              t =>
                t.statusWOInstaller === 'Pending Technical' ||
                t.statusWOAgent === 'Pending' ||
                t.statusWOAgent === 'Reschedule'
            ).length
          },
          { id: 'overdue', label: 'Overdue (Terlewat)', count: activeTickets.filter(isOverdue).length },
          { id: 'wo_installer', label: 'Kinerja Teknisi', count: activeTickets.filter(t => Boolean(t.installerName)).length },
          { id: 'reassign_history', label: 'Riwayat Reassign', count: activeTickets.filter(t => t.assignmentHistory && t.assignmentHistory.length > 0).length },
          { id: 'incomplete_data', label: 'Data Tidak Lengkap', count: activeTickets.filter(t => !/^[0-9]{7}$/.test((t.idCustomer || '').trim()) || !t.appointmentDate).length }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setReportType(tab.id as any);
              setCurrentPage(1);
            }}
            className={`px-3.5 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer shrink-0 ${
              reportType === tab.id
                ? 'btn-3d-primary font-bold'
                : 'text-[#52647A] dark:text-[#C5B3DF] hover:text-[#26364A] dark:hover:text-white'
            }`}
          >
            <span>{tab.label}</span>
            <span className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono tabular-nums ${
              reportType === tab.id
                ? 'bg-white/20 text-white'
                : 'bg-[#EAE8FF] dark:bg-[#2E1654] text-[#5145A6] dark:text-[#D8B4FE]'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {reportType === 'history_progress' ? (
        <HistoryProgressReportView />
      ) : (
      <>
      {/* Interactive Data Table / Responsive Priority Cards */}
      <div className="card-3d-lavender overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-[#DDE6F0] dark:border-[#361F5E] flex flex-wrap items-center justify-between text-xs gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-[#26364A] dark:text-white">
              Hasil Laporan: <span className="font-mono tabular-nums text-[#5145A6] dark:text-[#D8B4FE]">{sortedReportData.length}</span> Work Order
            </span>
            {sortState.column && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-[#F4F7FB] text-[#52647A] dark:bg-[#1E1238] dark:text-[#C5B3DF]">
                Sort: {sortState.column} ({sortState.direction})
              </span>
            )}
            <TableResetFilterButton
              activeCount={activeFilterCount}
              onReset={handleResetFilters}
              testId="report-wo-reset-filters"
            />
          </div>

          {isCompactUI ? (
            <div className="flex flex-wrap items-center gap-1.5 w-full">
              <HeaderSearchPopover
                label="WO"
                value={colFilters.woNumber}
                onChange={val => {
                  setColFilters(prev => ({ ...prev, woNumber: val }));
                  setCurrentPage(1);
                }}
                placeholder="Cari WO Number..."
                sortActive={sortState.column === 'woNumber'}
                sortDir={sortState.column === 'woNumber' ? sortState.direction : null}
                onCycleSort={() => handleSort('woNumber')}
              />
              <HeaderSearchPopover
                label="Pelanggan"
                value={colFilters.customerName}
                onChange={val => {
                  setColFilters(prev => ({ ...prev, customerName: val }));
                  setCurrentPage(1);
                }}
                placeholder="Cari Nama..."
              />
              <HeaderCategoryDropdown
                label="Mitra"
                value={contractorFilter}
                defaultValue="ALL"
                allLabel="Semua Mitra"
                options={[
                  { value: 'ALL', label: 'Semua Mitra' },
                  ...contractors.map(c => ({ value: c.name, label: c.name }))
                ]}
                onChange={val => {
                  setContractorFilter(val);
                  setCurrentPage(1);
                }}
              />
              <HeaderDateSortFilterPopover
                label="Tanggal"
                sortActive={sortState.column === 'appointmentDate'}
                sortDir={sortState.column === 'appointmentDate' ? sortState.direction : null}
                onCycleSort={() => handleSort('appointmentDate')}
                exactDate={exactAppointmentDate}
                dateFrom={dateStart}
                dateTo={dateEnd}
                onChangeDates={({ exactDate, dateFrom: df, dateTo: dt }) => {
                  setExactAppointmentDate(exactDate);
                  setDateStart(df);
                  setDateEnd(dt);
                  setCurrentPage(1);
                }}
              />
              <div className="flex items-center gap-1 ml-auto">
                <ArrowUpDown className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A493C2] shrink-0" />
                <select
                  aria-label="Urutkan Laporan"
                  value={sortState.column || 'woNumber'}
                  onChange={e => {
                    setSortState({ column: e.target.value, direction: sortState.direction || 'asc' });
                    setCurrentPage(1);
                  }}
                  className="tactile-debossed-input px-2 py-1.5 min-h-[36px] rounded-xl text-[11px] font-semibold text-[#26364A] dark:text-white"
                >
                  <option value="woNumber">WO</option>
                  <option value="appointmentDate">Tanggal</option>
                  <option value="customerName">Pelanggan</option>
                  <option value="area">Area</option>
                  <option value="contractor">Mitra</option>
                  <option value="statusInstaller">Status</option>
                </select>
                <button
                  type="button"
                  onClick={() =>
                    setSortState(prev => ({
                      column: prev.column || 'woNumber',
                      direction: prev.direction === 'asc' ? 'desc' : 'asc'
                    }))
                  }
                  className="btn-3d-lilac px-2.5 py-1.5 min-h-[36px] rounded-xl font-mono text-[11px] font-bold cursor-pointer"
                >
                  {sortState.direction === 'desc' ? 'DESC' : 'ASC'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-[#8492A5] dark:text-[#A493C2] text-[11px]">Tampilkan:</span>
              <select
                value={pageSize}
                onChange={e => {
                  const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                  setPageSize(val);
                  setCurrentPage(1);
                }}
                className="tactile-debossed-input px-2.5 py-1 rounded-lg text-xs text-[#26364A] dark:text-white"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value="ALL">Semua</option>
              </select>
              <span className="text-[#8492A5] dark:text-[#A493C2] text-[11px]">baris</span>
            </div>
          )}
        </div>

        {sortedReportData.length === 0 ? (
          <div className="p-12 text-center text-[#8492A5] dark:text-[#A493C2] text-xs space-y-2.5">
            <AlertCircle className="w-8 h-8 mx-auto text-[#8492A5] dark:text-[#5B289B]" />
            <div className="font-semibold text-[#52647A] dark:text-[#E8DDFF]">
              Tidak ada data yang sesuai dengan kombinasi filter dan pencarian.
            </div>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="btn-3d-primary mt-2 px-4 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-bold cursor-pointer"
              >
                Kosongkan Filter
              </button>
            )}
          </div>
        ) : isCompactUI ? (
          /* Mobile Priority Cards with Expandable Secondary Details */
          <div className="p-3 space-y-2.5 bg-[#F4F7FB]/70 dark:bg-[#160D29]/70">
            {paginatedData.map((t, idx) => {
              const globalIdx = pageSize === 'ALL' ? idx + 1 : (currentPage - 1) * pageSize + idx + 1;
              const isExpanded = Boolean(expandedCards[t.id]);
              const contractorLabel = t.contactorName || t.contractorName || '-';
              const remarksText = t.remarksWOInstaller || t.remarksAgent || '-';

              return (
                <article
                  key={t.id}
                  className="mj-tactile-card p-3.5 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-mono text-[#8492A5] dark:text-[#A493C2] tabular-nums">#{globalIdx}</span>
                        <span className="font-mono font-bold text-xs text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                          {t.woNumber}
                        </span>
                      </div>
                      <div className="font-bold text-xs text-[#26364A] dark:text-white mt-0.5 break-words">
                        {t.customerName || '-'}
                      </div>
                      <div className="text-[11px] font-mono text-[#8492A5] dark:text-[#A493C2] tabular-nums">
                        ID: {t.idCustomer || t.customerId || '-'}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <StatusInstallerBadge status={t.statusWOInstaller} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2 border-t border-[#DDE6F0] dark:border-[#361F5E] text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <MapPin className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A493C2] shrink-0" />
                      <span className="truncate text-[#26364A] dark:text-[#E8DDFF] font-medium">
                        {t.area || '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Calendar className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE] shrink-0" />
                      <span className="truncate font-mono text-[#5145A6] dark:text-[#D8B4FE] tabular-nums">
                        {t.appointmentDate || '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Clock className="w-3.5 h-3.5 text-[#8492A5] dark:text-[#A493C2] shrink-0" />
                      <span className="truncate text-[#52647A] dark:text-[#C5B3DF] font-mono tabular-nums">
                        {t.slotTime || '-'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Wrench className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="truncate font-medium text-emerald-700 dark:text-emerald-300">
                        {t.installerName || 'Belum Di-assign'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpandedCards(prev => ({ ...prev, [t.id]: !prev[t.id] }))}
                    aria-expanded={isExpanded}
                    className="btn-3d-lilac w-full min-h-[42px] px-3 py-2 rounded-xl flex items-center justify-between text-[11px] font-bold cursor-pointer"
                  >
                    <span>{isExpanded ? 'Tutup Detail Tambahan' : 'Lihat Detail Kontraktor & Catatan'}</span>
                    {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0" /> : <ChevronDown className="w-4 h-4 shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="pt-2.5 border-t border-dashed border-[#C5BEEF] dark:border-[#3F2370] space-y-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8492A5] dark:text-[#A493C2] flex items-center gap-1">
                          <Building2 className="w-3.5 h-3.5" /> Kontraktor:
                        </span>
                        <span className="font-semibold text-[#26364A] dark:text-white text-right">
                          {contractorLabel}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[#8492A5] dark:text-[#A493C2]">Status Agent:</span>
                        <StatusAgentBadge status={t.statusWOAgent} />
                      </div>
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2] mb-0.5">
                          Catatan / Remarks
                        </div>
                        <p className="text-[#26364A] dark:text-[#E8DDFF] break-words mj-tactile-well p-2.5 rounded-xl">
                          {remarksText}
                        </p>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[560px]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#EDF3F8] dark:bg-[#241145] text-[11px] font-bold text-[#26364A] dark:text-[#F3EAFF] uppercase sticky top-0 z-10 shadow-xs">
                {/* Header Row with 3-State Sorting (Feature 3) */}
                <tr className="border-b border-[#DDE6F0] dark:border-[#3F2370]">
                  <th className="py-2.5 px-3 w-12 text-center">No</th>
                  <th className="py-2.5 px-3 min-w-[130px]">
                    <HeaderSearchPopover
                      label="WO Number"
                      value={colFilters.woNumber}
                      onChange={v => {
                        setColFilters(prev => ({ ...prev, woNumber: v }));
                        setCurrentPage(1);
                      }}
                      placeholder="Cari WO Number..."
                      sortActive={sortState.column === 'woNumber'}
                      sortDir={sortState.column === 'woNumber' ? sortState.direction : null}
                      onCycleSort={() => handleSort('woNumber')}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[115px]">
                    <HeaderSearchPopover
                      label="Customer ID"
                      value={colFilters.customerId}
                      onChange={v => {
                        setColFilters(prev => ({ ...prev, customerId: v }));
                        setCurrentPage(1);
                      }}
                      placeholder="Cari Customer ID..."
                      sortActive={sortState.column === 'customerId'}
                      sortDir={sortState.column === 'customerId' ? sortState.direction : null}
                      onCycleSort={() => handleSort('customerId')}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[155px]">
                    <HeaderSearchPopover
                      label="Nama Pelanggan"
                      value={colFilters.customerName}
                      onChange={v => {
                        setColFilters(prev => ({ ...prev, customerName: v }));
                        setCurrentPage(1);
                      }}
                      placeholder="Cari Nama Pelanggan..."
                      sortActive={sortState.column === 'customerName'}
                      sortDir={sortState.column === 'customerName' ? sortState.direction : null}
                      onCycleSort={() => handleSort('customerName')}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[120px]">
                    <HeaderCategoryDropdown
                      label="Area"
                      value={areaFilter}
                      defaultValue="ALL"
                      allLabel="Semua Area"
                      options={[
                        { value: 'ALL', label: `Semua Area (${areaOptions.length})` },
                        ...areaOptions.map(a => ({ value: a, label: a }))
                      ]}
                      onChange={v => {
                        setAreaFilter(v);
                        setCurrentPage(1);
                      }}
                      sortActive={sortState.column === 'area'}
                      sortDir={sortState.column === 'area' ? sortState.direction : null}
                      onCycleSort={() => handleSort('area')}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[140px]">
                    <HeaderDateSortFilterPopover
                      label="Appointment"
                      sortActive={sortState.column === 'appointmentDate'}
                      sortDir={sortState.column === 'appointmentDate' ? sortState.direction : null}
                      onCycleSort={() => handleSort('appointmentDate')}
                      exactDate={exactAppointmentDate}
                      dateFrom={dateStart}
                      dateTo={dateEnd}
                      onChangeDates={({ exactDate, dateFrom: df, dateTo: dt }) => {
                        setExactAppointmentDate(exactDate);
                        setDateStart(df);
                        setDateEnd(dt);
                        setCurrentPage(1);
                      }}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[110px]">
                    <HeaderSearchPopover
                      label="Slot Time"
                      value={colFilters.slotTime}
                      onChange={v => {
                        setColFilters(prev => ({ ...prev, slotTime: v }));
                        setCurrentPage(1);
                      }}
                      placeholder="Cari Slot..."
                      sortActive={sortState.column === 'slotTime'}
                      sortDir={sortState.column === 'slotTime' ? sortState.direction : null}
                      onCycleSort={() => handleSort('slotTime')}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[130px]">
                    <HeaderCategoryDropdown
                      label="Kontraktor"
                      value={contractorFilter}
                      defaultValue="ALL"
                      allLabel="Semua Kontraktor"
                      options={[
                        { value: 'ALL', label: `Semua Kontraktor (${contractors.length})` },
                        ...contractors.map(c => ({ value: c.name, label: c.name }))
                      ]}
                      onChange={v => {
                        setContractorFilter(v);
                        setCurrentPage(1);
                      }}
                      sortActive={sortState.column === 'contractor'}
                      sortDir={sortState.column === 'contractor' ? sortState.direction : null}
                      onCycleSort={() => handleSort('contractor')}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[135px]">
                    <HeaderCategoryDropdown
                      label="Teknisi"
                      value={installerFilter}
                      defaultValue="ALL"
                      allLabel="Semua Teknisi"
                      options={[
                        { value: 'ALL', label: 'Semua Teknisi' },
                        { value: '__UNASSIGNED__', label: 'Belum Di-assign' },
                        ...installerOptions.map(i => ({ value: i, label: i }))
                      ]}
                      onChange={v => {
                        setInstallerFilter(v);
                        setCurrentPage(1);
                      }}
                      sortActive={sortState.column === 'installer'}
                      sortDir={sortState.column === 'installer' ? sortState.direction : null}
                      onCycleSort={() => handleSort('installer')}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[135px]">
                    <HeaderCategoryDropdown
                      label="Status Installer"
                      value={statusInstallerFilter}
                      defaultValue="ALL"
                      allLabel="Semua Status"
                      options={[
                        { value: 'ALL', label: 'Semua Status' },
                        ...statusInstallerOptions.map(s => ({ value: s, label: s }))
                      ]}
                      onChange={v => {
                        setStatusInstallerFilter(v);
                        setCurrentPage(1);
                      }}
                      sortActive={sortState.column === 'statusInstaller'}
                      sortDir={sortState.column === 'statusInstaller' ? sortState.direction : null}
                      onCycleSort={() => handleSort('statusInstaller')}
                    />
                  </th>
                  <th className="py-2.5 px-3 min-w-[140px]">
                    <HeaderSearchPopover
                      label="Catatan / Remarks"
                      value={colFilters.remarks}
                      onChange={v => {
                        setColFilters(prev => ({ ...prev, remarks: v }));
                        setCurrentPage(1);
                      }}
                      placeholder="Cari Catatan / Remarks..."
                      sortActive={sortState.column === 'remarks'}
                      sortDir={sortState.column === 'remarks' ? sortState.direction : null}
                      onCycleSort={() => handleSort('remarks')}
                    />
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-[#E2E8F0] dark:divide-[#361F5E]">
                {paginatedData.map((t, idx) => {
                  const globalIdx = pageSize === 'ALL' ? idx + 1 : (currentPage - 1) * pageSize + idx + 1;
                  return (
                    <tr key={t.id} className="even:bg-[#F8FAFD] odd:bg-white dark:even:bg-transparent dark:odd:bg-transparent hover:bg-[#EDF3F8] dark:hover:bg-[#1E1238]/60 transition-colors">
                      <td className="py-2.5 px-3 font-mono tabular-nums text-[#8492A5] dark:text-[#A493C2] text-center">{globalIdx}</td>
                      <td className="py-2.5 px-3 font-mono font-bold tabular-nums text-[#5145A6] dark:text-[#D8B4FE]">{t.woNumber}</td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-[#26364A] dark:text-[#E8DDFF]">{t.idCustomer || t.customerId || '-'}</td>
                      <td className="py-2.5 px-3 font-semibold text-[#26364A] dark:text-white">{t.customerName}</td>
                      <td className="py-2.5 px-3 text-[#52647A] dark:text-[#C5B3DF]">{t.area || '-'}</td>
                      <td className="py-2.5 px-3 whitespace-nowrap text-[#5145A6] dark:text-[#D8B4FE] font-mono tabular-nums font-medium">
                        {t.appointmentDate || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-[#52647A] dark:text-[#C5B3DF] font-mono tabular-nums whitespace-nowrap">{t.slotTime || '-'}</td>
                      <td className="py-2.5 px-3 text-[#52647A] dark:text-[#C5B3DF]">{t.contactorName || t.contractorName || '-'}</td>
                      <td className="py-2.5 px-3 font-medium text-emerald-600 dark:text-emerald-400">
                        {t.installerName || <span className="text-[#8492A5] dark:text-[#A493C2] italic">Belum Di-assign</span>}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusInstallerBadge status={t.statusWOInstaller} />
                      </td>
                      <td className="py-2.5 px-3 text-[#52647A] dark:text-[#C5B3DF] max-w-xs truncate" title={t.remarksWOInstaller || t.remarksAgent || ''}>
                        {t.remarksWOInstaller || t.remarksAgent || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Shared Responsive Pagination Toolbar */}
        {sortedReportData.length > 0 && (
          <PaginationBar
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={sortedReportData.length}
            pageSize={pageSize}
            pageSizeOptions={[10, 25, 50, 100, 'ALL']}
            onPageChange={setCurrentPage}
            onPageSizeChange={val => {
              setPageSize(val);
              setCurrentPage(1);
            }}
            itemLabel="Work Order"
          />
        )}
      </div>
      </>
      )}
    </div>
  );
};
