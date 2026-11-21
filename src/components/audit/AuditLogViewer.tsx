import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import {
  History,
  Download,
  ShieldAlert,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Layers,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import { SortState, getNextSortDirection, sortDataArray } from '../../utils/tableSorting';
import {
  getConfigVersions,
  rollbackGlobalConfig,
  GlobalConfigVersionItem
} from '../../services/globalConfigService';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { FilterToolbar } from '../common/FilterToolbar';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { AuditLog } from '../../types';

const CONFIG_KEY_OPTIONS = [
  { value: 'ALL', label: 'Semua Kunci Konfigurasi' },
  { value: 'global_config', label: 'global_config (Branding & System)' },
  { value: 'ui_configuration', label: 'ui_configuration (UI Builder)' },
  { value: 'navigation_doc', label: 'navigation_doc (Navigasi Sidebar)' },
  { value: 'role_permissions', label: 'role_permissions (Matriks RBAC)' },
  { value: 'sound_settings', label: 'sound_settings (Audio Notifikasi)' },
  { value: 'workflow_rules', label: 'workflow_rules (Otomatisasi Workflow)' },
  { value: 'header_mappings', label: 'header_mappings (Alias Kolom)' },
  { value: 'canonical_fields', label: 'canonical_fields (Skema Field WO)' },
  { value: 'root_cause_categories', label: 'root_cause_categories (Root Cause)' },
  { value: 'hierarchical_droplists', label: 'hierarchical_droplists (Droplist WO)' },
  { value: 'chat_categories', label: 'chat_categories (Kategori LiveChat)' },
  { value: 'report_dropdown_categories', label: 'report_dropdown_categories (Dropdown Laporan)' },
  { value: 'google_sheets_config', label: 'google_sheets_config (Google Sheets Sync)' },
  { value: 'operational_date_config', label: 'operational_date_config (Tanggal Operasional)' }
];

export const AuditLogViewer: React.FC = () => {
  const { auditLogs, currentUser, loadCentralData, toast } = useApp();
  const { loadConfigFromSupabase, reloadNavigationFromSupabase } = useUIConfig();
  const { isCompactUI } = useResponsiveViewport();

  const [activeSubTab, setActiveSubTab] = useState<'audit_trail' | 'config_versions'>('audit_trail');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntity, setSelectedEntity] = useState('ALL');
  const [sortState, setSortState] = useState<SortState>({ column: 'timestamp', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number | 'ALL'>(25);

  // Config Version History & Rollback state
  const [selectedConfigKey, setSelectedConfigKey] = useState<string>('ALL');
  const [configVersions, setConfigVersions] = useState<GlobalConfigVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<GlobalConfigVersionItem | null>(null);
  const [rollbackNotes, setRollbackNotes] = useState('');
  const [isRollingBack, setIsRollingBack] = useState(false);

  const isSuperAdmin = currentUser.role === 'super_admin';
  const canViewAuditLogs = currentUser.role === 'super_admin' || currentUser.role === 'it_support';

  const fetchVersions = useCallback(async () => {
    if (!canViewAuditLogs) return;
    setVersionsLoading(true);
    setVersionsError(null);
    try {
      const items = await getConfigVersions(selectedConfigKey === 'ALL' ? undefined : selectedConfigKey, 100);
      setConfigVersions(items);
    } catch (err: any) {
      setVersionsError(err?.message || 'Gagal memuat riwayat versi konfigurasi global.');
    } finally {
      setVersionsLoading(false);
    }
  }, [canViewAuditLogs, selectedConfigKey]);

  useEffect(() => {
    if (activeSubTab === 'config_versions') {
      fetchVersions();
    }
  }, [activeSubTab, fetchVersions]);

  const handleConfirmRollback = async () => {
    if (!rollbackTarget || !isSuperAdmin || isRollingBack) return;
    setIsRollingBack(true);
    try {
      const res = await rollbackGlobalConfig(rollbackTarget.config_key, {
        targetVersionId: rollbackTarget.id,
        notes: rollbackNotes.trim() || `Rollback melalui Audit UI ke v${rollbackTarget.version}`
      });
      toast.success(
        `Konfigurasi "${res.key}" dipulihkan ke snapshot v${res.restoredFromVersion} sebagai versi baru v${res.version}.`,
        'Rollback Berhasil'
      );
      setRollbackTarget(null);
      setRollbackNotes('');
      await Promise.all([
        fetchVersions(),
        loadCentralData().catch(() => {}),
        loadConfigFromSupabase().catch(() => {}),
        reloadNavigationFromSupabase().catch(() => {})
      ]);
    } catch (err: any) {
      toast.error(err?.message || 'Gagal melakukan rollback konfigurasi.', 'Rollback Gagal');
    } finally {
      setIsRollingBack(false);
    }
  };

  const handleSort = (colKey: string) => {
    setSortState(prev => {
      const nextDir = getNextSortDirection(prev.column, prev.direction, colKey);
      return { column: nextDir ? colKey : null, direction: nextDir };
    });
    setCurrentPage(1);
  };

  const filteredLogs = useMemo(() => {
    return auditLogs.filter(log => {
      if (selectedEntity !== 'ALL' && log.entity !== selectedEntity) return false;
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        return (
          String(log.action || '').toLowerCase().includes(q) ||
          String(log.details || '').toLowerCase().includes(q) ||
          String(log.performedBy || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [auditLogs, selectedEntity, searchTerm]);

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

  const auditColumns: ResponsiveColumn<AuditLog>[] = useMemo(
    () => [
      {
        key: 'timestamp',
        label: 'Timestamp',
        sortable: true,
        priority: 'secondary',
        numeric: true,
        tdClassName: 'whitespace-nowrap text-[#6A5A88] dark:text-[#CEC0E8] font-mono tabular-nums',
        render: log => new Date(log.timestamp).toLocaleString('id-ID')
      },
      {
        key: 'action',
        label: 'Action',
        sortable: true,
        priority: 'hidden_mobile',
        tdClassName: 'font-bold text-[#1E1035] dark:text-white whitespace-nowrap',
        render: log => log.action
      },
      {
        key: 'entity',
        label: 'Entity',
        sortable: true,
        priority: 'secondary',
        tdClassName: 'whitespace-nowrap font-mono text-[11px] font-bold text-[#5B289B] dark:text-[#D8B4FE] uppercase',
        render: log => log.entity
      },
      {
        key: 'details',
        label: 'Details',
        sortable: true,
        priority: 'primary',
        tdClassName: 'text-[#4A3B63] dark:text-[#D9CCF2] max-w-md break-words',
        render: log => <span className="break-words">{log.details}</span>
      },
      {
        key: 'performedBy',
        label: 'Performed By',
        sortable: true,
        priority: 'secondary',
        tdClassName: 'font-semibold text-[#1E1035] dark:text-white whitespace-nowrap',
        render: log => log.performedBy
      },
      {
        key: 'userRole',
        label: 'Role',
        sortable: true,
        priority: 'secondary',
        tdClassName: 'font-mono text-[11px] text-[#6A5A88] dark:text-[#CEC0E8] capitalize whitespace-nowrap',
        render: log => String(log.userRole || '').replace('_', ' ')
      }
    ],
    []
  );

  if (!canViewAuditLogs) {
    return (
      <div className="card-3d-lavender rounded-2xl p-8 text-center max-w-lg mx-auto space-y-4 my-8">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto border border-rose-200 dark:border-rose-800">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-bold text-[#1E1035] dark:text-white text-base">
          Akses Ditolak: Otoritas Audit Log Dibatasi
        </h3>
        <p className="text-xs text-[#6A5A88] dark:text-[#CEC0E8] leading-relaxed">
          Berdasarkan Konstitusi Keamanan MoraJaws, akses pembacaan jejak audit (Audit Log &amp; History) dibatasi hanya untuk <strong>Super Admin</strong> dan <strong>IT Support (Read-Only)</strong>.
        </p>
        <div className="p-3 bg-[#F3EAFF] dark:bg-[#2A174B] rounded-xl text-xs text-[#431599] dark:text-[#E8DDFF] font-medium border border-[#D8CCF3] dark:border-[#4A2580]">
          Akun Anda: <span className="font-bold capitalize">{currentUser.name} ({currentUser.role})</span>. Akses ditolak pada level UI dan Backend Server.
        </div>
      </div>
    );
  }

  const handleExportCSV = () => {
    const headers = 'ID,Timestamp,Action,Entity,EntityID,PerformedBy,Role,Details\n';
    const rows = filteredLogs
      .map(l =>
        `"${l.id}","${l.timestamp}","${l.action}","${l.entity}","${l.entityId}","${l.performedBy}","${l.userRole}","${String(l.details || '').replace(/"/g, '""')}"`
      )
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Dispatch_Audit_Logs_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Header & Sub-tab Switcher */}
      <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#5B289B] to-[#35105E] text-white flex items-center justify-center shrink-0 shadow-[0_6px_14px_rgba(53,16,94,0.28)]">
            <History className="w-5 h-5 text-[#E8DDFF]" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-gradient-to-b from-[#6b103b] to-[#480123] text-white shadow-xs">
                AUDIT &amp; GOVERNANCE
              </span>
              <span className="text-[11px] font-mono font-bold text-[#6A5A88] dark:text-[#CEC0E8] tabular-nums">
                {auditLogs.length} Log Tercatat
              </span>
            </div>
            <h2 className="text-sm sm:text-base font-display font-extrabold text-[#1E1035] dark:text-white leading-snug tracking-tight">
              System Audit Trail &amp; Global Config Version Control
            </h2>
            <p className="text-xs text-[#6A5A88] dark:text-[#CEC0E8] mt-0.5 leading-relaxed">
              Catatan jejak audit operasional serta riwayat versi konfigurasi global dengan fitur rollback tervalidasi.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="mj-tactile-tab-bar p-1 rounded-xl inline-flex flex-wrap items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setActiveSubTab('audit_trail')}
              className={`px-3.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-lg font-bold transition-all cursor-pointer ${
                activeSubTab === 'audit_trail'
                  ? 'btn-3d-primary text-white'
                  : 'text-[#5A487A] dark:text-[#CEC0E8] hover:text-[#1E1035] dark:hover:text-white'
              }`}
            >
              Audit Trail Log
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('config_versions')}
              className={`px-3.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-lg font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeSubTab === 'config_versions'
                  ? 'btn-3d-primary text-white'
                  : 'text-[#5A487A] dark:text-[#CEC0E8] hover:text-[#1E1035] dark:hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>Versi &amp; Rollback Konfigurasi</span>
            </button>
          </div>

          {activeSubTab === 'audit_trail' && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="btn-3d-lilac px-3.5 py-2 min-h-[44px] sm:min-h-[38px] text-xs font-bold rounded-xl inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {activeSubTab === 'audit_trail' ? (
        <div className="space-y-4">
          <FilterToolbar
            searchValue={searchTerm}
            onSearchChange={val => {
              setSearchTerm(val);
              setCurrentPage(1);
            }}
            searchPlaceholder="Cari action, details, atau user..."
            activeFilterCount={selectedEntity !== 'ALL' ? 1 : 0}
            onResetFilters={() => {
              setSearchTerm('');
              setSelectedEntity('ALL');
              setCurrentPage(1);
            }}
          >
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[#6A5A88] dark:text-[#CEC0E8] shrink-0">
                Entity:
              </label>
              <select
                value={selectedEntity}
                onChange={e => {
                  setSelectedEntity(e.target.value);
                  setCurrentPage(1);
                }}
                className="tactile-debossed-input flex-1 sm:w-56 px-3 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-xs font-semibold text-[#1E1035] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
              >
                <option value="ALL">All Entities</option>
                <option value="global_config">Global Configurations</option>
                <option value="ticket">Ticket Work Orders</option>
                <option value="template">WhatsApp Templates</option>
                <option value="workflow">Workflows</option>
                <option value="ui_config">UI Configurations</option>
                <option value="import_batch">Import Batches</option>
                <option value="auth">Authentication &amp; Roles</option>
              </select>
            </div>
          </FilterToolbar>

          <ResponsiveDataTable<AuditLog>
            data={paginatedLogs}
            columns={auditColumns}
            getRowKey={log => log.id}
            sortKey={sortState.column}
            sortDirection={sortState.direction}
            onSort={handleSort}
            mobileTitle={log => log.action}
            mobileSubtitle={log => `${log.performedBy} • ${new Date(log.timestamp).toLocaleString('id-ID')}`}
            mobileStatus={log => (
              <>
                <span className="px-2 py-0.5 rounded-full bg-[#F3EAFF] dark:bg-[#2A174B] text-[#5B289B] dark:text-[#D8B4FE] border border-[#D8CCF3] dark:border-[#4A2580] font-mono text-[10px] font-bold uppercase">
                  {log.entity}
                </span>
                <span className="px-2 py-0.5 rounded-full bg-[#F8F1FF] dark:bg-[#1F1638] text-[#6A5A88] dark:text-[#CEC0E8] font-mono text-[10px] capitalize">
                  {String(log.userRole || '').replace('_', ' ')}
                </span>
              </>
            )}
            emptyState={{
              title: 'Tidak ada catatan audit yang cocok',
              description: 'Coba ubah kata kunci pencarian atau filter entitas.'
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
              itemLabel: 'audit logs'
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card-3d-lavender rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0">
              <label className="font-bold text-[#1E1035] dark:text-[#E8DDFF] shrink-0">Kunci Konfigurasi:</label>
              <select
                value={selectedConfigKey}
                onChange={e => setSelectedConfigKey(e.target.value)}
                className="tactile-debossed-input w-full sm:w-auto px-3 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl text-[#1E1035] dark:text-white font-semibold focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
              >
                {CONFIG_KEY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={fetchVersions}
              disabled={versionsLoading}
              className="btn-3d-lilac px-3.5 py-2 min-h-[44px] sm:min-h-[38px] rounded-xl font-bold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${versionsLoading ? 'animate-spin' : ''}`} />
              <span>Muat Ulang Versi</span>
            </button>
          </div>

          {versionsError && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{versionsError}</span>
            </div>
          )}

          {/* Mobile Card Stack for Config Versions */}
          {isCompactUI ? (
            <div className="space-y-2.5">
            {versionsLoading ? (
              <div className="card-3d-lavender p-8 text-center text-xs text-[#6A5A88] dark:text-[#CEC0E8] rounded-2xl">
                Memuat riwayat versi konfigurasi dari database...
              </div>
            ) : configVersions.length === 0 ? (
              <div className="card-3d-lavender p-8 text-center text-xs text-[#6A5A88] dark:text-[#CEC0E8] rounded-2xl">
                Belum ada snapshot riwayat versi untuk kunci ini.
              </div>
            ) : (
              configVersions.map(ver => {
                const isExpanded = expandedVersionId === ver.id;
                return (
                  <div
                    key={ver.id}
                    className="card-3d-lavender rounded-2xl p-3.5 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-xs text-[#1E1035] dark:text-white break-all">
                          {ver.config_key}
                        </div>
                        <div className="text-[11px] font-mono text-[#6A5A88] dark:text-[#CEC0E8] mt-0.5 tabular-nums">
                          {new Date(ver.created_at).toLocaleString('id-ID')}
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded-lg bg-[#F3EAFF] text-[#431599] border border-[#D8CCF3] dark:bg-[#2A174B] dark:text-[#E8DDFF] dark:border-[#5B289B] font-mono text-[11px] font-bold shrink-0">
                        v{ver.version}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <span
                        className={`px-2 py-0.5 rounded-lg font-bold ${
                          ver.action === 'ROLLBACK'
                            ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800'
                            : 'bg-[#F8F1FF] text-[#431599] border border-[#E4D8F8] dark:bg-[#2A174B] dark:text-[#D8B4FE] dark:border-[#4A2580]'
                        }`}
                      >
                        {ver.action}
                      </span>
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {ver.tx_status}
                      </span>
                      <span className="text-[#4A3B63] dark:text-[#D9CCF2] font-medium">
                        oleh {ver.changed_by_name || 'System'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setExpandedVersionId(isExpanded ? null : ver.id)}
                        className="btn-3d-lilac px-3 py-1.5 min-h-[40px] sm:min-h-[36px] rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        <span>{isExpanded ? 'Tutup JSON' : 'Lihat Snapshot JSON'}</span>
                      </button>

                      {isSuperAdmin ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRollbackTarget(ver);
                            setRollbackNotes('');
                          }}
                          className="btn-3d-primary px-3 py-1.5 min-h-[40px] sm:min-h-[36px] text-white rounded-xl text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Rollback</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-[#766B83] font-mono">Read-Only</span>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="pt-2.5 border-t border-dashed border-[#D8CCF3] dark:border-[#35105E] space-y-2.5">
                        <div>
                          <div className="text-[10.5px] font-bold text-[#6A5A88] dark:text-[#CEC0E8] uppercase mb-1">Previous Value</div>
                          <pre className="p-2.5 rounded-lg bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E4D8F8] dark:border-[#35105E] text-[10.5px] font-mono overflow-x-auto max-h-52 text-[#211A2E] dark:text-[#E8DDFF]">
                            {JSON.stringify(ver.previous_value, null, 2) || 'null'}
                          </pre>
                        </div>
                        <div>
                          <div className="text-[10.5px] font-bold text-[#5B289B] dark:text-[#D8B4FE] uppercase mb-1">
                            New Value (Snapshot v{ver.version})
                          </div>
                          <pre className="p-2.5 rounded-lg bg-[#F8F1FF] dark:bg-[#160D29] border border-[#CBB5F6] dark:border-[#5B289B] text-[10.5px] font-mono overflow-x-auto max-h-52 text-[#211A2E] dark:text-[#E8DDFF]">
                            {JSON.stringify(ver.new_value, null, 2) || 'null'}
                          </pre>
                        </div>
                        {ver.notes && (
                          <div className="text-[11px] text-[#6A5A88] dark:text-[#CEC0E8]">
                            <strong>Catatan:</strong> {ver.notes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
            </div>
          ) : (
            <div className="card-3d-lavender rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#241145] dark:bg-[#120926] text-[11px] font-bold text-[#EADFFF] uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-3 w-8"></th>
                    <th className="py-3 px-3">Waktu</th>
                    <th className="py-3 px-3">Kunci Konfigurasi</th>
                    <th className="py-3 px-3">Versi</th>
                    <th className="py-3 px-3">Aksi</th>
                    <th className="py-3 px-3">Diubah Oleh</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Pemulihan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDE4FA] dark:divide-[#2D1852]">
                  {versionsLoading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-[#6A5A88] dark:text-[#CEC0E8]">
                        Memuat riwayat versi konfigurasi dari database...
                      </td>
                    </tr>
                  ) : configVersions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-[#6A5A88] dark:text-[#CEC0E8]">
                        Belum ada snapshot riwayat versi untuk kunci ini.
                      </td>
                    </tr>
                  ) : (
                    configVersions.map(ver => {
                      const isExpanded = expandedVersionId === ver.id;
                      return (
                        <React.Fragment key={ver.id}>
                          <tr className="hover:bg-[#F5EEFF]/70 dark:hover:bg-[#241242]/60 transition-colors">
                            <td className="py-2.5 px-3">
                              <button
                                type="button"
                                onClick={() => setExpandedVersionId(isExpanded ? null : ver.id)}
                                className="p-1 text-[#6A5A88] hover:text-[#35105E] dark:text-[#CEC0E8] dark:hover:text-white cursor-pointer"
                                title="Lihat Snapshot JSON"
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-[#6A5A88] dark:text-[#CEC0E8] whitespace-nowrap">
                              {new Date(ver.created_at).toLocaleString('id-ID')}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold text-[#1E1035] dark:text-white whitespace-nowrap">
                              {ver.config_key}
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums">
                              <span className="px-2 py-0.5 rounded-lg bg-[#F3EAFF] text-[#431599] border border-[#D8CCF3] dark:bg-[#2A174B] dark:text-[#E8DDFF] dark:border-[#5B289B] font-bold">
                                v{ver.version}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-semibold whitespace-nowrap">
                              <span
                                className={`px-2 py-0.5 rounded-lg text-[10.5px] font-bold ${
                                  ver.action === 'ROLLBACK'
                                    ? 'bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800'
                                    : 'bg-[#F8F1FF] text-[#431599] border border-[#E4D8F8] dark:bg-[#2A174B] dark:text-[#D8B4FE] dark:border-[#4A2580]'
                                }`}
                              >
                                {ver.action}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="font-semibold text-[#1E1035] dark:text-white">
                                {ver.changed_by_name || 'System'}
                              </span>
                              {ver.changed_by_role && (
                                <span className="ml-1.5 text-[10px] font-mono text-[#766B83] dark:text-[#A78BFA]">
                                  ({ver.changed_by_role})
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-mono text-[11px] font-semibold">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {ver.tx_status}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              {isSuperAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRollbackTarget(ver);
                                    setRollbackNotes('');
                                  }}
                                  className="btn-3d-lilac px-2.5 py-1 rounded-lg font-bold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Rollback ke Versi Ini</span>
                                </button>
                              ) : (
                                <span className="text-[11px] text-[#766B83] font-mono">Read-Only</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-[#F8F1FF]/70 dark:bg-[#160D29]/70">
                              <td colSpan={8} className="p-4">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                    <div className="text-[11px] font-bold text-[#6A5A88] dark:text-[#CEC0E8] uppercase">Previous Value</div>
                                    <pre className="p-3 rounded-xl bg-white dark:bg-[#1E1238] border border-[#E4D8F8] dark:border-[#35105E] text-[11px] font-mono overflow-x-auto max-h-60 text-[#211A2E] dark:text-[#E8DDFF]">
                                      {JSON.stringify(ver.previous_value, null, 2) || 'null'}
                                    </pre>
                                  </div>
                                  <div className="space-y-1.5">
                                    <div className="text-[11px] font-bold text-[#5B289B] dark:text-[#D8B4FE] uppercase">
                                      New Value (Snapshot v{ver.version})
                                    </div>
                                    <pre className="p-3 rounded-xl bg-white dark:bg-[#1E1238] border border-[#CBB5F6] dark:border-[#5B289B] text-[11px] font-mono overflow-x-auto max-h-60 text-[#211A2E] dark:text-[#E8DDFF]">
                                      {JSON.stringify(ver.new_value, null, 2) || 'null'}
                                    </pre>
                                  </div>
                                </div>
                                {ver.notes && (
                                  <div className="mt-2 text-[11px] text-[#6A5A88] dark:text-[#CEC0E8]">
                                    <strong>Catatan:</strong> {ver.notes}
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rollback Confirmation ResponsiveModal */}
      <ResponsiveModal
        isOpen={Boolean(rollbackTarget)}
        onClose={() => {
          if (!isRollingBack) setRollbackTarget(null);
        }}
        title="Konfirmasi Rollback Konfigurasi"
        icon={<RotateCcw className="w-4 h-4" />}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setRollbackTarget(null)}
              disabled={isRollingBack}
              className="btn-3d-lilac px-4 py-2 min-h-[44px] sm:min-h-[40px] rounded-xl text-xs font-bold cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleConfirmRollback}
              disabled={isRollingBack}
              className="btn-3d-primary px-4 py-2 min-h-[44px] sm:min-h-[40px] text-white rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
            >
              {isRollingBack ? 'Memulihkan...' : 'Ya, Pulihkan Versi Ini'}
            </button>
          </>
        }
      >
        {rollbackTarget && (
          <div className="space-y-4 text-xs text-[#4A3B63] dark:text-[#D9CCF2]">
            <p className="leading-relaxed">
              Anda akan memulihkan konfigurasi global{' '}
              <strong className="font-mono text-[#1E1035] dark:text-white">{rollbackTarget.config_key}</strong> ke
              snapshot versi <strong className="font-mono">v{rollbackTarget.version}</strong>. Sistem akan membuat versi
              baru yang bersifat append-only dan menyiarkan pembaruan ke seluruh pengguna aktif.
            </p>
            <div className="space-y-1.5">
              <label className="font-bold text-[#1E1035] dark:text-white block">
                Catatan Rollback (Opsional):
              </label>
              <input
                type="text"
                value={rollbackNotes}
                onChange={e => setRollbackNotes(e.target.value)}
                placeholder="Contoh: Kembalikan ke layout sebelum revisi siang"
                className="tactile-debossed-input w-full px-3 py-2.5 min-h-[44px] rounded-xl text-[#1E1035] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#7135B5]"
              />
            </div>
          </div>
        )}
      </ResponsiveModal>
    </div>
  );
};
