import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  History,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserCheck,
  Building2,
  MapPin,
  Clock,
  AlertCircle,
  ExternalLink
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProgressReportHistoryItem } from '../../types';
import { supabaseDb } from '../../services/supabaseDb';
import { extractProgressReportHistoryClient, scopeTicketsForRoleClient } from '../../services/woLifecycleService';
import { StatusBadge } from '../common/Badge';
import { formatJakartaTimestamp } from '../../services/workSessionService';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';

interface HistoryProgressReportViewProps {
  ticketId?: string;
  onSelectTicket?: (ticketId: string) => void;
  compact?: boolean;
}

export const HistoryProgressReportView: React.FC<HistoryProgressReportViewProps> = ({
  ticketId,
  onSelectTicket,
  compact = false
}) => {
  const { tickets, currentUser, contractorsList, areasList, toast } = useApp();

  const [serverItems, setServerItems] = useState<ProgressReportHistoryItem[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [reportStatusFilter, setReportStatusFilter] = useState('ALL');
  const [approvalFilter, setApprovalFilter] = useState('ALL');
  const [vendorFilter, setVendorFilter] = useState('ALL');
  const [areaFilter, setAreaFilter] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | 'ALL'>(20);

  const loadHistory = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await supabaseDb.fetchProgressReportHistory({
        ticketId: ticketId || undefined
      });
      if (res.success && Array.isArray(res.data)) {
        setServerItems(res.data);
      } else if (res.error) {
        setErrorMsg(res.error.message || 'Gagal memuat History Progress Report');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal menghubungi server History Progress Report');
    } finally {
      setIsLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, tickets.length]);

  const clientFallbackItems = useMemo(() => {
    const scoped = scopeTicketsForRoleClient(tickets, currentUser);
    const filtered = ticketId ? scoped.filter(t => t.id === ticketId) : scoped;
    return extractProgressReportHistoryClient(filtered);
  }, [tickets, currentUser, ticketId]);

  // Merge authoritative backend list with client fallback so instant updates never lag
  const allItems: ProgressReportHistoryItem[] = useMemo(() => {
    if (serverItems && serverItems.length > 0) {
      const byId = new Map<string, ProgressReportHistoryItem>();
      serverItems.forEach(item => byId.set(item.id, item));
      clientFallbackItems.forEach(item => {
        if (!byId.has(item.id)) byId.set(item.id, item);
      });
      return Array.from(byId.values()).sort(
        (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime()
      );
    }
    return clientFallbackItems;
  }, [serverItems, clientFallbackItems]);

  const filteredItems = useMemo(() => {
    return allItems.filter(item => {
      if (reportStatusFilter !== 'ALL' && item.reportStatus.toUpperCase() !== reportStatusFilter) {
        return false;
      }
      if (approvalFilter !== 'ALL') {
        if (approvalFilter === 'WAITING APPROVAL' && item.approvalStatus !== 'WAITING APPROVAL') return false;
        if (approvalFilter === 'APPROVED' && item.approvalStatus !== 'APPROVED') return false;
        if (approvalFilter === 'REVISION' && item.approvalStatus !== 'REVISION / REJECTED') return false;
      }
      if (vendorFilter !== 'ALL' && item.vendorName.toLowerCase() !== vendorFilter.toLowerCase()) {
        return false;
      }
      if (areaFilter !== 'ALL' && item.area.toLowerCase() !== areaFilter.toLowerCase()) {
        return false;
      }
      if (dateFrom && item.appointmentDate && item.appointmentDate < dateFrom) return false;
      if (dateTo && item.appointmentDate && item.appointmentDate > dateTo) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const hay = [
          item.woNumber,
          item.customerName,
          item.installerName,
          item.vendorName,
          item.area,
          item.reportStatus,
          item.reasonReport,
          item.rootCause,
          item.remarks,
          item.dispatchApprover
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allItems, reportStatusFilter, approvalFilter, vendorFilter, areaFilter, dateFrom, dateTo, searchTerm]);

  const handleExportCsv = () => {
    if (filteredItems.length === 0) {
      toast.warning('Tidak ada data History Progress Report untuk diekspor.');
      return;
    }
    const headers = [
      'WO Number',
      'Versi',
      'Appointment Date',
      'Slot Time',
      'Customer',
      'Installer',
      'Vendor',
      'Area',
      'Report Status',
      'Reason Report',
      'Rootcause',
      'Remarks',
      'Waktu Laporan',
      'Approval Status',
      'Dispatch Approver',
      'Waktu Approval',
      'Catatan / Alasan Revisi',
      'Status Akhir WO Agent',
      'Dispatch Approval Outcome',
      'Ticket Result'
    ];
    const escapeCsv = (val: unknown) => {
      const str = String(val ?? '').replace(/"/g, '""');
      return `"${str}"`;
    };
    const rows = filteredItems.map(r => [
      r.woNumber,
      `v${r.versionNumber}`,
      r.appointmentDate,
      r.slotTime || '-',
      r.customerName,
      r.installerName,
      r.vendorName,
      r.area,
      r.reportStatus,
      r.reasonReport,
      r.rootCause,
      r.remarks,
      r.submittedAt ? formatJakartaTimestamp(r.submittedAt) : '-',
      r.approvalStatus,
      r.dispatchApprover || '-',
      r.approvalTimestamp ? formatJakartaTimestamp(r.approvalTimestamp) : '-',
      r.revisionReason || r.approvalNotes || '-',
      r.finalWoStatus,
      r.dispatchApprovalStatus || '-',
      r.ticketResult || (r.approvalStatus === 'APPROVED' ? 'Closed' : 'Open')
    ]);

    const csv = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows.map(row => row.map(escapeCsv).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `morajaws-history-progress-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filteredItems.length} baris History Progress Report berhasil diekspor ke CSV.`);
  };

  const resetFilters = () => {
    setSearchTerm('');
    setReportStatusFilter('ALL');
    setApprovalFilter('ALL');
    setVendorFilter('ALL');
    setAreaFilter('ALL');
    setDateFrom('');
    setDateTo('');
    setCurrentPage(1);
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, reportStatusFilter, approvalFilter, vendorFilter, areaFilter, dateFrom, dateTo]);

  const totalPages = useMemo(() => {
    if (pageSize === 'ALL') return 1;
    return Math.max(1, Math.ceil(filteredItems.length / pageSize));
  }, [filteredItems.length, pageSize]);

  const paginatedItems = useMemo(() => {
    if (pageSize === 'ALL') return filteredItems;
    const start = (currentPage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPage, pageSize]);

  const historyColumns = useMemo<ResponsiveColumn<ProgressReportHistoryItem>[]>(
    () => [
      {
        key: 'woVersion',
        label: 'WO & Versi',
        priority: 'hidden_mobile',
        tdClassName: 'whitespace-nowrap',
        render: item => (
          <>
            {onSelectTicket ? (
              <button
                type="button"
                onClick={() => onSelectTicket(item.ticketId)}
                className="font-mono font-bold text-[#5B289B] dark:text-[#D8B4FE] hover:underline tabular-nums block cursor-pointer"
              >
                {item.woNumber}
              </button>
            ) : (
              <span className="font-mono font-bold text-[#1F1638] dark:text-white tabular-nums block">
                {item.woNumber}
              </span>
            )}
            <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-[#F3EAFF] dark:bg-[#2E1654] border border-[#DFC7FF] dark:border-[#5B289B]/40 text-[10px] font-mono font-semibold text-[#5B289B] dark:text-[#D8B4FE]">
              v{item.versionNumber}
            </span>
          </>
        )
      },
      {
        key: 'appointment',
        label: 'Appointment',
        priority: 'primary',
        tdClassName: 'whitespace-nowrap tabular-nums',
        render: item => (
          <>
            <div className="font-semibold text-[#1F1638] dark:text-white">
              {item.appointmentDate || '-'}
            </div>
            <div className="text-[11px] text-[#7D7484] dark:text-[#A493C2]">{item.slotTime || '-'}</div>
            <div className="text-[11px] text-[#4B4452] dark:text-[#C5B3DF] mt-0.5 max-w-[140px] truncate">
              {item.customerName}
            </div>
          </>
        ),
        renderMobile: item => (
          <span>
            {item.appointmentDate || '-'} · {item.slotTime || '-'}
          </span>
        )
      },
      {
        key: 'installerVendorArea',
        label: 'Installer / Vendor / Area',
        priority: 'primary',
        widthClass: 'min-w-[150px]',
        render: item => (
          <>
            <div className="font-semibold text-[#1F1638] dark:text-white flex items-center gap-1">
              <UserCheck className="w-3.5 h-3.5 text-[#5B289B] dark:text-[#D8B4FE] shrink-0" />
              <span>{item.installerName}</span>
            </div>
            <div className="text-[11px] text-[#4B4452] dark:text-[#C5B3DF] flex items-center gap-1 mt-0.5">
              <Building2 className="w-3 h-3 text-[#7D7484] dark:text-[#A493C2] shrink-0" />
              <span>{item.vendorName}</span>
            </div>
            <div className="text-[11px] text-[#7D7484] dark:text-[#A493C2] flex items-center gap-1">
              <MapPin className="w-3 h-3 text-[#7D7484] dark:text-[#A493C2] shrink-0" />
              <span>{item.area}</span>
            </div>
          </>
        ),
        renderMobile: item => (
          <span>
            {item.installerName} ({item.vendorName} · {item.area})
          </span>
        )
      },
      {
        key: 'reportStatus',
        label: 'Report Status',
        priority: 'hidden_mobile',
        tdClassName: 'whitespace-nowrap',
        render: item => <StatusBadge status={item.reportStatus} variant="report" size="xs" />
      },
      {
        key: 'reasonRemarks',
        label: 'Reason · Rootcause · Remarks',
        priority: 'secondary',
        widthClass: 'min-w-[210px] max-w-[280px]',
        render: item => (
          <div className="space-y-0.5">
            {item.reasonReport && (
              <div className="font-semibold text-[#1F1638] dark:text-white">{item.reasonReport}</div>
            )}
            {item.rootCause && (
              <div className="text-[11px] text-[#4B4452] dark:text-[#C5B3DF]">
                Rootcause: {item.rootCause}
              </div>
            )}
            <div className="text-[11px] text-[#7D7484] dark:text-[#A493C2] break-words">
              {item.remarks || '-'}
            </div>
          </div>
        )
      },
      {
        key: 'submittedAt',
        label: 'Waktu Laporan',
        priority: 'secondary',
        tdClassName: 'whitespace-nowrap tabular-nums text-[11px] text-[#4B4452] dark:text-[#C5B3DF]',
        render: item => (
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3 text-[#7D7484] dark:text-[#A493C2] shrink-0" />
            <span>{item.submittedAt ? formatJakartaTimestamp(item.submittedAt) : '-'}</span>
          </div>
        )
      },
      {
        key: 'approvalStatus',
        label: 'Approval Status',
        priority: 'hidden_mobile',
        tdClassName: 'whitespace-nowrap',
        render: item => <StatusBadge status={item.approvalStatus} variant="approval" size="xs" />
      },
      {
        key: 'approverNotes',
        label: 'Dispatch Approver & Catatan',
        priority: 'secondary',
        widthClass: 'min-w-[170px] max-w-[240px]',
        render: item =>
          item.dispatchApprover ? (
            <div className="space-y-0.5">
              <div className="font-semibold text-[#1F1638] dark:text-white">{item.dispatchApprover}</div>
              {item.approvalTimestamp && (
                <div className="text-[10px] font-mono tabular-nums text-[#7D7484] dark:text-[#A493C2]">
                  {formatJakartaTimestamp(item.approvalTimestamp)}
                </div>
              )}
              {(item.revisionReason || item.approvalNotes) && (
                <div
                  className={`text-[11px] rounded px-1.5 py-0.5 mt-1 ${
                    item.revisionReason
                      ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
                      : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {item.revisionReason || item.approvalNotes}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-[#7D7484] dark:text-[#A493C2]">Menunggu review Dispatch</span>
          )
      },
      {
        key: 'finalWoStatus',
        label: 'Status Akhir WO',
        priority: 'hidden_mobile',
        tdClassName: 'whitespace-nowrap',
        render: item => (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge status={item.finalWoStatus} variant="wo_agent" size="xs" />
            {(item.ticketResult === 'Closed' || item.approvalStatus === 'APPROVED') && (
              <span className="px-1.5 py-0.5 rounded bg-[#241145] text-[#D8B4FE] border border-[#5B289B]/40 text-[9.5px] font-bold uppercase tracking-wide">
                {item.dispatchApprovalStatus || 'Ticket: Closed'}
              </span>
            )}
          </div>
        )
      }
    ],
    [onSelectTicket]
  );

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="rounded-2xl bg-gradient-to-br from-[#160D29] via-[#27104A] to-[#1A0D36] text-white p-4 sm:p-5 border border-[#4B2680]/60 shadow-md flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#6b103b] text-white border border-[#9E245E]">
              <History className="w-3.5 h-3.5" />
              <span>Append-Only Audit Trail</span>
            </div>
            <h2 className="text-base sm:text-lg font-display font-extrabold tracking-tight text-white">
              History Progress Report & Dispatch Approval
            </h2>
            <p className="text-xs text-[#E8DDFF]/85">
              Menyimpan seluruh versi laporan teknisi (PENDING, COMPLETE, RESCHEDULE, CANCEL), alasan revisi, dan jejak approval Dispatch secara permanen.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadHistory}
              disabled={isLoading}
              className="btn-3d-lilac inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-semibold cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="btn-3d-primary inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-semibold cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      {!ticketId && (
        <div className="card-3d-lavender p-3.5 sm:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
            <div className="lg:col-span-2 relative">
              <Search className="w-4 h-4 text-[#7D7484] dark:text-[#A493C2] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari WO Number, Customer, Teknisi, Reason, Approver..."
                className="tactile-debossed-input w-full pl-9 pr-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs text-[#1F1638] dark:text-white"
              />
            </div>

            <select
              aria-label="Filter Report Status"
              value={reportStatusFilter}
              onChange={(e) => setReportStatusFilter(e.target.value)}
              className="tactile-debossed-input px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-medium text-[#1F1638] dark:text-white"
            >
              <option value="ALL">Semua Report Status</option>
              <option value="PENDING">PENDING</option>
              <option value="COMPLETE">COMPLETE</option>
              <option value="RESCHEDULE">RESCHEDULE</option>
              <option value="CANCEL">CANCEL</option>
            </select>

            <select
              aria-label="Filter Approval Status"
              value={approvalFilter}
              onChange={(e) => setApprovalFilter(e.target.value)}
              className="tactile-debossed-input px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-medium text-[#1F1638] dark:text-white"
            >
              <option value="ALL">Semua Approval Status</option>
              <option value="WAITING APPROVAL">WAITING APPROVAL</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REVISION">REVISION / REJECTED</option>
            </select>

            <select
              aria-label="Filter Vendor"
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="tactile-debossed-input px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-medium text-[#1F1638] dark:text-white"
            >
              <option value="ALL">Semua Vendor</option>
              {contractorsList.map(v => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter Area"
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              className="tactile-debossed-input px-3 py-2 min-h-[44px] sm:min-h-[36px] rounded-xl text-xs font-medium text-[#1F1638] dark:text-white"
            >
              <option value="ALL">Semua Area</option>
              {areasList.map(a => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4B4452] dark:text-[#C5B3DF]">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#5B289B] dark:text-[#D8B4FE]" />
                Tanggal Appointment:
              </span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="tactile-debossed-input px-2.5 py-1.5 min-h-[44px] sm:min-h-[34px] rounded-lg text-xs tabular-nums text-[#1F1638] dark:text-white"
              />
              <span className="text-[#7D7484] dark:text-[#A493C2]">s/d</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="tactile-debossed-input px-2.5 py-1.5 min-h-[44px] sm:min-h-[34px] rounded-lg text-xs tabular-nums text-[#1F1638] dark:text-white"
              />
              {(searchTerm || reportStatusFilter !== 'ALL' || approvalFilter !== 'ALL' || vendorFilter !== 'ALL' || areaFilter !== 'ALL' || dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="btn-3d-lilac px-3 py-1.5 min-h-[44px] sm:min-h-[34px] rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Reset Filter
                </button>
              )}
            </div>
            <div className="text-[11px] font-semibold text-[#4B4452] dark:text-[#C5B3DF] tabular-nums">
              Menampilkan <span className="text-[#5B289B] dark:text-[#D8B4FE] font-bold">{filteredItems.length}</span> riwayat laporan
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-[#FFF7ED] dark:bg-amber-950/40 border border-[#FDBA74] dark:border-amber-700/60 px-3.5 py-2.5 text-xs text-[#C2410C] dark:text-amber-300 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Backend history query fallback aktif: {errorMsg}</span>
        </div>
      )}

      <ResponsiveDataTable
        data={paginatedItems}
        columns={historyColumns}
        getRowKey={item => item.id}
        emptyState={{
          icon: <FileSpreadsheet className="w-6 h-6" />,
          title: 'Belum ada riwayat Progress Report yang cocok',
          description:
            'Riwayat akan otomatis tercatat setiap kali teknisi mengirim Report Status Pembaruan dan saat Dispatch menyetujui atau meminta revisi.'
        }}
        mobileTitle={item => (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-[#5B289B] dark:text-[#D8B4FE]">
              {item.woNumber}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-[#F3EAFF] dark:bg-[#2E1654] text-[10px] font-mono text-[#5B289B] dark:text-[#D8B4FE]">
              v{item.versionNumber}
            </span>
          </div>
        )}
        mobileSubtitle={item => item.customerName || '-'}
        mobileStatus={item => (
          <>
            <StatusBadge status={item.reportStatus} variant="report" size="xs" />
            <StatusBadge status={item.approvalStatus} variant="approval" size="xs" />
            <StatusBadge status={item.finalWoStatus} variant="wo_agent" size="xs" />
            {(item.ticketResult === 'Closed' || item.approvalStatus === 'APPROVED') && (
              <span className="px-1.5 py-0.5 rounded bg-[#241145] text-[#D8B4FE] text-[9.5px] font-bold uppercase">
                Closed
              </span>
            )}
          </>
        )}
        getRowActions={
          onSelectTicket
            ? item => [
                {
                  id: 'open-wo',
                  label: 'Buka Work Order',
                  icon: <ExternalLink className="w-4 h-4" />,
                  onClick: () => onSelectTicket(item.ticketId)
                }
              ]
            : undefined
        }
        pagination={
          filteredItems.length > 0
            ? {
                currentPage,
                totalPages,
                totalItems: filteredItems.length,
                pageSize,
                pageSizeOptions: [10, 20, 50, 100, 'ALL'],
                onPageChange: setCurrentPage,
                onPageSizeChange: val => {
                  setPageSize(val);
                  setCurrentPage(1);
                },
                itemLabel: 'riwayat laporan'
              }
            : undefined
        }
      />
    </div>
  );
};
