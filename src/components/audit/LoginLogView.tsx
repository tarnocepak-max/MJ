import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { KeyRound } from 'lucide-react';
import { SortState, getNextSortDirection, sortDataArray } from '../../utils/tableSorting';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { FilterToolbar } from '../common/FilterToolbar';
import { AuditLog } from '../../types';

export const LoginLogView: React.FC = () => {
  const { auditLogs } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'success' | 'failed'>('ALL');
  const [sortState, setSortState] = useState<SortState>({ column: 'timestamp', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | 'ALL'>(25);

  const handleSort = (colKey: string) => {
    setSortState(prev => {
      const nextDir = getNextSortDirection(prev.column, prev.direction, colKey);
      return { column: nextDir ? colKey : null, direction: nextDir };
    });
    setCurrentPage(1);
  };

  const loginLogs = useMemo(() => {
    return auditLogs.filter(l => l.entity === 'auth' || String(l.action || '').toLowerCase().includes('login'));
  }, [auditLogs]);

  const filteredLogs = useMemo(() => {
    return loginLogs.filter(log => {
      const isSuccess = String(log.action || '').toLowerCase().includes('success');
      if (statusFilter === 'success' && !isSuccess) return false;
      if (statusFilter === 'failed' && isSuccess) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const m1 = String(log.performedBy || '').toLowerCase().includes(q);
        const m2 = String(log.details || '').toLowerCase().includes(q);
        const m3 = String(log.action || '').toLowerCase().includes(q);
        if (!m1 && !m2 && !m3) return false;
      }
      return true;
    });
  }, [loginLogs, statusFilter, searchTerm]);

  const sortedLogs = useMemo(() => {
    return sortDataArray(filteredLogs, sortState, (log, col) => {
      return (log as any)[col];
    });
  }, [filteredLogs, sortState]);

  const totalPages = useMemo(() => {
    if (pageSize === 'ALL') return 1;
    return Math.max(1, Math.ceil(sortedLogs.length / pageSize));
  }, [sortedLogs.length, pageSize]);

  const paginatedLogs = useMemo(() => {
    if (pageSize === 'ALL') return sortedLogs;
    const safePage = Math.min(currentPage, totalPages);
    const start = (safePage - 1) * pageSize;
    return sortedLogs.slice(start, start + pageSize);
  }, [sortedLogs, currentPage, pageSize, totalPages]);

  const columns: ResponsiveColumn<AuditLog>[] = useMemo(
    () => [
      {
        key: 'timestamp',
        label: 'Waktu (WIB)',
        sortable: true,
        priority: 'secondary',
        numeric: true,
        tdClassName: 'text-slate-500 dark:text-slate-300 whitespace-nowrap',
        render: log => new Date(log.timestamp).toLocaleString('id-ID')
      },
      {
        key: 'action',
        label: 'Status',
        sortable: true,
        priority: 'hidden_mobile',
        tdClassName: 'whitespace-nowrap',
        render: log => {
          const isSuccess = String(log.action || '').toLowerCase().includes('success');
          return (
            <span
              className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold ${
                isSuccess
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
              }`}
            >
              {log.action}
            </span>
          );
        }
      },
      {
        key: 'performedBy',
        label: 'Pengguna',
        sortable: true,
        priority: 'hidden_mobile',
        tdClassName: 'font-semibold text-[#0F172A] dark:text-white whitespace-nowrap',
        render: log => log.performedBy
      },
      {
        key: 'userRole',
        label: 'Peran / Role',
        sortable: true,
        priority: 'secondary',
        tdClassName: 'capitalize font-mono text-slate-500 dark:text-slate-300 whitespace-nowrap',
        render: log => String(log.userRole || '').replace('_', ' ')
      },
      {
        key: 'details',
        label: 'Detail & Aktivitas',
        sortable: true,
        priority: 'primary',
        tdClassName: 'text-slate-600 dark:text-slate-300 max-w-md break-words',
        render: log => <span className="break-words">{log.details}</span>
      }
    ],
    []
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0F172A] dark:bg-[#1E293B] text-white flex items-center justify-center font-bold shadow-xs shrink-0">
            <KeyRound className="w-5 h-5 text-[#38BDF8]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-display font-bold text-[#0F172A] dark:text-white flex flex-wrap items-center gap-2">
              <span>Log Aktivitas Login Staf (Login Log)</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#2563EB] dark:bg-blue-950/60 dark:text-[#38BDF8]">
                Keamanan &amp; Deteksi Anomali
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5 leading-relaxed">
              Jejak audit seluruh autentikasi pengguna, percobaan gagal, pemblokiran brute-force, dan waktu login.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <FilterToolbar
        searchValue={searchTerm}
        onSearchChange={val => {
          setSearchTerm(val);
          setCurrentPage(1);
        }}
        searchPlaceholder="Cari user / rincian login..."
        activeFilterCount={statusFilter !== 'ALL' ? 1 : 0}
        onResetFilters={() => {
          setSearchTerm('');
          setStatusFilter('ALL');
          setCurrentPage(1);
        }}
        actions={
          <span className="text-slate-500 dark:text-slate-300 font-mono text-[11px] font-bold px-2 tabular-nums">
            {filteredLogs.length} Catatan
          </span>
        }
      >
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300 shrink-0">
            Hasil:
          </label>
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as any);
              setCurrentPage(1);
            }}
            className="flex-1 sm:w-52 px-3 py-2 min-h-[44px] sm:min-h-[38px] bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-[#0F172A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#2563EB]"
          >
            <option value="ALL">Semua Hasil Login</option>
            <option value="success">Login Berhasil</option>
            <option value="failed">Login Gagal / Diblokir</option>
          </select>
        </div>
      </FilterToolbar>

      {/* Responsive Table / Mobile Priority Cards */}
      <ResponsiveDataTable<AuditLog>
        data={paginatedLogs}
        columns={columns}
        getRowKey={log => log.id}
        sortKey={sortState.column}
        sortDirection={sortState.direction}
        onSort={handleSort}
        mobileTitle={log => log.performedBy}
        mobileSubtitle={log => new Date(log.timestamp).toLocaleString('id-ID')}
        mobileStatus={log => {
          const isSuccess = String(log.action || '').toLowerCase().includes('success');
          return (
            <>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  isSuccess
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                }`}
              >
                {log.action}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono text-[10px] capitalize">
                {String(log.userRole || '').replace('_', ' ')}
              </span>
            </>
          );
        }}
        emptyState={{
          title: 'Tidak ada riwayat login yang cocok',
          description: 'Belum ada aktivitas login untuk filter yang dipilih.'
        }}
        pagination={{
          currentPage,
          totalPages,
          totalItems: sortedLogs.length,
          pageSize,
          pageSizeOptions: [25, 50, 100, 'ALL'],
          onPageChange: setCurrentPage,
          onPageSizeChange: size => {
            setPageSize(size);
            setCurrentPage(1);
          },
          itemLabel: 'riwayat login'
        }}
      />
    </div>
  );
};
