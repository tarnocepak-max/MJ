import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { useUIConfig } from '../../context/UIConfigContext';
import {
  History,
  Search,
  Download,
  ShieldAlert,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Layers,
  AlertTriangle,
  CheckCircle2,
  X
} from 'lucide-react';
import { SortableColumnHeader } from '../common/SortableColumnHeader';
import { SortState, getNextSortDirection, sortDataArray } from '../../utils/tableSorting';
import {
  getConfigVersions,
  rollbackGlobalConfig,
  GlobalConfigVersionItem
} from '../../services/globalConfigService';

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

  const [activeSubTab, setActiveSubTab] = useState<'audit_trail' | 'config_versions'>('audit_trail');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntity, setSelectedEntity] = useState('ALL');
  const [sortState, setSortState] = useState<SortState>({ column: 'timestamp', direction: 'desc' });

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

  if (!canViewAuditLogs) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl p-8 border border-slate-200 dark:border-slate-800 text-center max-w-lg mx-auto space-y-4 shadow-sm my-8">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-bold text-slate-900 dark:text-white text-base">
          Akses Ditolak: Otoritas Audit Log Dibatasi
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Berdasarkan Konstitusi Keamanan MoraJaws, akses pembacaan jejak audit (Audit Log & History) dibatasi hanya untuk <strong>Super Admin</strong> dan <strong>IT Support (Read-Only)</strong>.
        </p>
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg text-xs text-slate-600 dark:text-slate-300 font-medium">
          Akun Anda: <span className="font-bold capitalize">{currentUser.name} ({currentUser.role})</span>. Akses ditolak pada level UI dan Backend Server.
        </div>
      </div>
    );
  }

  const handleExportCSV = () => {
    const headers = 'ID,Timestamp,Action,Entity,EntityID,PerformedBy,Role,Details\n';
    const rows = filteredLogs
      .map(l =>
        `"${l.id}","${l.timestamp}","${l.action}","${l.entity}","${l.entityId}","${l.performedBy}","${l.userRole}","${l.details.replace(/"/g, '""')}"`
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
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-[#5B35B1] text-white flex items-center justify-center shrink-0">
            <History className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              System Audit Trail & Global Config Version Control
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Catatan jejak audit operasional serta riwayat versi konfigurasi global dengan fitur rollback tervalidasi.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setActiveSubTab('audit_trail')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-colors cursor-pointer ${
                activeSubTab === 'audit_trail'
                  ? 'bg-[#5B35B1] text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              Audit Trail Log
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('config_versions')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                activeSubTab === 'config_versions'
                  ? 'bg-[#5B35B1] text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Riwayat Versi & Rollback Konfigurasi</span>
            </button>
          </div>

          {activeSubTab === 'audit_trail' && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 border border-slate-300 dark:border-slate-700 rounded flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {activeSubTab === 'audit_trail' ? (
        <>
          {/* Filter and Search Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search action, details, user..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-500 font-medium">Entity:</span>
              <select
                value={selectedEntity}
                onChange={e => setSelectedEntity(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
              >
                <option value="ALL">All Entities</option>
                <option value="global_config">Global Configurations</option>
                <option value="ticket">Ticket Work Orders</option>
                <option value="template">WhatsApp Templates</option>
                <option value="workflow">Workflows</option>
                <option value="ui_config">UI Configurations</option>
                <option value="import_batch">Import Batches</option>
                <option value="auth">Authentication & Roles</option>
              </select>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase">
                  <tr>
                    <th className="py-2.5 px-3">
                      <SortableColumnHeader
                        label="Timestamp"
                        columnKey="timestamp"
                        currentSortColumn={sortState.column}
                        currentDirection={sortState.direction}
                        dataType="date"
                        onSort={handleSort}
                      />
                    </th>
                    <th className="py-2.5 px-3">
                      <SortableColumnHeader
                        label="Action"
                        columnKey="action"
                        currentSortColumn={sortState.column}
                        currentDirection={sortState.direction}
                        dataType="text"
                        onSort={handleSort}
                      />
                    </th>
                    <th className="py-2.5 px-3">
                      <SortableColumnHeader
                        label="Entity"
                        columnKey="entity"
                        currentSortColumn={sortState.column}
                        currentDirection={sortState.direction}
                        dataType="text"
                        onSort={handleSort}
                      />
                    </th>
                    <th className="py-2.5 px-3">
                      <SortableColumnHeader
                        label="Details"
                        columnKey="details"
                        currentSortColumn={sortState.column}
                        currentDirection={sortState.direction}
                        dataType="text"
                        onSort={handleSort}
                      />
                    </th>
                    <th className="py-2.5 px-3">
                      <SortableColumnHeader
                        label="Performed By"
                        columnKey="performedBy"
                        currentSortColumn={sortState.column}
                        currentDirection={sortState.direction}
                        dataType="text"
                        onSort={handleSort}
                      />
                    </th>
                    <th className="py-2.5 px-3">
                      <SortableColumnHeader
                        label="Role"
                        columnKey="userRole"
                        currentSortColumn={sortState.column}
                        currentDirection={sortState.direction}
                        dataType="text"
                        onSort={handleSort}
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        Tidak ada catatan audit yang cocok.
                      </td>
                    </tr>
                  ) : (
                    sortedLogs.map(log => (
                      <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {log.action}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-slate-500 uppercase">
                          {log.entity}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 max-w-md break-words">
                          {log.details}
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {log.performedBy}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500 capitalize whitespace-nowrap">
                          {log.userRole.replace('_', ' ')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-600 dark:text-slate-300">Kunci Konfigurasi:</span>
              <select
                value={selectedConfigKey}
                onChange={e => setSelectedConfigKey(e.target.value)}
                className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
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
              className="px-3 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold flex items-center gap-1.5 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${versionsLoading ? 'animate-spin' : ''}`} />
              <span>Muat Ulang Versi</span>
            </button>
          </div>

          {versionsError && (
            <div className="p-3.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{versionsError}</span>
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300 uppercase">
                  <tr>
                    <th className="py-2.5 px-3 w-8"></th>
                    <th className="py-2.5 px-3">Waktu</th>
                    <th className="py-2.5 px-3">Kunci Konfigurasi</th>
                    <th className="py-2.5 px-3">Versi</th>
                    <th className="py-2.5 px-3">Aksi</th>
                    <th className="py-2.5 px-3">Diubah Oleh</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Pemulihan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {versionsLoading ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        Memuat riwayat versi konfigurasi dari database...
                      </td>
                    </tr>
                  ) : configVersions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
                        Belum ada snapshot riwayat versi untuk kunci ini.
                      </td>
                    </tr>
                  ) : (
                    configVersions.map(ver => {
                      const isExpanded = expandedVersionId === ver.id;
                      return (
                        <React.Fragment key={ver.id}>
                          <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-3">
                              <button
                                type="button"
                                onClick={() => setExpandedVersionId(isExpanded ? null : ver.id)}
                                className="p-1 text-slate-500 hover:text-slate-800 dark:hover:text-white cursor-pointer"
                                title="Lihat Snapshot JSON"
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                              {new Date(ver.created_at).toLocaleString('id-ID')}
                            </td>
                            <td className="py-2.5 px-3 font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                              {ver.config_key}
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums">
                              <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-800 font-bold">
                                v{ver.version}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-semibold whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${
                                ver.action === 'ROLLBACK'
                                  ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                              }`}>
                                {ver.action}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">
                              <span className="font-medium text-slate-800 dark:text-slate-200">{ver.changed_by_name || 'System'}</span>
                              {ver.changed_by_role && (
                                <span className="ml-1.5 text-[10px] font-mono text-slate-400">({ver.changed_by_role})</span>
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
                                  className="px-2.5 py-1 rounded bg-purple-50 hover:bg-purple-100 text-[#5B35B1] border border-purple-200 font-semibold text-[11px] inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Rollback ke Versi Ini</span>
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-400 font-mono">Read-Only</span>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-slate-50/70 dark:bg-slate-950/60">
                              <td colSpan={8} className="p-4">
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                  <div className="space-y-1.5">
                                    <div className="text-[11px] font-bold text-slate-500 uppercase">Previous Value</div>
                                    <pre className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono overflow-x-auto max-h-60 text-slate-700 dark:text-slate-300">
                                      {JSON.stringify(ver.previous_value, null, 2) || 'null'}
                                    </pre>
                                  </div>
                                  <div className="space-y-1.5">
                                    <div className="text-[11px] font-bold text-purple-600 uppercase">New Value (Snapshot v{ver.version})</div>
                                    <pre className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-900 text-[11px] font-mono overflow-x-auto max-h-60 text-slate-700 dark:text-slate-300">
                                      {JSON.stringify(ver.new_value, null, 2) || 'null'}
                                    </pre>
                                  </div>
                                </div>
                                {ver.notes && (
                                  <div className="mt-2 text-[11px] text-slate-500">
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
        </div>
      )}

      {/* Rollback Confirmation Modal */}
      {rollbackTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                <RotateCcw className="w-4 h-4 text-[#5B35B1]" />
                <span>Konfirmasi Rollback Konfigurasi</span>
              </div>
              <button
                type="button"
                onClick={() => setRollbackTarget(null)}
                disabled={isRollingBack}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs text-slate-600 dark:text-slate-300">
              <p>
                Anda akan memulihkan konfigurasi global <strong className="font-mono text-slate-900 dark:text-white">{rollbackTarget.config_key}</strong> ke snapshot versi <strong className="font-mono">v{rollbackTarget.version}</strong>. Sistem akan membuat versi baru yang bersifat append-only dan menyiarkan pembaruan ke seluruh pengguna aktif.
              </p>
              <div className="space-y-1">
                <label className="font-semibold text-slate-700 dark:text-slate-200">Catatan Rollback (Opsional):</label>
                <input
                  type="text"
                  value={rollbackNotes}
                  onChange={e => setRollbackNotes(e.target.value)}
                  placeholder="Contoh: Kembalikan ke layout sebelum revisi siang"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRollbackTarget(null)}
                disabled={isRollingBack}
                className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmRollback}
                disabled={isRollingBack}
                className="px-4 py-2 rounded-lg bg-[#5B35B1] hover:bg-[#492894] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isRollingBack ? 'Memulihkan...' : 'Ya, Pulihkan Versi Ini'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
