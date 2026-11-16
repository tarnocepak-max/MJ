import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  Filter,
  History,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserCheck,
  Building2,
  MapPin,
  Clock,
  AlertCircle
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProgressReportHistoryItem } from '../../types';
import { supabaseDb } from '../../services/supabaseDb';
import { extractProgressReportHistoryClient, scopeTicketsForRoleClient } from '../../services/woLifecycleService';
import { StatusBadge } from '../common/Badge';
import { formatJakartaTimestamp } from '../../services/workSessionService';

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
      'Status Akhir WO'
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
      r.finalWoStatus
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
  };

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="rounded-2xl bg-[#160D29] text-white p-4 sm:p-5 border border-[#3E246F] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#7135B5]/40 text-[#E9D5FF] border border-[#9F67EA]/40">
              <History className="w-3.5 h-3.5" />
              <span>Append-Only Audit Trail</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold tracking-tight">
              History Progress Report & Dispatch Approval
            </h2>
            <p className="text-xs text-purple-200/80">
              Menyimpan seluruh versi laporan teknisi (PENDING, COMPLETE, RESCHEDULE, CANCEL), alasan revisi, dan jejak approval Dispatch secara permanen.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadHistory}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#241442] hover:bg-[#311C59] border border-[#4E2F8A] text-xs font-semibold text-purple-100"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#7135B5] hover:bg-[#8244CB] text-xs font-semibold text-white"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      {!ticketId && (
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 p-3.5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
            <div className="lg:col-span-2 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari WO Number, Customer, Teknisi, Reason, Approver..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800 text-xs focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
              />
            </div>

            <select
              aria-label="Filter Report Status"
              value={reportStatusFilter}
              onChange={(e) => setReportStatusFilter(e.target.value)}
              className="px-3 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
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
              className="px-3 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
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
              className="px-3 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
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
              className="px-3 py-2 rounded-xl border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
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
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Tanggal Appointment:
              </span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800 text-xs tabular-nums"
              />
              <span className="text-slate-400">s/d</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-[#E2E8F0] dark:border-slate-700 bg-[#F8FAFC] dark:bg-slate-800 text-xs tabular-nums"
              />
              {(searchTerm || reportStatusFilter !== 'ALL' || approvalFilter !== 'ALL' || vendorFilter !== 'ALL' || areaFilter !== 'ALL' || dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#7135B5] hover:bg-[#F5F1FF]"
                >
                  Reset Filter
                </button>
              )}
            </div>
            <div className="text-[11px] font-semibold text-slate-500 tabular-nums">
              Menampilkan <span className="text-[#160D29] dark:text-white font-bold">{filteredItems.length}</span> riwayat laporan
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl bg-[#FFF7ED] border border-[#FDBA74] px-3.5 py-2.5 text-xs text-[#C2410C] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Backend history query fallback aktif: {errorMsg}</span>
        </div>
      )}

      {/* Empty State */}
      {filteredItems.length === 0 ? (
        <div className="rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 p-8 text-center space-y-2">
          <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Belum ada riwayat Progress Report yang cocok
          </p>
          <p className="text-xs text-slate-500">
            Riwayat akan otomatis tercatat setiap kali teknisi mengirim Report Status Pembaruan dan saat Dispatch menyetujui atau meminta revisi.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F8FAFC] dark:bg-slate-800/50 text-[11px] uppercase tracking-wider text-[#475569] dark:text-slate-400 border-b border-[#E2E8F0] dark:border-slate-800">
                    <th className="py-3 px-3 font-bold">WO & Versi</th>
                    <th className="py-3 px-3 font-bold">Appointment</th>
                    <th className="py-3 px-3 font-bold">Installer / Vendor / Area</th>
                    <th className="py-3 px-3 font-bold">Report Status</th>
                    <th className="py-3 px-3 font-bold">Reason · Rootcause · Remarks</th>
                    <th className="py-3 px-3 font-bold">Waktu Laporan</th>
                    <th className="py-3 px-3 font-bold">Approval Status</th>
                    <th className="py-3 px-3 font-bold">Dispatch Approver & Catatan</th>
                    <th className="py-3 px-3 font-bold">Status Akhir WO</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] dark:divide-slate-800">
                  {filteredItems.map(item => (
                    <tr
                      key={item.id}
                      className="hover:bg-[#F5F1FF]/40 dark:hover:bg-slate-800/40 transition-colors align-top"
                    >
                      <td className="py-3 px-3 whitespace-nowrap">
                        {onSelectTicket ? (
                          <button
                            type="button"
                            onClick={() => onSelectTicket(item.ticketId)}
                            className="font-mono font-bold text-[#7135B5] hover:underline tabular-nums block"
                          >
                            {item.woNumber}
                          </button>
                        ) : (
                          <span className="font-mono font-bold text-[#160D29] dark:text-white tabular-nums block">
                            {item.woNumber}
                          </span>
                        )}
                        <span className="inline-block mt-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono font-semibold text-slate-600 dark:text-slate-300">
                          v{item.versionNumber}
                        </span>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap tabular-nums">
                        <div className="font-semibold text-[#160D29] dark:text-white">
                          {item.appointmentDate || '-'}
                        </div>
                        <div className="text-[11px] text-slate-500">{item.slotTime || '-'}</div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 max-w-[140px] truncate">
                          {item.customerName}
                        </div>
                      </td>

                      <td className="py-3 px-3 min-w-[150px]">
                        <div className="font-semibold text-[#160D29] dark:text-white flex items-center gap-1">
                          <UserCheck className="w-3.5 h-3.5 text-[#7135B5] shrink-0" />
                          <span>{item.installerName}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{item.vendorName}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{item.area}</span>
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <StatusBadge status={item.reportStatus} variant="report" size="xs" />
                      </td>

                      <td className="py-3 px-3 min-w-[210px] max-w-[280px] space-y-0.5">
                        {item.reasonReport && (
                          <div className="font-semibold text-[#160D29] dark:text-white">
                            {item.reasonReport}
                          </div>
                        )}
                        {item.rootCause && (
                          <div className="text-[11px] text-[#475569] dark:text-slate-300">
                            Rootcause: {item.rootCause}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 break-words">
                          {item.remarks || '-'}
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{item.submittedAt ? formatJakartaTimestamp(item.submittedAt) : '-'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <StatusBadge status={item.approvalStatus} variant="approval" size="xs" />
                      </td>

                      <td className="py-3 px-3 min-w-[170px] max-w-[240px]">
                        {item.dispatchApprover ? (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-[#160D29] dark:text-white">
                              {item.dispatchApprover}
                            </div>
                            {item.approvalTimestamp && (
                              <div className="text-[10px] font-mono tabular-nums text-slate-500">
                                {formatJakartaTimestamp(item.approvalTimestamp)}
                              </div>
                            )}
                            {(item.revisionReason || item.approvalNotes) && (
                              <div
                                className={`text-[11px] rounded px-1.5 py-0.5 mt-1 ${
                                  item.revisionReason
                                    ? 'bg-[#FEF2F2] text-[#B91C1C]'
                                    : 'bg-[#ECFDF5] text-[#15803D]'
                                }`}
                              >
                                {item.revisionReason || item.approvalNotes}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400">Menunggu review Dispatch</span>
                        )}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <StatusBadge status={item.finalWoStatus} variant="wo_agent" size="xs" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile Card Layout */}
          <div className="md:hidden space-y-3">
            {filteredItems.map(item => (
              <div
                key={item.id}
                className="rounded-xl bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-800 p-3.5 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {onSelectTicket ? (
                      <button
                        type="button"
                        onClick={() => onSelectTicket(item.ticketId)}
                        className="font-mono text-sm font-bold text-[#7135B5] hover:underline tabular-nums"
                      >
                        {item.woNumber}
                      </button>
                    ) : (
                      <span className="font-mono text-sm font-bold text-[#160D29] dark:text-white tabular-nums">
                        {item.woNumber}
                      </span>
                    )}
                    <div className="text-[11px] text-slate-500 tabular-nums">
                      v{item.versionNumber} · {item.appointmentDate} · {item.slotTime || '-'}
                    </div>
                  </div>
                  <StatusBadge status={item.finalWoStatus} variant="wo_agent" size="xs" />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={item.reportStatus} variant="report" size="xs" />
                  <StatusBadge status={item.approvalStatus} variant="approval" size="xs" />
                </div>

                <div className="text-xs text-slate-700 dark:text-slate-200 space-y-1">
                  <div>
                    <span className="font-semibold">{item.installerName}</span> · {item.vendorName} ({item.area})
                  </div>
                  {item.reasonReport && <div className="font-semibold">{item.reasonReport}</div>}
                  {item.rootCause && <div className="text-[11px] text-slate-500">Rootcause: {item.rootCause}</div>}
                  <div className="text-[11px] text-slate-600 dark:text-slate-300">{item.remarks}</div>
                </div>

                <div className="pt-2 border-t border-[#E2E8F0] dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{item.submittedAt ? formatJakartaTimestamp(item.submittedAt) : '-'}</span>
                  {item.dispatchApprover && (
                    <span className="font-semibold text-[#160D29] dark:text-white">
                      Dispatch: {item.dispatchApprover}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
