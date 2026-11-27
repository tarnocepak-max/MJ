import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { KeyRound } from 'lucide-react';
import { SortState, getNextSortDirection, sortDataArray } from '../../utils/tableSorting';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { AuditLog } from '../../types';

export const LoginLogView: React.FC = () => {
  const { auditLogs } = useApp();
  const [userSearch, setUserSearch] = useState('');
  const [detailsSearch, setDetailsSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'success' | 'failed'>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [exactDate, setExactDate] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
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

  const roleOptions = useMemo(() => {
    const roles = new Set<string>();
    loginLogs.forEach(l => {
      if (l.userRole) roles.add(String(l.userRole));
    });
    return Array.from(roles).sort();
  }, [loginLogs]);

  const filteredLogs = useMemo(() => {
    return loginLogs.filter(log => {
      const isSuccess = String(log.action || '').toLowerCase().includes('success');
      if (statusFilter === 'success' && !isSuccess) return false;
      if (statusFilter === 'failed' && isSuccess) return false;
      if (roleFilter !== 'ALL' && String(log.userRole || '') !== roleFilter) return false;

      const logDate = String(log.timestamp || '').slice(0, 10);
      if (exactDate && logDate !== exactDate) return false;
      if (dateFrom && (!logDate || logDate < dateFrom)) return false;
      if (dateTo && (!logDate || logDate > dateTo)) return false;

      if (userSearch.trim()) {
        const q = userSearch.toLowerCase().trim();
        if (!String(log.performedBy || '').toLowerCase().includes(q)) return false;
      }
      if (detailsSearch.trim()) {
        const q = detailsSearch.toLowerCase().trim();
        const hay = `${log.details || ''} ${log.action || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [loginLogs, statusFilter, roleFilter, exactDate, dateFrom, dateTo, userSearch, detailsSearch]);

  const sortedLogs = useMemo(() => {
    return sortDataArray(filteredLogs, sortState, (log, col) => {
      return (log as any)[col];
    });
  }, [filteredLogs, sortState]);

  const activeFilterCount =
    (statusFilter !== 'ALL' ? 1 : 0) +
    (roleFilter !== 'ALL' ? 1 : 0) +
    (exactDate || dateFrom || dateTo ? 1 : 0) +
    (userSearch.trim() ? 1 : 0) +
    (detailsSearch.trim() ? 1 : 0);

  const resetFilters = () => {
    setStatusFilter('ALL');
    setRoleFilter('ALL');
    setExactDate('');
    setDateFrom('');
    setDateTo('');
    setUserSearch('');
    setDetailsSearch('');
    setCurrentPage(1);
  };

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
        tdClassName: 'text-[#52647A] dark:text-[#CEC0E8] whitespace-nowrap font-mono tabular-nums',
        headerControl: {
          kind: 'date',
          exactDate,
          dateFrom,
          dateTo,
          onChangeDates: ({ exactDate: ed, dateFrom: df, dateTo: dt }) => {
            setExactDate(ed);
            setDateFrom(df);
            setDateTo(dt);
            setCurrentPage(1);
          }
        },
        render: log => new Date(log.timestamp).toLocaleString('id-ID')
      },
      {
        key: 'action',
        label: 'Status',
        sortable: true,
        priority: 'hidden_mobile',
        tdClassName: 'whitespace-nowrap',
        headerControl: {
          kind: 'select',
          value: statusFilter,
          defaultValue: 'ALL',
          allLabel: 'Semua Hasil Login',
          options: [
            { value: 'ALL', label: 'Semua Hasil Login' },
            { value: 'success', label: 'Login Berhasil' },
            { value: 'failed', label: 'Login Gagal / Diblokir' }
          ],
          onChange: v => {
            setStatusFilter(v as any);
            setCurrentPage(1);
          }
        },
        render: log => {
          const isSuccess = String(log.action || '').toLowerCase().includes('success');
          return (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-bold border ${
                isSuccess
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                  : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
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
        tdClassName: 'font-bold text-[#26364A] dark:text-white whitespace-nowrap',
        headerControl: {
          kind: 'search',
          value: userSearch,
          onChange: v => {
            setUserSearch(v);
            setCurrentPage(1);
          },
          placeholder: 'Cari nama pengguna...'
        },
        render: log => log.performedBy
      },
      {
        key: 'userRole',
        label: 'Peran / Role',
        sortable: true,
        priority: 'secondary',
        tdClassName: 'capitalize font-mono text-[#52647A] dark:text-[#CEC0E8] whitespace-nowrap',
        headerControl: {
          kind: 'select',
          value: roleFilter,
          defaultValue: 'ALL',
          allLabel: 'Semua Role',
          options: [
            { value: 'ALL', label: 'Semua Role' },
            ...roleOptions.map(r => ({ value: r, label: r.replace('_', ' ') }))
          ],
          onChange: v => {
            setRoleFilter(v);
            setCurrentPage(1);
          }
        },
        render: log => String(log.userRole || '').replace('_', ' ')
      },
      {
        key: 'details',
        label: 'Detail & Aktivitas',
        sortable: true,
        priority: 'primary',
        tdClassName: 'text-[#52647A] dark:text-[#D9CCF2] max-w-md break-words',
        headerControl: {
          kind: 'search',
          value: detailsSearch,
          onChange: v => {
            setDetailsSearch(v);
            setCurrentPage(1);
          },
          placeholder: 'Cari detail aktivitas...'
        },
        render: log => <span className="break-words">{log.details}</span>
      }
    ],
    [exactDate, dateFrom, dateTo, statusFilter, userSearch, roleFilter, roleOptions, detailsSearch]
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#EAE8FF] to-[#DDF4F4] dark:from-[#5B289B] dark:to-[#35105E] border border-[#C5BEEF] dark:border-transparent text-[#5145A6] dark:text-[#E8DDFF] flex items-center justify-center font-bold shadow-[0_4px_12px_rgba(81,69,166,0.14)] dark:shadow-[0_6px_14px_rgba(53,16,94,0.28)] shrink-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-[#EAE8FF] text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:bg-gradient-to-b dark:from-[#6b103b] dark:to-[#480123] dark:text-white shadow-xs">
                SUPERADMIN &amp; SECURITY
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#DDF4F4] text-[#2E7D8B] border border-[#BDE4E8] dark:bg-[#35105E] dark:text-[#E8DDFF] dark:border-[#5B289B]">
                Keamanan &amp; Deteksi Anomali
              </span>
            </div>
            <h2 className="text-sm sm:text-base font-display font-extrabold text-[#26364A] dark:text-white tracking-tight">
              Log Aktivitas Login Staf (Login Log)
            </h2>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5 leading-relaxed">
              Jejak audit seluruh autentikasi pengguna, percobaan gagal, pemblokiran brute-force, dan waktu login.
            </p>
          </div>
        </div>
        <span className="self-start sm:self-center px-2.5 py-1 rounded-full bg-[#EAE8FF] dark:bg-[#2A174B] border border-[#C5BEEF] dark:border-[#4A2580] text-[#5145A6] dark:text-[#E8DDFF] font-mono text-[11px] font-bold tabular-nums shrink-0">
          {filteredLogs.length} Catatan
        </span>
      </div>

      {/* Responsive Table / Mobile Priority Cards */}
      <ResponsiveDataTable<AuditLog>
        data={paginatedLogs}
        columns={columns}
        getRowKey={log => log.id}
        sortKey={sortState.column}
        sortDirection={sortState.direction}
        onSort={handleSort}
        activeFilterCount={activeFilterCount}
        onResetFilters={activeFilterCount > 0 ? resetFilters : undefined}
        mobileTitle={log => log.performedBy}
        mobileSubtitle={log => new Date(log.timestamp).toLocaleString('id-ID')}
        mobileStatus={log => {
          const isSuccess = String(log.action || '').toLowerCase().includes('success');
          return (
            <>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  isSuccess
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                }`}
              >
                {log.action}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-[#EAE8FF] dark:bg-[#2A174B] text-[#5145A6] dark:text-[#D8B4FE] border border-[#C5BEEF] dark:border-transparent font-mono text-[10px] capitalize">
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
