import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { SyncMonitoringStatus, SyncHistoryEntry } from '../../types/index.ts';
import {
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Database,
  FileSpreadsheet,
  Layers,
  Search,
  Activity,
  History,
  Info,
  Check,
  Play,
  RotateCw,
  ShieldCheck,
  Radio,
  FileDown,
  Eye
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { getAuthHeaders } from '../../services/authService';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { ResponsiveModal } from '../common/ResponsiveModal';

export const DatabaseSyncMonitoringView: React.FC = () => {
  const { currentUser, googleSheetsConfig } = useApp();
  const { toast } = useToast();

  const [monitoringStatus, setMonitoringStatus] = useState<SyncMonitoringStatus>({
    appDbStatus: 'Connected',
    sheetsStatus: googleSheetsConfig.spreadsheetId ? 'Connected' : 'Unconfigured',
    lastSyncStatus: 'Pending',
    lastSyncAt: null,
    lastAttemptAt: null,
    totalRecordsRead: 0,
    totalRecordsProcessed: 0,
    totalRecordsFailed: 0,
    pendingChangesCount: 0,
    isSyncing: false
  });

  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<SyncHistoryEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch live sync status and history
  const fetchStatusAndHistory = async () => {
    setIsLoading(true);
    try {
      const authHdrs = getAuthHeaders();
      const [statusRes, historyRes] = await Promise.all([
        fetch('/api/sync/status', {
          headers: {
            ...authHdrs,
            'x-user-role': currentUser.role,
            'x-user-id': currentUser.id
          }
        }),
        fetch('/api/sync/history', {
          headers: {
            ...authHdrs,
            'x-user-role': currentUser.role,
            'x-user-id': currentUser.id
          }
        })
      ]);

      if (statusRes.ok) {
        const sData = await statusRes.json();
        setMonitoringStatus(prev => ({
          ...prev,
          ...sData,
          sheetsStatus: googleSheetsConfig.spreadsheetId ? 'Connected' : sData.sheetsStatus
        }));
      }

      if (historyRes.ok) {
        const hData = await historyRes.json();
        setSyncHistory(hData.history || []);
      }
    } catch (err: any) {
      console.warn('Could not fetch sync status from backend:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatusAndHistory();
    const interval = setInterval(fetchStatusAndHistory, 20000);
    return () => clearInterval(interval);
  }, [googleSheetsConfig.spreadsheetId]);

  // Periksa Koneksi
  const handleCheckConnection = async () => {
    setIsCheckingConnection(true);
    try {
      const res = await fetch('/api/sync/check-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          'x-user-role': currentUser.role,
          'x-user-id': currentUser.id
        }
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(
          `Database: ${data.appDb?.status} (${data.appDb?.latencyMs}ms). Google Sheets: ${data.sheets?.status}`,
          'Pemeriksaan Koneksi Berhasil'
        );
        fetchStatusAndHistory();
      } else {
        toast.error(data.error || 'Gagal memeriksa koneksi', 'Koneksi Terganggu');
      }
    } catch (err: any) {
      toast.error('Gagal menghubungi server backend.', 'Koneksi Error');
    } finally {
      setIsCheckingConnection(false);
    }
  };

  // Sinkronkan Sekarang (Idempotent job trigger)
  const handleSyncNow = async () => {
    if (isSyncingNow || monitoringStatus.isSyncing) {
      toast.error('Proses sinkronisasi sedang berlangsung. Harap tunggu.', 'Proses Aktif');
      return;
    }

    setIsSyncingNow(true);
    try {
      const res = await fetch('/api/sync/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
          'x-user-role': currentUser.role,
          'x-user-id': currentUser.id
        },
        body: JSON.stringify({
          syncType: 'full_sync',
          dataSource: googleSheetsConfig.sheetName || 'Google Sheets Master'
        })
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(
          `Sinkronisasi dimulai dengan Job ID: ${data.jobId}. Status transisi ke Syncing.`,
          'Sinkronisasi Diinisiasi'
        );
        setMonitoringStatus(prev => ({ ...prev, isSyncing: true, currentJobId: data.jobId }));
        // Poll for completion after 1.5 seconds
        setTimeout(() => {
          fetchStatusAndHistory();
          setIsSyncingNow(false);
        }, 1800);
      } else {
        toast.error(data.error || 'Gagal memulai sinkronisasi', 'Sinkronisasi Ditolak');
        setIsSyncingNow(false);
      }
    } catch (err: any) {
      toast.error('Gagal memicu sinkronisasi.', 'Error');
      setIsSyncingNow(false);
    }
  };

  // Filter history
  const filteredHistory = syncHistory.filter(item => {
    if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      return (
        String(item.jobId || '').toLowerCase().includes(q) ||
        String(item.dataSource || '').toLowerCase().includes(q) ||
        String(item.initiatedBy || '').toLowerCase().includes(q) ||
        (item.errorSummary ? String(item.errorSummary).toLowerCase().includes(q) : false)
      );
    }
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Connected':
      case 'Success':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800';
      case 'Syncing':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 border-blue-300 dark:border-blue-800';
      case 'Partial Success':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-800';
      case 'Failed':
      case 'Disconnected':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border-rose-300 dark:border-rose-800';
      case 'Pending':
      case 'Unconfigured':
      default:
        return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-300 dark:border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title */}
      <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 p-4 sm:p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-full text-[#1D4ED8] dark:text-[#38BDF8] text-xs font-semibold mb-2">
            <Radio className="w-3.5 h-3.5 text-[#2563EB] dark:text-[#38BDF8]" />
            <span>MoraJaws Sync Engine & Pipeline Health</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-[#0F172A] dark:text-white tracking-tight flex items-center gap-2">
            <Database className="w-6 h-6 text-[#2563EB] dark:text-[#38BDF8]" />
            <span>Monitoring Sinkronisasi Database</span>
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-300 mt-1 max-w-2xl">
            Pantau status koneksi, latensi, transaksi dua arah antara Database Aplikasi MoraJaws dan Google Sheets terhubung secara real-time.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCheckConnection}
            disabled={isCheckingConnection}
            className="px-3.5 py-2 min-h-[44px] sm:min-h-[38px] text-xs font-semibold text-[#1D4ED8] dark:text-[#38BDF8] bg-blue-50 dark:bg-[#1E293B] hover:bg-blue-100 dark:hover:bg-slate-800 border border-blue-200 dark:border-slate-700 rounded-xl flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            title="Uji koneksi ke database aplikasi dan Google Sheets"
          >
            <Activity className={`w-4 h-4 text-[#2563EB] dark:text-[#38BDF8] ${isCheckingConnection ? 'animate-spin' : ''}`} />
            <span>{isCheckingConnection ? 'Memeriksa...' : 'Periksa Koneksi'}</span>
          </button>

          <button
            type="button"
            onClick={fetchStatusAndHistory}
            disabled={isLoading}
            className="p-2.5 min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center text-slate-500 hover:text-[#0F172A] dark:text-slate-300 dark:hover:text-white bg-slate-100 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-700 cursor-pointer"
            title="Muat Ulang Status"
          >
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {(currentUser.role === 'super_admin' || currentUser.role === 'management_data') && (
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={isSyncingNow || monitoringStatus.isSyncing}
              className="px-4 py-2 min-h-[44px] sm:min-h-[38px] bg-[#2563EB] hover:bg-[#1D4ED8] active:scale-98 text-white rounded-xl font-bold text-xs shadow-sm flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Eksekusi proses sinkronisasi transaksional sekarang"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingNow || monitoringStatus.isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncingNow || monitoringStatus.isSyncing ? 'Sinkronisasi Berjalan...' : 'Sinkronkan Sekarang'}</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 Health Cards Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: App Database Connection */}
        <div className="p-5 bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider">
              Database Aplikasi
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getStatusBadge(monitoringStatus.appDbStatus)}`}>
              {monitoringStatus.appDbStatus}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Indexed Storage</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-300 pt-1">
            Latensi: <strong className="text-emerald-600">8 ms</strong> · Penyimpanan master lokal & persistensi sinkron
          </p>
        </div>

        {/* Card 2: Google Sheets Connection */}
        <div className="p-5 bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider">
              Google Sheets Terhubung
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-[#2563EB] dark:text-[#38BDF8] flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getStatusBadge(monitoringStatus.sheetsStatus)}`}>
              {monitoringStatus.sheetsStatus}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {googleSheetsConfig.sheetName || 'Work_Orders'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-300 pt-1 truncate" title={googleSheetsConfig.spreadsheetTitle || googleSheetsConfig.spreadsheetId || 'Belum dihubungkan'}>
            Sumber: {googleSheetsConfig.spreadsheetTitle || googleSheetsConfig.spreadsheetId || 'Belum dikonfigurasi'}
          </p>
        </div>

        {/* Card 3: Last Sync Status */}
        <div className="p-5 bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider">
              Status Terakhir
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-[#2563EB] dark:text-[#38BDF8] flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getStatusBadge(monitoringStatus.lastSyncStatus)}`}>
              {monitoringStatus.lastSyncStatus}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-300 pt-1">
            {monitoringStatus.lastSyncAt
              ? `Waktu: ${new Date(monitoringStatus.lastSyncAt).toLocaleTimeString('id-ID')} WIB`
              : 'Belum pernah disinkronkan'}
          </p>
        </div>

        {/* Card 4: Record Statistics */}
        <div className="p-5 bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase tracking-wider">
              Total Record Diproses
            </span>
            <div className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-950/80 text-sky-600 dark:text-[#38BDF8] flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-[#0F172A] dark:text-white pt-1">
            {monitoringStatus.totalRecordsProcessed}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-300 flex items-center gap-3">
            <span className="text-emerald-600 font-semibold">Sukses: {monitoringStatus.totalRecordsProcessed}</span>
            <span className="text-rose-600 font-semibold">Gagal: {monitoringStatus.totalRecordsFailed}</span>
          </div>
        </div>
      </div>

      {/* Sync History Table */}
      <div className="bg-white dark:bg-[#0F172A] rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h3 className="text-sm font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8]" />
              <span>Riwayat & Log Transaksi Sinkronisasi</span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-300 mt-0.5">
              Setiap proses mencatat Job ID unik, durasi eksekusi, volume data, dan operator inisiator.
            </p>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari Job ID / Operator..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 min-h-[44px] sm:min-h-[38px] text-xs bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-[#0F172A] dark:text-white focus:outline-hidden focus:ring-1 focus:ring-[#2563EB]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="py-1.5 px-3 min-h-[44px] sm:min-h-[38px] text-xs bg-slate-50 dark:bg-[#1E293B] border border-slate-200 dark:border-slate-700 rounded-xl text-slate-700 dark:text-slate-200 font-medium focus:outline-hidden focus:ring-1 focus:ring-[#2563EB]"
            >
              <option value="ALL">Semua Status</option>
              <option value="Success">Success</option>
              <option value="Syncing">Syncing</option>
              <option value="Failed">Failed</option>
              <option value="Partial Success">Partial Success</option>
            </select>
          </div>
        </div>

        <ResponsiveDataTable<SyncHistoryEntry>
          data={filteredHistory}
          getRowKey={item => item.jobId}
          emptyState={{
            icon: <Database className="w-7 h-7" />,
            title: 'Belum ada riwayat proses sinkronisasi tercatat',
            description: 'Tekan tombol "Sinkronkan Sekarang" di atas untuk menjalankan sinkronisasi pertama.'
          }}
          mobileTitle={item => (
            <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8]">{item.jobId}</span>
          )}
          mobileSubtitle={item => (
            <span className="capitalize">
              {item.syncType.replace('_', ' ')} · {new Date(item.startedAt).toLocaleString('id-ID')}
            </span>
          )}
          mobileStatus={item => (
            <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${getStatusBadge(item.status)}`}>
              {item.status}
            </span>
          )}
          columns={[
            {
              key: 'jobId',
              label: 'Job ID',
              priority: 'hidden_mobile',
              render: item => (
                <span className="font-mono font-bold text-[#2563EB] dark:text-[#38BDF8]">{item.jobId}</span>
              )
            },
            {
              key: 'syncType',
              label: 'Jenis Proses',
              priority: 'hidden_mobile',
              render: item => (
                <span className="capitalize font-medium text-slate-800 dark:text-slate-200">
                  {item.syncType.replace('_', ' ')}
                </span>
              )
            },
            {
              key: 'startedAt',
              label: 'Waktu Mulai',
              priority: 'hidden_mobile',
              render: item => (
                <span className="text-slate-600 dark:text-slate-400 text-[11px] whitespace-nowrap">
                  {new Date(item.startedAt).toLocaleString('id-ID')}
                </span>
              )
            },
            {
              key: 'durationMs',
              label: 'Durasi',
              priority: 'secondary',
              numeric: true,
              render: item => (
                <span className="text-slate-600 dark:text-slate-400 text-[11px]">
                  {item.durationMs ? `${item.durationMs} ms` : '-'}
                </span>
              )
            },
            {
              key: 'status',
              label: 'Status',
              priority: 'hidden_mobile',
              render: item => (
                <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border ${getStatusBadge(item.status)}`}>
                  {item.status}
                </span>
              )
            },
            {
              key: 'processedCount',
              label: 'Diproses',
              priority: 'primary',
              align: 'center',
              numeric: true,
              render: item => (
                <span className="font-bold text-emerald-600 dark:text-emerald-400">{item.processedCount}</span>
              )
            },
            {
              key: 'failedCount',
              label: 'Gagal',
              priority: 'primary',
              align: 'center',
              numeric: true,
              render: item => <span className="font-semibold text-rose-600">{item.failedCount}</span>
            },
            {
              key: 'initiatedBy',
              label: 'Inisiator',
              priority: 'secondary',
              render: item => (
                <span className="text-slate-700 dark:text-slate-300 text-xs">
                  {item.initiatedBy} {item.initiatedByRole ? `(${item.initiatedByRole})` : ''}
                </span>
              )
            }
          ] satisfies ResponsiveColumn<SyncHistoryEntry>[]}
          getRowActions={item => [
            {
              id: 'detail',
              label: 'Lihat Detail Transaksi',
              icon: <Eye className="w-3.5 h-3.5" />,
              onClick: () => setSelectedHistoryItem(item)
            }
          ]}
          renderDesktopActions={item => (
            <button
              type="button"
              onClick={() => setSelectedHistoryItem(item)}
              className="px-2.5 py-1 text-[11px] font-semibold text-[#2563EB] dark:text-[#38BDF8] hover:text-[#1D4ED8] bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer"
            >
              Detail
            </button>
          )}
        />
      </div>

      {/* Process Details Modal */}
      <ResponsiveModal
        isOpen={Boolean(selectedHistoryItem)}
        onClose={() => setSelectedHistoryItem(null)}
        title={selectedHistoryItem ? `Detail Transaksi Sinkronisasi (${selectedHistoryItem.jobId})` : undefined}
        subtitle={selectedHistoryItem?.dataSource}
        icon={<Database className="w-4 h-4" />}
        size="md"
        mobileVariant="sheet"
        footer={
          <button
            type="button"
            onClick={() => setSelectedHistoryItem(null)}
            className="px-4 py-2 min-h-[44px] sm:min-h-[40px] bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold rounded-xl text-xs cursor-pointer"
          >
            Tutup
          </button>
        }
      >
        {selectedHistoryItem && (
          <div className="p-3.5 bg-slate-50 dark:bg-[#0B1220] rounded-xl space-y-2 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 font-sans">Job ID:</span>
              <span className="font-bold text-[#2563EB] dark:text-[#38BDF8] text-right">{selectedHistoryItem.jobId}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 font-sans">Sumber Data:</span>
              <span className="text-slate-700 dark:text-slate-300 text-right">{selectedHistoryItem.dataSource}</span>
            </div>
            <div className="flex justify-between gap-3 items-center">
              <span className="text-slate-500 font-sans">Status:</span>
              <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${getStatusBadge(selectedHistoryItem.status)}`}>
                {selectedHistoryItem.status}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 font-sans">Waktu Mulai:</span>
              <span className="text-slate-700 dark:text-slate-300 text-right">{new Date(selectedHistoryItem.startedAt).toLocaleString('id-ID')}</span>
            </div>
            {selectedHistoryItem.completedAt && (
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 font-sans">Waktu Selesai:</span>
                <span className="text-slate-700 dark:text-slate-300 text-right">{new Date(selectedHistoryItem.completedAt).toLocaleString('id-ID')}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 font-sans">Total Diproses:</span>
              <span className="font-bold text-emerald-600">{selectedHistoryItem.processedCount} baris</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 font-sans">Berhasil:</span>
              <span className="font-bold text-emerald-600">{selectedHistoryItem.successCount} baris</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 font-sans">Gagal:</span>
              <span className="font-bold text-rose-600">{selectedHistoryItem.failedCount} baris</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 font-sans">Inisiator:</span>
              <span className="text-slate-800 dark:text-slate-200 font-semibold text-right">{selectedHistoryItem.initiatedBy}</span>
            </div>
            {selectedHistoryItem.errorSummary && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-rose-600 text-[11px] font-sans">
                <strong>Catatan Error:</strong> {selectedHistoryItem.errorSummary}
              </div>
            )}
          </div>
        )}
      </ResponsiveModal>
    </div>
  );
};
