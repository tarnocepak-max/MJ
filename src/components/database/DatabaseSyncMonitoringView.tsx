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
    appDbStatus: 'Pending',
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
  const [syncFetchError, setSyncFetchError] = useState<string | null>(null);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [isSyncingNow, setIsSyncingNow] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<SyncHistoryEntry | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch live sync status and history
  const fetchStatusAndHistory = async () => {
    setIsLoading(true);
    setSyncFetchError(null);
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
      } else {
        setSyncFetchError(`Gagal memuat status sync (HTTP ${statusRes.status})`);
        setMonitoringStatus(prev => ({ ...prev, appDbStatus: 'Disconnected' }));
      }

      if (historyRes.ok) {
        const hData = await historyRes.json();
        setSyncHistory(hData.history || []);
      }
    } catch (err: any) {
      setSyncFetchError(err?.message || 'Gagal menghubungi backend sync monitoring');
      setMonitoringStatus(prev => ({ ...prev, appDbStatus: 'Disconnected' }));
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
        return 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2A174B] dark:text-[#E8DDFF] border-[#C5BEEF] dark:border-[#5B289B]';
      case 'Partial Success':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border-amber-300 dark:border-amber-800';
      case 'Failed':
      case 'Disconnected':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 border-rose-300 dark:border-rose-800';
      case 'Pending':
      case 'Unconfigured':
      default:
        return 'bg-[#F4F7FB] text-[#52647A] dark:bg-[#1F1638] dark:text-[#CEC0E8] border-[#DDE6F0] dark:border-[#35105E]';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#DDF4F4] border border-[#BDE4E8] text-[#2E7D8B] dark:bg-gradient-to-b dark:from-[#6b103b] dark:to-[#480123] dark:border-[#FBCFE8]/25 dark:text-white rounded-full text-[10.5px] font-extrabold uppercase tracking-wider mb-2 shadow-xs">
            <Radio className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#FBCFE8]" />
            <span>MoraJaws Sync Engine &amp; Pipeline Health</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-display font-extrabold text-[#26364A] dark:text-white tracking-tight flex items-center gap-2.5">
            <Database className="w-6 h-6 text-[#5145A6] dark:text-[#D8B4FE]" />
            <span>Monitoring Sinkronisasi Database</span>
          </h2>
          <p className="text-xs sm:text-sm text-[#52647A] dark:text-[#CEC0E8] mt-1 max-w-2xl">
            Pantau status koneksi, latensi, transaksi dua arah antara Database Aplikasi MoraJaws dan Google Sheets terhubung secara real-time.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCheckConnection}
            disabled={isCheckingConnection}
            className="btn-3d-lilac px-3.5 py-2 min-h-[44px] sm:min-h-[38px] text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
            title="Uji koneksi ke database aplikasi dan Google Sheets"
          >
            <Activity className={`w-4 h-4 ${isCheckingConnection ? 'animate-spin' : ''}`} />
            <span>{isCheckingConnection ? 'Memeriksa...' : 'Periksa Koneksi'}</span>
          </button>

          <button
            type="button"
            onClick={fetchStatusAndHistory}
            disabled={isLoading}
            className="btn-3d-icon p-2.5 min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] flex items-center justify-center rounded-xl cursor-pointer"
            title="Muat Ulang Status"
          >
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          {currentUser.role === 'super_admin' && (
            <button
              type="button"
              onClick={handleSyncNow}
              disabled={isSyncingNow || monitoringStatus.isSyncing}
              className="btn-3d-primary px-4 py-2 min-h-[44px] sm:min-h-[38px] text-white rounded-xl font-bold text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Eksekusi proses sinkronisasi transaksional sekarang"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingNow || monitoringStatus.isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncingNow || monitoringStatus.isSyncing ? 'Sinkronisasi Berjalan...' : 'Sinkronkan Sekarang'}</span>
            </button>
          )}
        </div>
      </div>

      {syncFetchError && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3 text-xs text-rose-700 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{syncFetchError}</span>
          </div>
          <button
            type="button"
            onClick={fetchStatusAndHistory}
            className="px-3 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-bold text-[11px] cursor-pointer"
          >
            Coba Lagi
          </button>
        </div>
      )}

      {/* 4 Health Cards Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: App Database Connection */}
        <div className="card-3d-lavender p-5 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wider">
              Database Aplikasi
            </span>
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                monitoringStatus.appDbStatus === 'Connected'
                  ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600'
                  : monitoringStatus.appDbStatus === 'Disconnected'
                  ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-600'
                  : 'bg-amber-100 dark:bg-amber-950/80 text-amber-600'
              }`}
            >
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getStatusBadge(monitoringStatus.appDbStatus)}`}>
              {monitoringStatus.appDbStatus}
            </span>
            <span className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8]">PostgreSQL</span>
          </div>
          <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] pt-1">
            Status:{' '}
            <strong
              className={
                monitoringStatus.appDbStatus === 'Connected'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : monitoringStatus.appDbStatus === 'Disconnected'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-amber-600 dark:text-amber-400'
              }
            >
              {monitoringStatus.appDbStatus}
            </strong>{' '}
            · {monitoringStatus.appDbStatus === 'Connected' ? 'Penyimpanan master tersinkron' : 'Memantau koneksi backend'}
          </p>
        </div>

        {/* Card 2: Google Sheets Connection */}
        <div className="card-3d-lavender p-5 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wider">
              Google Sheets Terhubung
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#DDF4F4] border border-[#BDE4E8] dark:border-transparent dark:bg-[#2A174B] text-[#2E7D8B] dark:text-[#D8B4FE] flex items-center justify-center">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getStatusBadge(monitoringStatus.sheetsStatus)}`}>
              {monitoringStatus.sheetsStatus}
            </span>
            <span className="text-[11px] text-[#8492A5] dark:text-[#CEC0E8]">
              {googleSheetsConfig.sheetName || 'Work_Orders'}
            </span>
          </div>
          <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] pt-1 truncate" title={googleSheetsConfig.spreadsheetTitle || googleSheetsConfig.spreadsheetId || 'Belum dihubungkan'}>
            Sumber: {googleSheetsConfig.spreadsheetTitle || googleSheetsConfig.spreadsheetId || 'Belum dikonfigurasi'}
          </p>
        </div>

        {/* Card 3: Last Sync Status */}
        <div className="card-3d-lavender p-5 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wider">
              Status Terakhir
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#EAE8FF] border border-[#C5BEEF] dark:border-transparent dark:bg-[#2A174B] text-[#5145A6] dark:text-[#D8B4FE] flex items-center justify-center">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-extrabold border ${getStatusBadge(monitoringStatus.lastSyncStatus)}`}>
              {monitoringStatus.lastSyncStatus}
            </span>
          </div>
          <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] pt-1 font-mono tabular-nums">
            {monitoringStatus.lastSyncAt
              ? `Waktu: ${new Date(monitoringStatus.lastSyncAt).toLocaleTimeString('id-ID')} WIB`
              : 'Belum pernah disinkronkan'}
          </p>
        </div>

        {/* Card 4: Record Statistics */}
        <div className="card-3d-lavender p-5 rounded-2xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#52647A] dark:text-[#CEC0E8] uppercase tracking-wider">
              Total Record Diproses
            </span>
            <div className="w-8 h-8 rounded-xl bg-[#EAE8FF] border border-[#C5BEEF] dark:border-transparent dark:bg-[#2A174B] text-[#5145A6] dark:text-[#D8B4FE] flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-extrabold text-[#26364A] dark:text-white font-mono tabular-nums pt-1">
            {monitoringStatus.totalRecordsProcessed}
          </div>
          <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] flex items-center gap-3 font-mono tabular-nums">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Sukses: {monitoringStatus.totalRecordsProcessed}</span>
            <span className="text-rose-600 dark:text-rose-400 font-semibold">Gagal: {monitoringStatus.totalRecordsFailed}</span>
          </div>
        </div>
      </div>

      {/* Sync History Table */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#DDE6F0] dark:border-[#35105E] pb-4">
          <div>
            <h3 className="text-sm font-bold text-[#26364A] dark:text-white flex items-center gap-2">
              <History className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
              <span>Riwayat &amp; Log Transaksi Sinkronisasi</span>
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
              Setiap proses mencatat Job ID unik, durasi eksekusi, volume data, dan operator inisiator.
            </p>
          </div>

          {/* Filters & Search */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#8492A5] dark:text-[#766B83]" />
              <input
                type="text"
                placeholder="Cari Job ID / Operator..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="tactile-debossed-input w-full pl-8 pr-3 py-1.5 min-h-[44px] sm:min-h-[38px] text-xs rounded-xl text-[#26364A] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="tactile-debossed-input py-1.5 px-3 min-h-[44px] sm:min-h-[38px] text-xs rounded-xl text-[#26364A] dark:text-white font-semibold focus:outline-hidden focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
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
            <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">{item.jobId}</span>
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
                <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">{item.jobId}</span>
              )
            },
            {
              key: 'syncType',
              label: 'Jenis Proses',
              priority: 'hidden_mobile',
              render: item => (
                <span className="capitalize font-medium text-[#26364A] dark:text-white">
                  {item.syncType.replace('_', ' ')}
                </span>
              )
            },
            {
              key: 'startedAt',
              label: 'Waktu Mulai',
              priority: 'hidden_mobile',
              render: item => (
                <span className="text-[#52647A] dark:text-[#CEC0E8] text-[11px] font-mono tabular-nums whitespace-nowrap">
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
                <span className="text-[#52647A] dark:text-[#CEC0E8] text-[11px] font-mono tabular-nums">
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
                <span className="font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">{item.processedCount}</span>
              )
            },
            {
              key: 'failedCount',
              label: 'Gagal',
              priority: 'primary',
              align: 'center',
              numeric: true,
              render: item => <span className="font-semibold font-mono tabular-nums text-rose-600">{item.failedCount}</span>
            },
            {
              key: 'initiatedBy',
              label: 'Inisiator',
              priority: 'secondary',
              render: item => (
                <span className="text-[#26364A] dark:text-[#E8DDFF] text-xs">
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
              className="btn-3d-lilac px-2.5 py-1 text-[11px] font-bold rounded-lg cursor-pointer"
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
            className="btn-3d-lilac px-4 py-2 min-h-[44px] sm:min-h-[40px] font-bold rounded-xl text-xs cursor-pointer"
          >
            Tutup
          </button>
        }
      >
        {selectedHistoryItem && (
          <div className="p-3.5 bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] rounded-xl space-y-2 font-mono text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Job ID:</span>
              <span className="font-bold text-[#5145A6] dark:text-[#D8B4FE] text-right">{selectedHistoryItem.jobId}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Sumber Data:</span>
              <span className="text-[#26364A] dark:text-white text-right">{selectedHistoryItem.dataSource}</span>
            </div>
            <div className="flex justify-between gap-3 items-center">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Status:</span>
              <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${getStatusBadge(selectedHistoryItem.status)}`}>
                {selectedHistoryItem.status}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Waktu Mulai:</span>
              <span className="text-[#26364A] dark:text-white text-right">{new Date(selectedHistoryItem.startedAt).toLocaleString('id-ID')}</span>
            </div>
            {selectedHistoryItem.completedAt && (
              <div className="flex justify-between gap-3">
                <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Waktu Selesai:</span>
                <span className="text-[#26364A] dark:text-white text-right">{new Date(selectedHistoryItem.completedAt).toLocaleString('id-ID')}</span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Total Diproses:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{selectedHistoryItem.processedCount} baris</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Berhasil:</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">{selectedHistoryItem.successCount} baris</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Gagal:</span>
              <span className="font-bold text-rose-600 dark:text-rose-400">{selectedHistoryItem.failedCount} baris</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#52647A] dark:text-[#CEC0E8] font-sans">Inisiator:</span>
              <span className="text-[#26364A] dark:text-white font-semibold text-right">{selectedHistoryItem.initiatedBy}</span>
            </div>
            {selectedHistoryItem.errorSummary && (
              <div className="pt-2 border-t border-[#DDE6F0] dark:border-[#35105E] text-rose-600 text-[11px] font-sans">
                <strong>Catatan Error:</strong> {selectedHistoryItem.errorSummary}
              </div>
            )}
          </div>
        )}
      </ResponsiveModal>
    </div>
  );
};
