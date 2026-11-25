import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { Ticket, User, Contractor, CoverageArea, ImportHistoryRecord } from '../../types/index.ts';
import { parseAppointmentDate } from '../../services/appointmentDateParser';
import { DuplicateAuditReport } from '../../services/woDeduplicationService';
import { listImportHistory, downloadImportErrorsCsv } from '../../services/enterpriseImportService';
import {
  Database,
  Server,
  Layers,
  Search,
  Filter,
  AlertTriangle,
  CheckCircle2,
  Clock,
  History,
  Archive,
  Copy,
  Trash2,
  RefreshCw,
  RotateCcw,
  FileSpreadsheet,
  ShieldCheck,
  ShieldAlert,
  ArrowRight,
  Eye,
  Check,
  Edit,
  Building2,
  UserCheck,
  Wrench,
  Sparkles,
  Calendar,
  AlertCircle,
  Download
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { StatusAgentBadge, StatusInstallerBadge } from '../common/Badge';
import { downloadProductionBackup } from '../../services/backupDownloadService';
import { supabaseDb } from '../../services/supabaseDb';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';
import { ResponsiveModal } from '../common/ResponsiveModal';

export type DatabaseSubmenu =
  | 'overview'
  | 'wo_database'
  | 'import_history'
  | 'duplicate_checker'
  | 'data_validation'
  | 'data_archive'
  | 'deleted_wos'
  | 'audit_log';

export const DatabaseManagementView: React.FC = () => {
  const {
    tickets,
    users,
    contractors,
    coverageAreas,
    auditLogs,
    currentUser,
    archiveTicket,
    restoreTicket,
    deleteTicket,
    updateTicket,
    executeComprehensiveDeduplication
  } = useApp();
  const { toast } = useToast();

  const [activeSubmenu, setActiveSubmenu] = useState<DatabaseSubmenu>('overview');
  const [searchWo, setSearchWo] = useState('');
  const [selectedContractor, setSelectedContractor] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedAppointmentDate, setSelectedAppointmentDate] = useState('');
  const [editingTicket, setEditingTicket] = useState<Ticket | null>(null);
  const [editForm, setEditForm] = useState<Partial<Ticket>>({});
  const [auditReport, setAuditReport] = useState<DuplicateAuditReport | null>(null);
  const [isDeduplicating, setIsDeduplicating] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [woPage, setWoPage] = useState(1);
  const [woPageSize, setWoPageSize] = useState<number | 'ALL'>(25);
  const [dbImportHistory, setDbImportHistory] = useState<ImportHistoryRecord[]>([]);
  const [deletedWos, setDeletedWos] = useState<Ticket[]>([]);
  const [deletedSearch, setDeletedSearch] = useState('');
  const [isLoadingDeleted, setIsLoadingDeleted] = useState(false);
  const [deletedError, setDeletedError] = useState<string | null>(null);
  const [restoringDeletedId, setRestoringDeletedId] = useState<string | null>(null);

  const loadDeletedWorkOrders = async (searchTerm = deletedSearch) => {
    if (currentUser.role !== 'super_admin') return;
    setIsLoadingDeleted(true);
    setDeletedError(null);
    try {
      const res = await supabaseDb.getDeletedWorkOrders({ search: searchTerm.trim() || undefined, limit: 200 });
      if (res.success && Array.isArray(res.data)) {
        setDeletedWos(res.data);
      } else {
        setDeletedError(res.error?.message || 'Gagal memuat daftar WO terhapus.');
      }
    } catch (err: any) {
      setDeletedError(err?.message || 'Gagal menghubungi server.');
    } finally {
      setIsLoadingDeleted(false);
    }
  };

  useEffect(() => {
    if (activeSubmenu !== 'import_history') return;
    if (currentUser.role !== 'super_admin' && currentUser.role !== 'dispatch') return;
    listImportHistory(50)
      .then(records => setDbImportHistory(records))
      .catch(() => {});
  }, [activeSubmenu, currentUser.role]);

  useEffect(() => {
    if (activeSubmenu !== 'deleted_wos') return;
    if (currentUser.role !== 'super_admin') {
      setActiveSubmenu('overview');
      return;
    }
    void loadDeletedWorkOrders(deletedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubmenu, currentUser.role]);

  const handleDownloadBackup = async () => {
    setIsDownloadingBackup(true);
    try {
      const res = await downloadProductionBackup();
      if (res.success) {
        toast.success(`Backup database (${res.size?.toLocaleString()} bytes) berhasil diverifikasi dan diunduh.`);
      } else {
        toast.error(res.error || 'Gagal mengunduh file backup database');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Terjadi kesalahan saat mengunduh backup');
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  // Master active records MUST always exclude soft-deleted WOs
  const nonDeletedTickets = useMemo(() => tickets.filter(t => !t.isDeleted), [tickets]);

  // 1. Overview Calculations
  const totalWOs = nonDeletedTickets.length;
  const activeWOs = nonDeletedTickets.filter(t => !t.isArchived && t.statusWOAgent !== 'Closed' && t.statusWOInstaller !== 'Completed').length;
  const completedWOs = nonDeletedTickets.filter(t => t.statusWOInstaller === 'Completed' || t.statusWOAgent === 'Resolved' || t.statusWOAgent === 'Closed').length;
  const archivedWOs = nonDeletedTickets.filter(t => t.isArchived).length;
  const totalStaff = users.filter(u => !u.isArchived).length;
  const totalInstallers = users.filter(u => u.role === 'installer' && u.active && !u.isArchived).length;
  const totalLeaders = users.filter(u => u.role === 'leader' && u.active && !u.isArchived).length;
  const totalContractors = contractors.length;

  // Duplicate WO Detection (active non-deleted records only)
  const duplicatesMap = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    nonDeletedTickets.forEach(t => {
      const key = (t.woNumber || '').trim().toUpperCase();
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    });
    return map;
  }, [nonDeletedTickets]);

  const duplicateGroups = useMemo(() => {
    return Array.from(duplicatesMap.entries()).filter(([_, list]) => list.length > 1);
  }, [duplicatesMap]);

  // Data Validation issues
  const validationIssues = useMemo(() => {
    const issues: {
      id: string;
      ticket: Ticket;
      type: 'missing_wo' | 'invalid_date' | 'missing_date' | 'missing_customer_id' | 'broken_installer' | 'broken_contractor' | 'inconsistent_status';
      message: string;
      field: string;
      recommendation: string;
    }[] = [];

    nonDeletedTickets.forEach(t => {
      if (!t.woNumber || !t.woNumber.trim()) {
        issues.push({
          id: `iss-wo-${t.id}`,
          ticket: t,
          type: 'missing_wo',
          message: 'Nomor Work Order kosong',
          field: 'woNumber',
          recommendation: 'Lengkapi nomor WO unik resmi'
        });
      }
      if (!t.appointmentDate || !t.appointmentDate.trim()) {
        issues.push({
          id: `iss-app-${t.id}`,
          ticket: t,
          type: 'missing_date',
          message: 'Jadwal Appointment Date belum terisi',
          field: 'appointmentDate',
          recommendation: 'Tetapkan tanggal jadwal kunjungan appointment'
        });
      } else if (isNaN(new Date(t.appointmentDate).getTime())) {
        issues.push({
          id: `iss-invdate-${t.id}`,
          ticket: t,
          type: 'invalid_date',
          message: `Format Appointment Date tidak valid: "${t.appointmentDate}"`,
          field: 'appointmentDate',
          recommendation: 'Format tanggal sesuai standar YYYY-MM-DD'
        });
      }
      if (!t.idCustomer && !t.customerId) {
        issues.push({
          id: `iss-cid-${t.id}`,
          ticket: t,
          type: 'missing_customer_id',
          message: 'Customer ID belum terisi',
          field: 'idCustomer',
          recommendation: 'Isi 7-digit ID Customer resmi pelanggan'
        });
      }
      if (t.installerName) {
        const instTarget = String(t.installerName).toLowerCase().trim();
        const found = users.some(u => u.role === 'installer' && String(u.name || '').toLowerCase().includes(instTarget));
        if (!found) {
          issues.push({
            id: `iss-inst-${t.id}`,
            ticket: t,
            type: 'broken_installer',
            message: `Teknisi "${t.installerName}" tidak terdaftar di database staff aktif`,
            field: 'installerName',
            recommendation: 'Pilih teknisi yang terdaftar dalam kontraktor'
          });
        }
      }
    });

    return issues;
  }, [nonDeletedTickets, users]);

  // Filtered Master WO Database (never includes soft-deleted WOs)
  const filteredWODatabase = useMemo(() => {
    return nonDeletedTickets.filter(t => {
      if (searchWo.trim()) {
        const query = searchWo.toLowerCase().trim();
        const matchWo = String(t.woNumber || '').toLowerCase().includes(query);
        const matchCust = String(t.customerName || '').toLowerCase().includes(query);
        const matchCid = String(t.idCustomer || t.customerId || '').toLowerCase().includes(query);
        if (!matchWo && !matchCust && !matchCid) return false;
      }
      if (selectedContractor !== 'all') {
        const cName = String(t.contactorName || t.contractorName || '').toLowerCase();
        if (!cName.includes(selectedContractor.toLowerCase())) return false;
      }
      if (selectedStatus !== 'all') {
        if (t.statusWOInstaller !== selectedStatus && t.statusWOAgent !== selectedStatus) return false;
      }
      if (selectedAppointmentDate) {
        const raw = t.appointmentDate || '';
        const parsed = parseAppointmentDate(raw);
        const ticketDate = parsed.date || (raw.length >= 10 ? raw.slice(0, 10) : raw.trim());
        if (ticketDate !== selectedAppointmentDate && !ticketDate.startsWith(selectedAppointmentDate)) return false;
      }
      return true;
    });
  }, [nonDeletedTickets, searchWo, selectedContractor, selectedStatus, selectedAppointmentDate]);

  // Import history from auditLogs
  const importHistoryLogs = useMemo(() => {
    return auditLogs.filter(l => l.entity === 'import_batch' || String(l.action || '').toLowerCase().includes('import'));
  }, [auditLogs]);

  // Handlers for Data Edit
  const handleOpenEdit = (ticket: Ticket) => {
    setEditingTicket(ticket);
    setEditForm({
      customerName: ticket.customerName,
      customerPhone: ticket.customerPhone,
      appointmentDate: ticket.appointmentDate || '',
      slotTime: ticket.slotTime,
      contactorName: ticket.contactorName || ticket.contractorName,
      area: ticket.area,
      clusterName: ticket.clusterName,
      installerName: ticket.installerName
    });
  };

  const handleSaveEdit = () => {
    if (!editingTicket) return;
    const res = updateTicket(editingTicket.id, editForm, 'Pembaruan data via Database Management');
    if (res.success) {
      toast.success(`Tiket ${editingTicket.woNumber} berhasil diperbarui di database.`, 'Perubahan Tersimpan');
      setEditingTicket(null);
    } else {
      toast.error(res.error || 'Gagal memperbarui tiket.', 'Kesalahan');
    }
  };

  // Reconcile duplicate WOs (Superadmin Exclusive - Strict RBAC, awaited soft delete)
  const handleReconcileKeepFirst = async (woKey: string) => {
    if (currentUser.role !== 'super_admin') {
      toast.error('Akses Ditolak: Hanya Superadmin yang memiliki wewenang merekonsiliasi/menghapus duplikasi Work Order.', 'Akses Ditolak');
      return;
    }
    const list = duplicatesMap.get(woKey) || [];
    if (list.length <= 1) return;
    const [keep, ...removeList] = list;
    const results = await Promise.all(
      removeList.map(item =>
        deleteTicket(
          item.id,
          `Rekonsiliasi duplikasi WO ${woKey}. Menggabungkan ke ID ${keep.id}`,
          false,
          { silentToast: true }
        )
      )
    );
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
      toast.error(
        failed[0]?.error || `Gagal merekonsiliasi ${failed.length} duplikat WO ${woKey}.`,
        'Rekonsiliasi Gagal'
      );
      return;
    }
    toast.success(`Berhasil merekonsiliasi WO ${woKey}. 1 record utama dipertahankan.`, 'Rekonsiliasi Sukses');
  };

  // Comprehensive automated deduplication across Supabase PostgreSQL
  const handleRunComprehensiveDeduplication = async () => {
    if (currentUser.role !== 'super_admin') {
      toast.error('Akses Ditolak: Hanya role Superadmin yang berwenang mengeksekusi pembersihan dan penghapusan duplikasi Work Order.', 'Akses Ditolak');
      return;
    }
    setIsDeduplicating(true);
    try {
      const report = await executeComprehensiveDeduplication();
      setAuditReport(report);
      if (report.totalDuplicatesCleaned > 0) {
        toast.success(
          `BERHASIL: Pembersihan otomatis selesai. ${report.totalDuplicatesCleaned} dokumen duplikat berhasil direkonsiliasi dan dibersihkan dari Supabase PostgreSQL.`,
          'Pembersihan Selesai'
        );
      } else {
        toast.info(
          `Audit selesai: Seluruh ${report.totalValid} dokumen WO valid dan tidak ditemukan duplikasi data.`,
          'Database Bersih'
        );
      }
    } catch (err: any) {
      toast.error(err?.message || 'Gagal menjalankan pembersihan otomatis.', 'Gagal Proses');
    } finally {
      setIsDeduplicating(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-[#EAE8FF] via-[#F4F7FB] to-[#DDF4F4] border border-[#C5BEEF] text-[#26364A] shadow-lg dark:from-[#160D29] dark:via-[#27104A] dark:to-[#1A0D36] dark:border-[#4A2580] dark:text-white dark:shadow-[0_14px_32px_-8px_rgba(22,13,41,0.55)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#DDF4F4] border border-[#BDE4E8] text-[#2E7D8B] dark:bg-gradient-to-b dark:from-[#6b103b] dark:to-[#480123] dark:border-[#FBCFE8]/25 dark:text-white text-[10.5px] font-extrabold uppercase tracking-wider mb-2 shadow-xs">
            <Server className="w-3.5 h-3.5 text-[#2E7D8B] dark:text-[#FBCFE8]" />
            <span>Pusat Kontrol Database &amp; Data Integrity</span>
          </div>
          <h1 className="text-2xl font-display font-black tracking-tight text-[#26364A] dark:text-white">Database Management</h1>
          <p className="text-xs text-[#52647A] dark:text-[#D9CCF2] mt-1 max-w-xl leading-relaxed">
            Pengelolaan terpusat seluruh master data Work Order, pemeriksaan integritas data, anti-duplikasi, riwayat impor, dan arsip data aplikasi MoraJaws.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto">
          {currentUser.role === 'super_admin' && (
            <button
              type="button"
              onClick={handleDownloadBackup}
              disabled={isDownloadingBackup}
              className="btn-3d-emerald px-4 py-2 text-white font-bold text-xs rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
              title="Unduh arsip cadangan produksi historis (JSON)"
            >
              {isDownloadingBackup ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Mengunduh Backup...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-white" />
                  <span>Download Backup Database</span>
                </>
              )}
            </button>
          )}

          <span className="px-3 py-1.5 rounded-xl bg-white/90 border border-[#C5BEEF] text-[#5145A6] dark:bg-[#35105E] dark:border-[#7135B5]/60 dark:text-[#E8DDFF] text-xs font-bold flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
            <span className="capitalize">Role: {currentUser.role.replace('_', ' ')}</span>
          </span>
        </div>
      </div>

      {/* Submenu Navigation Tabs */}
      <div className="mj-tactile-tab-bar p-1.5 rounded-2xl flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {[
          { id: 'overview', label: 'Database Overview', icon: Database, badge: undefined },
          { id: 'wo_database', label: 'WO Master Database', icon: Layers, badge: totalWOs },
          { id: 'import_history', label: 'Import History', icon: History, badge: importHistoryLogs.length },
          { id: 'duplicate_checker', label: 'Duplicate Checker', icon: Copy, badge: duplicateGroups.length, badgeColor: 'rose' },
          { id: 'data_validation', label: 'Data Validation', icon: AlertTriangle, badge: validationIssues.length, badgeColor: 'amber' },
          { id: 'data_archive', label: 'Data Archive', icon: Archive, badge: archivedWOs },
          ...(currentUser.role === 'super_admin'
            ? [{ id: 'deleted_wos', label: 'WO Terhapus (Restore)', icon: RotateCcw, badge: deletedWos.length > 0 ? deletedWos.length : undefined, badgeColor: 'rose' }]
            : []),
          { id: 'audit_log', label: 'Database Audit Log', icon: ShieldCheck, badge: undefined }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeSubmenu === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubmenu(tab.id as DatabaseSubmenu)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 transition-all cursor-pointer ${
                isActive
                  ? 'btn-3d-primary text-white'
                  : 'text-[#52647A] dark:text-[#CEC0E8] hover:text-[#26364A] dark:hover:text-white hover:bg-[#EDF3F8] dark:hover:bg-[#2A174B]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-mono tabular-nums font-extrabold ${
                  isActive
                    ? 'bg-white/20 text-white'
                    : tab.badgeColor === 'rose'
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                    : tab.badgeColor === 'amber'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    : 'bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#E8DDFF]'
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* SUBMENU 1: OVERVIEW */}
      {activeSubmenu === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3.5">
            <div className="card-3d-lavender p-4 rounded-2xl">
              <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] font-bold uppercase">Total Record WO</div>
              <div className="text-2xl font-black font-mono tabular-nums text-[#26364A] dark:text-white mt-1">{totalWOs}</div>
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] mt-0.5">Master record di database</div>
            </div>

            <div className="card-3d-lavender p-4 rounded-2xl">
              <div className="text-[11px] text-[#5145A6] dark:text-[#D8B4FE] font-bold uppercase">WO Aktif</div>
              <div className="text-2xl font-black font-mono tabular-nums text-[#5145A6] dark:text-[#E8DDFF] mt-1">{activeWOs}</div>
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] mt-0.5">Dalam proses / antrean</div>
            </div>

            <div className="card-3d-lavender p-4 rounded-2xl">
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold uppercase">WO Selesai</div>
              <div className="text-2xl font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">{completedWOs}</div>
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] mt-0.5">Installed &amp; Resolved</div>
            </div>

            <div className="card-3d-lavender p-4 rounded-2xl">
              <div className="text-[11px] text-amber-600 dark:text-amber-400 font-bold uppercase">Perlu Pemeriksaan</div>
              <div className="text-2xl font-black font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">{validationIssues.length}</div>
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] mt-0.5">Jadwal/Field tidak lengkap</div>
            </div>

            <div className="card-3d-lavender p-4 rounded-2xl">
              <div className="text-[11px] text-rose-600 dark:text-rose-400 font-bold uppercase">Duplikasi Terdeteksi</div>
              <div className="text-2xl font-black font-mono tabular-nums text-rose-600 dark:text-rose-400 mt-1">{duplicateGroups.length}</div>
              <div className="text-[10px] text-[#8492A5] dark:text-[#A78BFA] mt-0.5">Grup nomor WO ganda</div>
            </div>
          </div>

          {/* Quick Staff & Infrastructure Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card-3d-lavender p-5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">Akun Staff Terdaftar</span>
                <span className="text-xs font-bold font-mono tabular-nums text-[#5145A6] dark:text-[#D8B4FE]">{totalStaff} Akun</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                  <span className="flex items-center gap-1.5 text-[#26364A] dark:text-[#E8DDFF]"><Wrench className="w-3.5 h-3.5 text-emerald-500" /> Teknisi Aktif</span>
                  <span className="font-bold font-mono tabular-nums text-[#26364A] dark:text-white">{totalInstallers}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                  <span className="flex items-center gap-1.5 text-[#26364A] dark:text-[#E8DDFF]"><Building2 className="w-3.5 h-3.5 text-amber-500" /> Leader Mitra</span>
                  <span className="font-bold font-mono tabular-nums text-[#26364A] dark:text-white">{totalLeaders}</span>
                </div>
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                  <span className="flex items-center gap-1.5 text-[#26364A] dark:text-[#E8DDFF]"><ShieldCheck className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#7135B5]" /> Super Admin &amp; Dispatch</span>
                  <span className="font-bold font-mono tabular-nums text-[#26364A] dark:text-white">{totalStaff - totalInstallers - totalLeaders}</span>
                </div>
              </div>
            </div>

            <div className="card-3d-lavender p-5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">Kontraktor &amp; Wilayah</span>
                <span className="text-xs font-bold font-mono tabular-nums text-[#5145A6] dark:text-[#D8B4FE]">{totalContractors} Mitra</span>
              </div>
              <div className="space-y-2 text-xs">
                {contractors.slice(0, 3).map(c => (
                  <div key={c.id} className="p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E] flex items-center justify-between">
                    <span className="font-semibold text-[#26364A] dark:text-white truncate max-w-[180px]">{c.name}</span>
                    <span className="font-mono text-[10px] text-[#52647A] dark:text-[#A78BFA]">{c.code}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card-3d-lavender p-5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider text-[#52647A] dark:text-[#CEC0E8]">Status Integritas Data</span>
                <span className={`text-xs font-bold ${duplicateGroups.length === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {duplicateGroups.length === 0 ? 'Optimal' : 'Perlu Tindakan'}
                </span>
              </div>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                {duplicateGroups.length === 0
                  ? 'Tidak ada duplikasi nomor WO terdeteksi dalam database. Sistem anti-duplikasi aktif menjaga 1 record per WO Number.'
                  : `Ditemukan ${duplicateGroups.length} grup nomor WO yang terduplikasi. Buka tab "Duplicate Checker" untuk rekonsiliasi.`}
              </p>
              <button
                onClick={() => setActiveSubmenu('duplicate_checker')}
                className="btn-3d-lilac w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Periksa Duplikasi Sekarang</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SUBMENU 2: WO MASTER DATABASE */}
      {activeSubmenu === 'wo_database' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="card-3d-lavender p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-[#8492A5] dark:text-[#766B83] shrink-0" />
              <input
                type="text"
                value={searchWo}
                onChange={e => setSearchWo(e.target.value)}
                placeholder="Cari WO Number, Customer ID, Nama Pelanggan..."
                className="tactile-debossed-input w-full px-3 py-2 rounded-xl text-[#26364A] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#6657C8] dark:focus:ring-[#7135B5]"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={selectedContractor}
                onChange={e => setSelectedContractor(e.target.value)}
                className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26364A] dark:text-white font-semibold"
              >
                <option value="all">Semua Kontraktor</option>
                {contractors.map((c, cIdx) => (
                  <option key={`db-contractor-${c.id || c.name}-${cIdx}`} value={c.name}>{c.name}</option>
                ))}
              </select>

              <select
                value={selectedStatus}
                onChange={e => setSelectedStatus(e.target.value)}
                className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26364A] dark:text-white font-semibold"
              >
                <option value="all">Semua Status</option>
                <option value="Unassigned">Unassigned</option>
                <option value="Assigned">Assigned</option>
                <option value="En Route">En Route</option>
                <option value="On Site">On Site</option>
                <option value="Completed">Completed</option>
                <option value="Pending Technical">Pending Technical</option>
                <option value="Failed / Cancelled">Failed / Cancelled</option>
              </select>

              <input
                type="date"
                value={selectedAppointmentDate}
                onChange={e => setSelectedAppointmentDate(e.target.value)}
                className="tactile-debossed-input px-3 py-2 rounded-xl text-[#26364A] dark:text-white font-semibold"
                title="Filter Appointment Date"
              />

              {(searchWo || selectedContractor !== 'all' || selectedStatus !== 'all' || selectedAppointmentDate) && (
                <button
                  onClick={() => {
                    setSearchWo('');
                    setSelectedContractor('all');
                    setSelectedStatus('all');
                    setSelectedAppointmentDate('');
                  }}
                  className="btn-3d-lilac px-3 py-2 rounded-xl font-bold cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          {(() => {
            const effectivePageSize = woPageSize === 'ALL' ? Math.max(1, filteredWODatabase.length) : woPageSize;
            const totalWoPages = Math.max(1, Math.ceil(filteredWODatabase.length / effectivePageSize));
            const safeWoPage = Math.min(woPage, totalWoPages);
            const pagedWOs =
              woPageSize === 'ALL'
                ? filteredWODatabase
                : filteredWODatabase.slice((safeWoPage - 1) * effectivePageSize, safeWoPage * effectivePageSize);

            const woColumns: ResponsiveColumn<Ticket>[] = [
              {
                key: 'woNumber',
                label: 'WO Number',
                priority: 'hidden_mobile',
                render: ticket => (
                  <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">
                    {ticket.woNumber}
                  </span>
                )
              },
              {
                key: 'appointmentDate',
                label: 'Appointment Date',
                priority: 'primary',
                render: ticket => (
                  <div>
                    <span className="font-semibold font-mono tabular-nums text-[#26364A] dark:text-white">
                      {ticket.appointmentDate || <span className="text-rose-500 italic">Belum diset</span>}
                    </span>
                    <span className="block text-[10.5px] text-[#52647A] dark:text-[#A78BFA]">{ticket.slotTime || '-'}</span>
                  </div>
                )
              },
              {
                key: 'customer',
                label: 'Customer ID & Nama',
                priority: 'hidden_mobile',
                render: ticket => (
                  <div>
                    <div className="font-bold text-[#26364A] dark:text-white">{ticket.customerName}</div>
                    <div className="font-mono text-[10.5px] text-[#52647A] dark:text-[#A78BFA]">
                      ID: {ticket.idCustomer || ticket.customerId || '-'}
                    </div>
                  </div>
                )
              },
              {
                key: 'areaContractor',
                label: 'Area & Kontraktor',
                priority: 'secondary',
                render: ticket => (
                  <div>
                    <div className="font-semibold text-[#26364A] dark:text-white">{ticket.area || '-'}</div>
                    <div className="text-[10.5px] text-[#52647A] dark:text-[#A78BFA] truncate max-w-[160px]">
                      {ticket.contactorName || ticket.contractorName || '-'}
                    </div>
                  </div>
                )
              },
              {
                key: 'installer',
                label: 'Teknisi (Installer)',
                priority: 'primary',
                render: ticket =>
                  ticket.installerName ? (
                    <span className="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{ticket.installerName}</span>
                    </span>
                  ) : (
                    <span className="text-[#8492A5] dark:text-[#766B83] italic">Belum di-assign</span>
                  )
              },
              {
                key: 'status',
                label: 'Status',
                priority: 'hidden_mobile',
                render: ticket => <StatusInstallerBadge status={ticket.statusWOInstaller} />
              }
            ];

            return (
              <ResponsiveDataTable<Ticket>
                data={pagedWOs}
                columns={woColumns}
                getRowKey={t => t.id}
                emptyState={{
                  title: 'Tidak ada record WO ditemukan',
                  description: 'Tidak ada record WO yang sesuai dengan filter pencarian.'
                }}
                mobileTitle={t => (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">{t.woNumber}</span>
                    <span className="text-[#26364A] dark:text-white font-bold">· {t.customerName}</span>
                  </div>
                )}
                mobileSubtitle={t => `Customer ID: ${t.idCustomer || t.customerId || '-'}`}
                mobileStatus={t => <StatusInstallerBadge status={t.statusWOInstaller} />}
                desktopActionHeader="Aksi Database"
                getRowActions={t => [
                  {
                    id: 'edit',
                    label: 'Koreksi Data Record',
                    icon: <Edit className="w-3.5 h-3.5" />,
                    onClick: () => handleOpenEdit(t)
                  },
                  t.isArchived
                    ? {
                        id: 'restore',
                        label: 'Pulihkan dari Arsip',
                        icon: <RefreshCw className="w-3.5 h-3.5" />,
                        onClick: () => restoreTicket(t.id)
                      }
                    : {
                        id: 'archive',
                        label: 'Arsipkan Record WO',
                        icon: <Archive className="w-3.5 h-3.5" />,
                        onClick: () => archiveTicket(t.id),
                        variant: 'danger' as const
                      }
                ]}
                renderDesktopActions={ticket => (
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(ticket)}
                      className="btn-3d-lilac p-1.5 rounded-lg cursor-pointer"
                      title="Koreksi Data Record"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    {ticket.isArchived ? (
                      <button
                        type="button"
                        onClick={() => restoreTicket(ticket.id)}
                        className="btn-3d-emerald px-2.5 py-1 rounded-lg text-white font-bold text-[10px] cursor-pointer"
                        title="Pulihkan dari Arsip"
                      >
                        Pulihkan
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => archiveTicket(ticket.id)}
                        className="btn-3d-amber p-1.5 rounded-lg text-white cursor-pointer"
                        title="Arsipkan Record WO"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
                pagination={
                  filteredWODatabase.length > 0
                    ? {
                        currentPage: safeWoPage,
                        totalPages: totalWoPages,
                        totalItems: filteredWODatabase.length,
                        pageSize: woPageSize,
                        onPageChange: setWoPage,
                        onPageSizeChange: size => {
                          setWoPageSize(size);
                          setWoPage(1);
                        },
                        itemLabel: 'WO'
                      }
                    : undefined
                }
              />
            );
          })()}
        </div>
      )}

      {/* SUBMENU 3: IMPORT HISTORY */}
      {activeSubmenu === 'import_history' && (
        <div className="space-y-4">
          <div className="card-3d-lavender p-5 rounded-2xl space-y-4">
            <div>
              <h3 className="font-bold text-sm text-[#26364A] dark:text-white mb-1">
                Riwayat Impor &amp; Batch Audit
              </h3>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8]">
                Daftar seluruh proses impor berkas WO (Asynchronous Batch Jobs &amp; Audit Log) yang dieksekusi oleh Super Admin dan Dispatch.
              </p>
            </div>

            {dbImportHistory.length > 0 && (
              <div className="space-y-2.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#5145A6] dark:text-[#DAB9FF]">
                  Riwayat Job Import Database ({dbImportHistory.length})
                </div>
                {dbImportHistory.map(hist => (
                  <div
                    key={hist.id}
                    className="p-3.5 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F4F7FB] dark:bg-[#160D29] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-[#26364A] dark:text-white flex items-center gap-2 flex-wrap">
                        <FileSpreadsheet className="w-4 h-4 text-[#2E7D8B] dark:text-emerald-400 shrink-0" />
                        <span className="truncate">{hist.sourceFile || hist.importName || hist.jobId}</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] dark:bg-[#35105E] text-[#5145A6] dark:text-[#DAB9FF]">
                          {hist.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[#52647A] dark:text-[#D9CCF2] mt-1">
                        Total: {hist.totalRows} • Sukses: <strong className="text-[#2E7D8B] dark:text-emerald-300">{hist.successCount}</strong> • Duplikat: {hist.duplicateCount} • Gagal: <strong className="text-[#BA1A1A] dark:text-rose-300">{hist.failedCount}</strong>
                        {hist.durationMs ? ` • ${(hist.durationMs / 1000).toFixed(1)}s` : ''}
                      </div>
                      <div className="text-[10.5px] text-[#8492A5] dark:text-[#A78BFA] mt-1">
                        Oleh: <strong>{hist.importedBy}</strong> • {new Date(hist.createdAt).toLocaleString('id-ID')}
                      </div>
                    </div>

                    {(hist.failedCount > 0 || hist.duplicateCount > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          void downloadImportErrorsCsv(hist.jobId).catch(err => {
                            toast.error(err?.message || 'Gagal mengunduh error CSV.');
                          });
                        }}
                        className="btn-3d-lilac px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Error CSV</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-3">
              {importHistoryLogs.length === 0 && dbImportHistory.length === 0 ? (
                <div className="p-8 text-center text-[#52647A] dark:text-[#CEC0E8] text-xs">
                  Belum ada log histori impor WO yang tercatat di sistem.
                </div>
              ) : (
                importHistoryLogs.map(log => (
                  <div key={log.id} className="p-3.5 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F4F7FB] dark:bg-[#160D29] flex items-start justify-between gap-3 text-xs">
                    <div>
                      <div className="font-bold text-[#26364A] dark:text-white flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                        <span>{log.action}</span>
                      </div>
                      <p className="text-[#52647A] dark:text-[#D9CCF2] mt-1">{log.details}</p>
                      <div className="text-[10.5px] text-[#8492A5] dark:text-[#A78BFA] mt-1.5 flex items-center gap-2">
                        <span>Oleh: <strong>{log.performedBy}</strong> ({log.userRole})</span>
                        <span>·</span>
                        <span>{new Date(log.timestamp).toLocaleString('id-ID')}</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUBMENU 4: DUPLICATE CHECKER & AUTOMATED CLEANUP */}
      {activeSubmenu === 'duplicate_checker' && (
        <div className="space-y-5">
          {/* Action Banner: Automated Initialization & Deduplication */}
          <div className="card-3d-lavender p-5 sm:p-6 rounded-2xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="p-3 bg-gradient-to-br from-[#6657C8] to-[#5145A6] dark:from-[#5B289B] dark:to-[#35105E] text-white rounded-2xl shadow-md dark:shadow-[0_6px_14px_rgba(53,16,94,0.28)] shrink-0">
                  <Sparkles className="w-5 h-5 text-white dark:text-[#E8DDFF]" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-[#26364A] dark:text-white">
                    Initialisasi &amp; Pembersihan Otomatis Data Ganda (Duplicate Cleanup)
                  </h3>
                  <p className="text-xs text-[#52647A] dark:text-[#D9CCF2] mt-1 max-w-2xl leading-relaxed">
                    Sistem otomatis mengaudit seluruh dokumen WO di Supabase PostgreSQL, mendeteksi duplikasi berdasarkan nomor WO dan kombinasi pelanggan, lalu memilih <strong>1 Master Record</strong> terbaik (status paling maju, teknisi terisi, laporan terisi, pembaruan terbaru), menggabungkan data pelengkap, dan menghapus dokumen ganda yang berlebih.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleRunComprehensiveDeduplication}
                disabled={isDeduplicating}
                className="btn-3d-primary px-5 py-3 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer flex items-center justify-center gap-2 shrink-0"
              >
                {isDeduplicating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Mengaudit &amp; Membersihkan...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Jalankan Pembersihan Otomatis</span>
                  </>
                )}
              </button>
            </div>

            {/* Audit & Cleanup Report Summary (7 Metrics) */}
            {auditReport && (
              <div className="pt-4 border-t border-[#DDE6F0] dark:border-[#35105E] space-y-3 animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-[#5145A6] dark:text-[#E8DDFF] uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span>Ringkasan Hasil Audit &amp; Pembersihan Database</span>
                  </h4>
                  <span className="text-[11px] text-[#52647A] dark:text-[#A78BFA] font-mono">
                    Audit terakhir: baru saja
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5 text-xs">
                  <div className="p-3 bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
                    <span className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8] block truncate">1. Dokumen Diperiksa</span>
                    <span className="text-lg font-black font-mono tabular-nums text-[#26364A] dark:text-white mt-1 block">
                      {auditReport.totalInspected}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl border border-emerald-200 dark:border-emerald-800">
                    <span className="text-[10.5px] text-emerald-600 dark:text-emerald-400 font-medium block truncate">2. Data Valid</span>
                    <span className="text-lg font-black font-mono tabular-nums text-emerald-700 dark:text-emerald-300 mt-1 block">
                      {auditReport.totalValid}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl border border-amber-200 dark:border-amber-800">
                    <span className="text-[10.5px] text-amber-600 dark:text-amber-400 font-medium block truncate">3. Duplikasi Ditemukan</span>
                    <span className="text-lg font-black font-mono tabular-nums text-amber-700 dark:text-amber-300 mt-1 block">
                      {auditReport.totalDuplicatesDetected}
                    </span>
                  </div>

                  <div className="p-3 bg-[#EAE8FF] dark:bg-[#160D29] rounded-xl border border-[#C5BEEF] dark:border-[#5B289B]">
                    <span className="text-[10.5px] text-[#5145A6] dark:text-[#D8B4FE] font-medium block truncate">4. Berhasil Dibersihkan</span>
                    <span className="text-lg font-black font-mono tabular-nums text-[#5145A6] dark:text-[#E8DDFF] mt-1 block">
                      {auditReport.totalDuplicatesCleaned}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl border border-rose-200 dark:border-rose-800">
                    <span className="text-[10.5px] text-rose-600 dark:text-rose-400 font-medium block truncate">5. Data Konflik</span>
                    <span className="text-lg font-black font-mono tabular-nums text-rose-700 dark:text-rose-300 mt-1 block">
                      {auditReport.totalConflicts}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl border border-amber-200 dark:border-amber-800">
                    <span className="text-[10.5px] text-amber-700 dark:text-amber-300 font-medium block truncate">6. Perlu Cek Manual</span>
                    <span className="text-lg font-black font-mono tabular-nums text-amber-800 dark:text-amber-200 mt-1 block">
                      {auditReport.totalManualReviewNeeded}
                    </span>
                  </div>

                  <div className="p-3 bg-[#F4F7FB] dark:bg-[#160D29] rounded-xl border border-[#DDE6F0] dark:border-[#35105E]">
                    <span className="text-[10.5px] text-[#52647A] dark:text-[#CEC0E8] block truncate">7. Proses Gagal</span>
                    <span className="text-lg font-black font-mono tabular-nums text-[#26364A] dark:text-[#D9CCF2] mt-1 block">
                      {auditReport.totalFailed}
                    </span>
                  </div>
                </div>

                {auditReport.conflictItems.length > 0 && (
                  <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-xl border border-rose-200 dark:border-rose-900 text-xs space-y-1.5">
                    <span className="font-bold text-rose-800 dark:text-rose-200">
                      Perhatian: Ditemukan {auditReport.conflictItems.length} record yang memerlukan tinjauan manual:
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-rose-700 dark:text-rose-300">
                      {auditReport.conflictItems.map((c, i) => (
                        <li key={i}>
                          <span className="font-mono font-bold">{c.woNumber}</span>: {c.reasons.join(', ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* List of Detected Duplicate Groups in Active View */}
          <div className="card-3d-lavender p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-sm text-[#26364A] dark:text-white flex items-center gap-2">
                  <Copy className="w-4 h-4 text-rose-600" />
                  <span>Daftar Duplikasi WO Aktif ({duplicateGroups.length} grup)</span>
                </h3>
                <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
                  Menampilkan grup record Work Order dengan nomor WO yang sama.
                </p>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-bold font-mono tabular-nums ${
                duplicateGroups.length === 0
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
              }`}>
                {duplicateGroups.length} Grup Duplikat
              </span>
            </div>

            {duplicateGroups.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto mb-2" />
                <h4 className="font-bold text-sm text-emerald-900 dark:text-emerald-200">Database Bersih dari Duplikasi</h4>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1">
                  Seluruh record Work Order dalam database aktif adalah unik dan memenuhi aturan integritas data.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {duplicateGroups.map(([woKey, dupList]) => (
                  <div key={woKey} className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-600" />
                        <span className="font-mono font-black text-sm text-rose-900 dark:text-rose-200">
                          {woKey}
                        </span>
                        <span className="text-xs text-rose-600 font-semibold">
                          ({dupList.length} duplikasi ditemukan)
                        </span>
                      </div>
                      {currentUser.role === 'super_admin' && (
                        <button
                          onClick={() => handleReconcileKeepFirst(woKey)}
                          className="btn-3d-crimson px-3 py-1.5 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Rekonsiliasi (Pertahankan 1 Utama)</span>
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {dupList.map((t, idx) => (
                        <div key={t.id} className="p-3 rounded-xl bg-white dark:bg-[#1E1238] border border-[#DDE6F0] dark:border-[#35105E]">
                          <div className="flex items-center justify-between text-[11px] text-[#52647A] dark:text-[#A78BFA] mb-1">
                            <span>Record #{idx + 1} (ID: {t.id})</span>
                            <span className="font-semibold text-[#26364A] dark:text-[#E8DDFF]">{t.dateUpload || t.date}</span>
                          </div>
                          <div className="font-bold text-[#26364A] dark:text-white">{t.customerName}</div>
                          <div className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">Teknisi: {t.installerName || 'Unassigned'} · Vendor: {t.contactorName} · Status: {t.statusWOInstaller}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBMENU 5: DATA VALIDATION */}
      {activeSubmenu === 'data_validation' && (
        <div className="space-y-4">
          <div className="card-3d-lavender p-5 rounded-2xl">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-sm text-[#26364A] dark:text-white flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Audit Kualitas Data (Data Validation)</span>
                </h3>
                <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
                  Mendeteksi field kosong, format Appointment Date tidak valid, atau relasi teknisi tidak sinkron.
                </p>
              </div>
              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200 text-xs font-bold font-mono tabular-nums">
                {validationIssues.length} Isu Terdeteksi
              </span>
            </div>

            {validationIssues.length === 0 ? (
              <div className="p-8 text-center text-emerald-600 font-bold text-xs">
                Seluruh data Work Order memenuhi standar validasi aplikasi.
              </div>
            ) : (
              <div className="divide-y divide-[#E2E8F0] dark:divide-[#2D1852] text-xs">
                {validationIssues.map(issue => (
                  <div key={issue.id} className="py-3 flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[#5145A6] dark:text-[#D8B4FE]">
                          {issue.ticket.woNumber || 'NO_WO_EMPTY'}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 text-[10px] font-semibold">
                          {issue.field}
                        </span>
                      </div>
                      <p className="text-[#26364A] dark:text-white font-medium mt-1">{issue.message}</p>
                      <p className="text-[#52647A] dark:text-[#CEC0E8] text-[11px]">Rekomendasi: {issue.recommendation}</p>
                    </div>
                    <button
                      onClick={() => handleOpenEdit(issue.ticket)}
                      className="btn-3d-lilac px-3 py-1.5 font-bold text-[11px] rounded-lg shrink-0 cursor-pointer"
                    >
                      Koreksi
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBMENU 6: DATA ARCHIVE */}
      {activeSubmenu === 'data_archive' && (
        <div className="space-y-4">
          <div className="card-3d-lavender p-5 rounded-2xl">
            <h3 className="font-bold text-sm text-[#26364A] dark:text-white flex items-center gap-2 mb-1">
              <Archive className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
              <span>Arsip Data Work Order (Data Archive)</span>
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mb-4">
              Menyimpan tiket lama yang sudah selesai atau dibatalkan tanpa menghapus data secara permanen.
            </p>

            {nonDeletedTickets.filter(t => t.isArchived).length === 0 ? (
              <div className="p-8 text-center text-[#52647A] dark:text-[#CEC0E8] text-xs">
                Belum ada tiket WO yang diarsipkan di database.
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                {nonDeletedTickets.filter(t => t.isArchived).map(t => (
                  <div key={t.id} className="p-3 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F4F7FB] dark:bg-[#160D29] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-[#26364A] dark:text-white">{t.woNumber}</span>
                      <span className="text-[#52647A] dark:text-[#CEC0E8] ml-2">· {t.customerName} ({t.appointmentDate || '-'})</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreTicket(t.id)}
                      className="btn-3d-emerald px-3 py-1.5 min-h-[36px] text-white font-bold rounded-lg text-xs self-start sm:self-auto shrink-0 cursor-pointer"
                    >
                      Pulihkan dari Arsip
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBMENU 6B: SOFT-DELETED WO RESTORE (SUPERADMIN ONLY) */}
      {activeSubmenu === 'deleted_wos' && currentUser.role === 'super_admin' && (
        <div className="space-y-4">
          <div className="card-3d-lavender p-5 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-[#26364A] dark:text-white flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  <span>Pemulihan Work Order Terhapus (Soft Delete Restore)</span>
                </h3>
                <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
                  Khusus Superadmin. Work Order yang dihapus secara soft-delete tetap menyimpan histori assignment, pesan LiveChat, laporan teknisi, dan lampiran, serta dapat dipulihkan ke daftar aktif.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadDeletedWorkOrders(deletedSearch)}
                disabled={isLoadingDeleted}
                className="btn-3d-lilac px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDeleted ? 'animate-spin' : ''}`} />
                <span>Muat Ulang</span>
              </button>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs">
              <div className="flex items-center gap-2 flex-1">
                <Search className="w-4 h-4 text-[#8492A5] dark:text-[#766B83] shrink-0" />
                <input
                  type="text"
                  value={deletedSearch}
                  onChange={e => setDeletedSearch(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') void loadDeletedWorkOrders(deletedSearch);
                  }}
                  placeholder="Cari WO Number, Customer ID, Nama Pelanggan, Kontraktor, atau Alasan..."
                  className="tactile-debossed-input w-full px-3 py-2 rounded-xl text-[#26364A] dark:text-white"
                />
              </div>
              <button
                type="button"
                onClick={() => void loadDeletedWorkOrders(deletedSearch)}
                disabled={isLoadingDeleted}
                className="btn-3d-primary px-4 py-2 rounded-xl text-white font-bold cursor-pointer disabled:opacity-50"
              >
                Cari
              </button>
            </div>

            {deletedError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{deletedError}</span>
              </div>
            )}

            {isLoadingDeleted ? (
              <div className="p-8 text-center text-xs text-[#52647A] dark:text-[#CEC0E8] flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Memuat daftar Work Order terhapus dari database...</span>
              </div>
            ) : deletedWos.length === 0 ? (
              <div className="p-8 text-center text-[#52647A] dark:text-[#CEC0E8] text-xs rounded-xl bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#35105E]">
                Tidak ada Work Order berstatus terhapus (soft delete) saat ini.
              </div>
            ) : (
              <div className="space-y-2.5 text-xs">
                {deletedWos.map(t => (
                  <div
                    key={t.id}
                    className="p-3.5 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F4F7FB] dark:bg-[#160D29] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-bold text-sm text-[#5145A6] dark:text-[#D8B4FE]">
                          {t.woNumber}
                        </span>
                        <span className="font-bold text-[#26364A] dark:text-white">
                          · {t.customerName || '-'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                          SOFT DELETED
                        </span>
                      </div>
                      <div className="text-[11px] text-[#52647A] dark:text-[#D9CCF2] flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span>ID Cust: <strong className="font-mono">{t.idCustomer || t.customerId || '-'}</strong></span>
                        <span>Mitra: <strong>{t.contactorName || t.contractorName || '-'}</strong></span>
                        <span>Area: <strong>{t.area || '-'}</strong></span>
                        <span>Teknisi: <strong>{t.installerName || 'Unassigned'}</strong></span>
                        <span>Appointment: <strong className="font-mono">{t.appointmentDate || '-'}</strong></span>
                      </div>
                      <div className="text-[11px] text-[#8492A5] dark:text-[#A78BFA]">
                        Dihapus oleh: <strong>{t.deletedBy || '-'}</strong>
                        {t.deletedAt ? ` · ${new Date(t.deletedAt).toLocaleString('id-ID')}` : ''}
                        {t.deletionReason ? ` · Alasan: "${t.deletionReason}"` : ''}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={restoringDeletedId === t.id}
                      onClick={async () => {
                        setRestoringDeletedId(t.id);
                        try {
                          const res = await restoreTicket(t.id);
                          if (res.success) {
                            setDeletedWos(prev => prev.filter(item => item.id !== t.id));
                          }
                        } finally {
                          setRestoringDeletedId(null);
                        }
                      }}
                      className="btn-3d-emerald px-3.5 py-2 min-h-[38px] text-white font-bold rounded-xl text-xs flex items-center gap-1.5 self-start sm:self-auto shrink-0 cursor-pointer disabled:opacity-50"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${restoringDeletedId === t.id ? 'animate-spin' : ''}`} />
                      <span>{restoringDeletedId === t.id ? 'Memulihkan...' : 'Pulihkan WO'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUBMENU 7: DATABASE AUDIT LOG */}
      {activeSubmenu === 'audit_log' && (
        <div className="space-y-4">
          <div className="card-3d-lavender p-5 rounded-2xl">
            <h3 className="font-bold text-sm text-[#26364A] dark:text-white flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-[#5145A6] dark:text-[#D8B4FE]" />
              <span>Audit Trail Mutasi Database</span>
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mb-4">
              Pencatatan real-time terhadap perubahan appointment date, impor WO, penugasan teknisi, dan aktivitas staf.
            </p>

            <div className="space-y-2 max-h-[500px] overflow-y-auto text-xs">
              {auditLogs.map(log => (
                <div key={log.id} className="p-3 rounded-xl border border-[#DDE6F0] dark:border-[#35105E] bg-[#F4F7FB] dark:bg-[#160D29] flex items-start justify-between gap-3">
                  <div>
                    <div className="font-bold text-[#26364A] dark:text-white">{log.action}</div>
                    <div className="text-[#52647A] dark:text-[#D9CCF2] mt-0.5">{log.details}</div>
                    <div className="text-[10.5px] text-[#8492A5] dark:text-[#A78BFA] mt-1">
                      Oleh: <strong>{log.performedBy}</strong> ({log.userRole}) · {new Date(log.timestamp).toLocaleString('id-ID')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal Edit Record WO */}
      <ResponsiveModal
        isOpen={Boolean(editingTicket)}
        onClose={() => setEditingTicket(null)}
        title={
          editingTicket ? (
            <span>
              Koreksi Data WO: <span className="font-mono text-[#5145A6] dark:text-[#D8B4FE]">{editingTicket.woNumber}</span>
            </span>
          ) : undefined
        }
        subtitle={editingTicket?.customerName}
        icon={<Edit className="w-4 h-4" />}
        size="md"
        mobileVariant="sheet"
        footer={
          <>
            <button
              type="button"
              onClick={() => setEditingTicket(null)}
              className="btn-3d-lilac px-4 py-2 min-h-[40px] rounded-xl font-bold text-xs cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              className="btn-3d-primary px-4 py-2 min-h-[40px] rounded-xl text-white font-bold text-xs cursor-pointer"
            >
              Simpan Perubahan
            </button>
          </>
        }
      >
        {editingTicket && (
          <div className="space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-[#26364A] dark:text-[#E8DDFF] mb-1">Nama Pelanggan</label>
              <input
                type="text"
                value={editForm.customerName || ''}
                onChange={e => setEditForm({ ...editForm, customerName: e.target.value })}
                className="tactile-debossed-input w-full px-3 py-2 min-h-[40px] rounded-xl text-[#26364A] dark:text-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-[#26364A] dark:text-[#E8DDFF] mb-1">Appointment Date</label>
                <input
                  type="date"
                  value={editForm.appointmentDate || ''}
                  onChange={e => setEditForm({ ...editForm, appointmentDate: e.target.value })}
                  className="tactile-debossed-input w-full px-3 py-2 min-h-[40px] rounded-xl text-[#26364A] dark:text-white"
                />
              </div>
              <div>
                <label className="block font-semibold text-[#26364A] dark:text-[#E8DDFF] mb-1">Slot Waktu</label>
                <input
                  type="text"
                  value={editForm.slotTime || ''}
                  onChange={e => setEditForm({ ...editForm, slotTime: e.target.value })}
                  className="tactile-debossed-input w-full px-3 py-2 min-h-[40px] rounded-xl text-[#26364A] dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-[#26364A] dark:text-[#E8DDFF] mb-1">Kontraktor</label>
              <select
                value={editForm.contactorName || ''}
                onChange={e => setEditForm({ ...editForm, contactorName: e.target.value })}
                className="tactile-debossed-input w-full px-3 py-2 min-h-[40px] rounded-xl text-[#26364A] dark:text-white"
              >
                {contractors.map((c, cIdx) => (
                  <option key={`edit-contractor-${c.id || c.name}-${cIdx}`} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-[#26364A] dark:text-[#E8DDFF] mb-1">Teknisi (Installer)</label>
              <input
                type="text"
                value={editForm.installerName || ''}
                onChange={e => setEditForm({ ...editForm, installerName: e.target.value })}
                placeholder="Nama teknisi penugasan"
                className="tactile-debossed-input w-full px-3 py-2 min-h-[40px] rounded-xl text-[#26364A] dark:text-white"
              />
            </div>
          </div>
        )}
      </ResponsiveModal>
    </div>
  );
};
