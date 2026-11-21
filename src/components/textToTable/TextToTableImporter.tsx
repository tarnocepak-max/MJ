import React, { useState, useRef, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { parseWorkOrderText, parseWorkOrderFile } from '../../services/textToTableParser';
import { TextToTableResult, ParsedRowData } from '../../types/index.ts';
import { MASTER_CANONICAL_FIELDS, isValidWoNumber } from '../../services/woFieldMappingEngine';
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Edit,
  Sparkles,
  Info,
  ShieldAlert,
  Sliders,
  Database,
  Building2,
  Upload,
  AlertTriangle,
  ShieldCheck,
  Check,
  Download,
  FileDown,
  Wrench,
  RefreshCw,
  History,
  Calendar,
  Lock,
  Unlock,
  Search,
  X,
  RotateCcw,
  FileWarning,
  ClipboardPaste,
  ChevronDown,
  ChevronUp,
  Inbox
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useToast } from '../../context/ToastContext';
import { useResponsiveViewport } from '../../hooks/useResponsiveViewport';
import { ResponsiveModal } from '../common/ResponsiveModal';
import { ResponsiveDataTable, ResponsiveColumn } from '../common/ResponsiveDataTable';

interface TextToTableImporterProps {
  onImportSuccess: () => void;
}

// Reference 1: BASE_DATA_WO (46 columns baseline, with exact 7-digit Customer ID)
const SAMPLE_BASE_DATA_WO = `|WO Number|Ticket Number|Date|Appointment Date|ID Customer|Customer Name|Customer Phone|Customer Phone2|Area|Cluster Name|Street Name|Street Alternatif|Contactor Name|Installer Name|Slot Time|FDT Code|FAT Code|Ticket Category|Status WO Agent|Status WO Installer|Remarks WO Installer|Remarks Agent|Date Upload|File Name|Agent ID|
|WO20267399330|TCK-9901|2026-10-18|2026-10-19|7399330|Haji Sulaiman|081299883344|081399881122|Jakarta Selatan|Grand Melati Residence|Jl. Kenanga No. 12|Dekat Masjid Al-Ikhlas|PT Mitra Jaringan Solusi|Andi Saputra|09:00 - 11:00 WIB|FDT-JS-015|FAT-JS-015-02|New Installation FTTH|Assigned|Assigned|Material kabel siap|Prioritas pagi|2026-10-18 08:00|BASE_DATA_WO.xlsx|AGT-101|
|WO20267399331|TCK-9902|2026-10-18|2026-10-19|7399331|dr. Anita Wijaya|085711224455||Jakarta Barat|Permata Hijau 2|Blok C No. 5|Pintu gerbang putih seberang pos|PT Kencana Solusindo|Dedi Kurniawan|13:00 - 15:00 WIB|FDT-JB-008|FAT-JB-008-02|Relocation ONT|Assigned|Assigned|Menunggu kedatangan dokter|Hubungi sebelum tiba|2026-10-18 08:00|BASE_DATA_WO.xlsx|AGT-102|
|WO20267399332|TCK-9903|2026-10-18|2026-10-19|7399332|Kurnia Sandi|081822334455||Tangerang Selatan|Victoria Riverside|Jl. Melati IV No. 22||PT Cipta Fiber Nusantara||15:00 - 17:00 WIB|FDT-TS-005|FAT-TS-005-01|Maintenance LOS Red Light|Pending|Unassigned||Perlu pengecekan redaman FAT|2026-10-18 08:00|BASE_DATA_WO.xlsx|AGT-103|`;

// Reference 2: data_wo_20261018 (45 columns, with empty/unnamed header column preserved)
const SAMPLE_DATA_WO_OPERATIONAL = `|Date|File Name|Date Upload|Agent ID|ID Customer|WO Number|Customer Name|Customer Phone||Contactor Name|Area|Installer Name|Slot Time|Cluster Name|FDT Code|FAT Code|Ticket Category|Status WO Installer|Remarks WO Installer|
|2026-10-18|data_wo_20261018.xlsx|2026-10-18 09:30|AGT-108|7399335|WO20267399335|Agung Prasetyo|081288776655|Catatan Khusus Jalur Pipa Tanam|PT Mitra Jaringan Solusi|Jakarta Selatan|Andi Saputra|10:00 - 12:00 WIB|Grand Melati Residence|FDT-JS-020|FAT-JS-020-04|New Installation FTTH|Assigned|Pipa tanam siap ditarik|
|2026-10-18|data_wo_20261018.xlsx|2026-10-18 09:30|AGT-108|7399336|WO20267399336|Mega Utami|087812345678|Keluarga Ada di Rumah Siang|PT Kencana Solusindo|Jakarta Barat||14:00 - 16:00 WIB|Permata Hijau 2|FDT-JB-014|FAT-JB-014-06|Upgrade Speed 200M|Unassigned||
|2026-10-18|data_wo_20261018.xlsx|2026-10-18 09:30|AGT-109|7399337|WO20267399337|Syamsul Bahri|081377889900|Titip Kunci di Pos Satpam|PT Mitra Jaringan Solusi|Jakarta Selatan|Andi Saputra|16:00 - 18:00 WIB|Grand Melati Residence|FDT-JS-022|FAT-JS-022-01|Maintenance LOS Red Light|Assigned|Bawa kabel dropcore cadangan|`;

const REQUIRED_FIELD_PILLS = [
  'WO Number',
  'Customer ID',
  'Nama Pelanggan',
  'Alamat',
  'Area/Cluster',
  'Tanggal Appointment',
  'FDT / FAT',
  'Kontraktor'
];

export const TextToTableImporter: React.FC<TextToTableImporterProps> = ({ onImportSuccess }) => {
  const { isCompactUI } = useResponsiveViewport();
  const {
    bulkImportTickets,
    headerMappings,
    tickets,
    auditLogs,
    contractors,
    coverageAreas,
    currentUser,
    autoRegisterContractors,
    googleSheetsConfig,
    syncGoogleSheetsNow,
    deleteImportedTicketsByDate
  } = useApp();

  const { showToast } = useToast();

  const [isPullingFromSheets, setIsPullingFromSheets] = useState(false);
  const [rawText, setRawText] = useState('');
  const [parseResult, setParseResult] = useState<TextToTableResult | null>(null);
  const [editingRowIndex, setEditingRowIndex] = useState<number | null>(null);
  const [editingRowData, setEditingRowData] = useState<Record<string, string>>({});
  const [importReport, setImportReport] = useState<{
    imported: number;
    duplicates: number;
    enrolledContractors?: number;
    newContractors?: number;
    distributedCount?: number;
    undistributedCount?: number;
  } | null>(null);
  const [showMappingCatalog, setShowMappingCatalog] = useState(false);
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sourceFileName, setSourceFileName] = useState('Belum ada berkas');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isExecutingImport, setIsExecutingImport] = useState(false);
  const [contractorEnrollNotice, setContractorEnrollNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const batchConfirmSectionRef = useRef<HTMLDivElement>(null);

  // Top Tab Switcher: Import vs Export vs Riwayat & Hapus
  const [mainTab, setMainTab] = useState<'import' | 'export' | 'history_delete'>('import');

  // Role visibility check: Deleting imported data is strictly restricted to Management Data
  const isManagementData = currentUser.role === 'management_data';

  useEffect(() => {
    if (!isManagementData && mainTab === 'history_delete') {
      setMainTab('import');
    }
  }, [isManagementData, mainTab]);

  // Export State & Filters
  const [exportFormat, setExportFormat] = useState<'full_46' | 'korlap_template' | 'teknisi_template'>('full_46');
  const [exportContractor, setExportContractor] = useState('ALL');
  const [exportStatus, setExportStatus] = useState('ALL');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // History & Deletion by Date (7 Days retention)
  const [selectedPurgeDate, setSelectedPurgeDate] = useState<string>('');
  const [purgeReason, setPurgeReason] = useState<string>('');
  const [purgeConfirmPhrase, setPurgeConfirmPhrase] = useState<string>('');
  const [showPurgeModal, setShowPurgeModal] = useState<boolean>(false);
  const [dateToPurge, setDateToPurge] = useState<string | null>(null);
  const [purgeCount, setPurgeCount] = useState<number>(0);

  // Policies
  const [autoRegisterNewContractors, setAutoRegisterNewContractors] = useState<boolean>(true);
  const [duplicatePolicy, setDuplicatePolicy] = useState<'skip' | 'update_allowed'>('skip');

  // Preview filters
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'VALID' | 'DUPLICATE' | 'ERROR'>('ALL');
  const [previewCategoryFilter, setPreviewCategoryFilter] = useState<string>('ALL');
  const [previewCategorySearch, setPreviewCategorySearch] = useState<string>('');

  // Validation counts derived strictly from parseResult
  const validationSummary = useMemo(() => {
    if (!parseResult) {
      return { total: 0, valid: 0, duplicate: 0, error: 0, validPct: '0.0' };
    }
    const rows = parseResult.parsedRows;
    const total = parseResult.totalDetected || rows.length;
    const valid = rows.filter(r => r.isValid && !r.isDuplicate).length;
    const duplicate = rows.filter(r => r.isDuplicate || r.statusType === 'WO DUPLIKAT').length;
    const error = rows.filter(r => !r.isValid && !r.isDuplicate && r.statusType !== 'WO DUPLIKAT').length;
    const validPct = total > 0 ? ((valid / total) * 100).toFixed(1) : '0.0';
    return { total, valid, duplicate, error, validPct };
  }, [parseResult]);

  // Real Recent Import History derived from live tickets & auditLogs (ZERO fake/hardcoded batches)
  const recentImportBatches = useMemo(() => {
    const batchMap = new Map<
      string,
      { key: string; label: string; timeLabel: string; sortTs: number; performer: string; count: number; statusLabel: string }
    >();

    tickets.forEach(t => {
      if (t.isArchived) return;
      if (!t.fileName && !t.importDate && !t.dateUpload) return;
      const fName = (t.fileName || `Import_${t.importDate || t.date}`).trim();
      const dKey = (t.dateUpload || t.importDate || t.date || '').slice(0, 16);
      const mapKey = `${fName}__${dKey}`;
      const ts = new Date(t.importedAt || t.createdAt || t.date || Date.now()).getTime() || 0;
      const existing = batchMap.get(mapKey);
      if (existing) {
        existing.count += 1;
        if (ts > existing.sortTs) existing.sortTs = ts;
      } else {
        batchMap.set(mapKey, {
          key: mapKey,
          label: fName,
          timeLabel: t.importedAt || t.createdAt || t.dateUpload || t.importDate || t.date,
          sortTs: ts,
          performer: t.agentId || 'Superadmin / Data',
          count: 1,
          statusLabel: 'TERSIMPAN'
        });
      }
    });

    auditLogs
      .filter(l => l.entity === 'import_batch' || String(l.action || '').toUpperCase().includes('IMPORT'))
      .forEach(l => {
        const ts = new Date(l.timestamp).getTime() || 0;
        const mapKey = `audit_${l.id}`;
        const matchWoCount = String(l.details || '').match(/(\d+)\s*(?:WO|tiket|baris)/i);
        batchMap.set(mapKey, {
          key: mapKey,
          label: l.entityId && l.entityId !== 'bulk' ? l.entityId : l.action,
          timeLabel: l.timestamp,
          sortTs: ts,
          performer: l.performedBy || 'Operator',
          count: matchWoCount ? Number(matchWoCount[1]) : 0,
          statusLabel: 'SUKSES'
        });
      });

    return Array.from(batchMap.values())
      .sort((a, b) => b.sortTs - a.sortTs)
      .slice(0, 4);
  }, [tickets, auditLogs]);

  // Detect New Contractors from parsed rows
  const newContractorsFound = useMemo(() => {
    if (!parseResult) return [];
    const existingNames = new Set(contractors.map(c => c.name.trim().toLowerCase()));
    const uniqueMap = new Map<string, { name: string; area?: string; woCount: number }>();
    parseResult.parsedRows.forEach(r => {
      const name = (r.mapped.contactorName || r.mapped.contractorName || '').trim();
      if (name && !existingNames.has(name.toLowerCase())) {
        const item = uniqueMap.get(name.toLowerCase());
        if (item) {
          item.woCount += 1;
        } else {
          uniqueMap.set(name.toLowerCase(), { name, area: r.mapped.area, woCount: 1 });
        }
      }
    });
    return Array.from(uniqueMap.values());
  }, [parseResult, contractors]);

  // Unique detected ticket categories in preview
  const detectedTicketCategories: string[] = useMemo(() => {
    if (!parseResult) return [];
    const set = new Set(
      parseResult.parsedRows
        .map(r => r.mapped.ticketCategory)
        .filter((c): c is string => Boolean(c && typeof c === 'string'))
    );
    return Array.from(set).sort();
  }, [parseResult]);

  // Filtered rows for pre-import table preview
  const displayedPreviewRows = useMemo(() => {
    if (!parseResult) return [];
    return parseResult.parsedRows.filter(row => {
      if (statusFilter === 'VALID' && (!row.isValid || row.isDuplicate)) return false;
      if (statusFilter === 'DUPLICATE' && !row.isDuplicate && row.statusType !== 'WO DUPLIKAT') return false;
      if (statusFilter === 'ERROR' && (row.isValid || row.isDuplicate || row.statusType === 'WO DUPLIKAT')) return false;

      if (previewCategoryFilter !== 'ALL') {
        if ((row.mapped.ticketCategory || '') !== previewCategoryFilter) return false;
      }
      if (previewCategorySearch.trim()) {
        const q = previewCategorySearch.toLowerCase().trim();
        const matchCat = (row.mapped.ticketCategory || '').toLowerCase().includes(q);
        const matchWo = (row.mapped.woNumber || '').toLowerCase().includes(q);
        const matchCust = (row.mapped.customerName || '').toLowerCase().includes(q);
        const matchCont = (row.mapped.contactorName || row.mapped.contractorName || '').toLowerCase().includes(q);
        if (!matchCat && !matchWo && !matchCust && !matchCont) return false;
      }
      return true;
    });
  }, [parseResult, statusFilter, previewCategoryFilter, previewCategorySearch]);

  const handleEnrollContractorsNow = () => {
    if (!parseResult || !parseResult.detectedContractors) return;
    const toRegister = parseResult.detectedContractors.map(c => ({
      id: c.id,
      name: c.name,
      code: c.code,
      coverageAreas: c.coverageAreas,
      leaderName: c.leaderName,
      phone: c.phone,
      email: c.email || `ops@${c.code.toLowerCase()}.morajaws.net`,
      active: true,
      createdAt: new Date().toISOString()
    }));

    const result = autoRegisterContractors(toRegister);
    const msg = `Berhasil mendaftarkan ${result.addedCount} kontraktor baru dan memperbarui ${result.updatedCount} kontraktor di Master Data!`;
    setContractorEnrollNotice(msg);
    showToast(msg, 'success', 'Mitra Terdaftar');
    setTimeout(() => setContractorEnrollNotice(null), 4000);
  };

  const handleSyncFromGoogleSheetsNow = async () => {
    if (!googleSheetsConfig.spreadsheetId) {
      showToast(
        'Google Sheets belum terhubung. Buka tab Setup -> Database & Sync -> Google Sheets Live Sync untuk menautkan spreadsheet.',
        'info',
        'Google Sheets Belum Terkonfigurasi'
      );
      return;
    }

    setIsPullingFromSheets(true);
    try {
      const res = await syncGoogleSheetsNow('import_only');
      if (res.success) {
        setImportReport({
          imported: res.pulledCount || 0,
          duplicates: 0,
          enrolledContractors: res.newContractorsCount || 0,
          newContractors: res.newContractorsCount || 0
        });
        showToast(
          `Sinkronisasi Google Sheets selesai (${res.pulledCount || 0} WO ditarik).`,
          'success',
          'Sync Google Sheets Berhasil'
        );
      } else {
        showToast(res.message || 'Gagal sinkronisasi data dari Google Sheets.', 'error', 'Sync Gagal');
      }
    } catch (err: any) {
      showToast(err?.message || 'Gagal sinkronisasi data dari Google Sheets.', 'error', 'Sync Gagal');
    } finally {
      setIsPullingFromSheets(false);
    }
  };

  const handleExportFile = (fileType: 'xlsx' | 'csv') => {
    let list = tickets.filter(t => !t.isArchived);
    if (exportContractor !== 'ALL') {
      list = list.filter(t => t.contactorName === exportContractor);
    }
    if (exportStatus !== 'ALL') {
      if (exportStatus === 'UNASSIGNED') list = list.filter(t => !t.installerName);
      else if (exportStatus === 'ASSIGNED') list = list.filter(t => Boolean(t.installerName));
      else list = list.filter(t => t.statusWOAgent === exportStatus || t.statusWOInstaller === exportStatus);
    }

    if (list.length === 0) {
      setExportNotice('Tidak ada data tiket yang cocok dengan filter untuk diekspor.');
      showToast('Tidak ada data tiket yang cocok dengan filter untuk diekspor.', 'warning', 'Data Kosong');
      setTimeout(() => setExportNotice(null), 3000);
      return;
    }

    let rows: Record<string, any>[] = [];
    if (exportFormat === 'korlap_template') {
      rows = list.map(t => ({
        'WO Number': t.woNumber,
        'ID Customer': t.idCustomer,
        'Customer Name': t.customerName,
        'Customer Phone': t.customerPhone,
        'Area': t.area,
        'Cluster Name': t.clusterName,
        'Street Name': t.streetName,
        'Contactor Name': t.contactorName,
        'Leader Name': t.leaderName || '',
        'Slot Time': t.slotTime,
        'Status WO Agent': t.statusWOAgent,
        'Date': t.date,
        'Catatan Korlap': t.remarksAgent || ''
      }));
    } else if (exportFormat === 'teknisi_template') {
      rows = list.map(t => ({
        'WO Number': t.woNumber,
        'ID Customer': t.idCustomer,
        'Customer Name': t.customerName,
        'Customer Phone': t.customerPhone,
        'Contactor Name': t.contactorName,
        'Installer Name': t.installerName || '',
        'Slot Time': t.slotTime,
        'FAT Code': t.fatCode || '',
        'Port FAT': t.fatPort || '',
        'Status WO Installer': t.statusWOInstaller,
        'Remarks WO Installer': t.remarksWOInstaller || ''
      }));
    } else {
      rows = list.map(t => ({
        'No': t.id,
        'WO Number': t.woNumber,
        'Ticket Number': t.ticketNumber || '',
        'Date': t.appointmentDate || '',
        'Appointment Date': t.appointmentDate || '',
        'ID Customer': t.idCustomer,
        'Customer Name': t.customerName,
        'Customer Phone': t.customerPhone || '',
        'Customer Phone2': t.customerContact2 || '',
        'Area': t.area || '',
        'Cluster Name': t.clusterName || '',
        'Street Name': t.streetName || '',
        'Contactor Name': t.contactorName || '',
        'Installer Name': t.installerName || '',
        'Slot Time': t.slotTime || '',
        'FDT Code': t.fdtCode || '',
        'FAT Code': t.fatCode || '',
        'Ticket Category': t.ticketCategory || '',
        'Status WO Agent': t.statusWOAgent || '',
        'Status WO Installer': t.statusWOInstaller || '',
        'Remarks WO Installer': t.remarksWOInstaller || '',
        'Remarks Agent': t.remarksAgent || '',
        'Date Upload': t.dateUpload || '',
        'File Name': t.fileName || '',
        'Agent ID': t.agentId || ''
      }));
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Work_Orders');

    const fileName = `MoraJaws_WO_Export_${exportFormat}_${new Date().toISOString().slice(0, 10)}.${fileType}`;
    XLSX.writeFile(wb, fileName, { bookType: fileType });
    setExportNotice(`Berhasil mengekspor ${rows.length} data Work Order ke ${fileName}`);
    showToast(`Berhasil mengekspor ${rows.length} data Work Order ke ${fileName}`, 'success', 'Export Berhasil');
    setTimeout(() => setExportNotice(null), 4000);
  };

  const handleDownloadBlankTemplate = (type: 'master_46' | 'korlap' | 'teknisi') => {
    let rows: Record<string, any>[] = [];
    let sheetName = 'Template';
    let fileName = '';

    if (type === 'korlap') {
      sheetName = 'Template_WO_Korlap';
      fileName = 'Template_WO_Korlap.xlsx';
      rows = [
        {
          'WO Number': 'WO20267399340',
          'ID Customer': '7399340',
          'Customer Name': 'Contoh Pelanggan Korlap',
          'Customer Phone': '081299881122',
          'Area': 'Jakarta Selatan',
          'Cluster Name': 'Cluster Cendana',
          'Street Name': 'Jl. Cendana No. 10',
          'Contactor Name': 'PT Mitra Jaringan Solusi',
          'Leader Name': 'Hendra Gunawan (Leader MJS)',
          'Slot Time': '09:00 - 11:00 WIB',
          'Status WO Agent': 'Assigned',
          'Date': '2026-10-19',
          'Catatan Korlap': 'Prioritas pagi'
        }
      ];
    } else if (type === 'teknisi') {
      sheetName = 'Template_Assigned_Teknisi';
      fileName = 'Template_Assigned_Teknisi.xlsx';
      rows = [
        {
          'WO Number': 'WO20267399341',
          'ID Customer': '7399341',
          'Customer Name': 'Contoh Pelanggan Teknisi',
          'Customer Phone': '081299883344',
          'Contactor Name': 'PT Mitra Jaringan Solusi',
          'Installer Name': 'Andi Saputra',
          'Slot Time': '11:00 - 13:00 WIB',
          'FAT Code': 'FAT-JS-015-02',
          'Port FAT': '3',
          'Status WO Installer': 'Assigned',
          'Remarks WO Installer': 'Material dropcore siap'
        }
      ];
    } else {
      sheetName = 'BASE_DATA_WO_46';
      fileName = 'BASE_DATA_WO_Template_46_Kolom.xlsx';
      rows = [
        {
          'No': '1',
          'WO Number': 'WO20267399350',
          'Ticket Number': 'TCK-9950',
          'Date': '2026-10-19',
          'Appointment Date': '2026-10-19',
          'ID Customer': '7399350',
          'Customer Name': 'Budi Santoso',
          'Customer Phone': '081299885566',
          'Area': 'Jakarta Selatan',
          'Cluster Name': 'Grand Melati Residence',
          'Street Name': 'Jl. Kenanga No. 15',
          'Contactor Name': 'PT Mitra Jaringan Solusi',
          'Installer Name': 'Andi Saputra',
          'Slot Time': '09:00 - 11:00 WIB',
          'FDT Code': 'FDT-JS-015',
          'FAT Code': 'FAT-JS-015-02',
          'Ticket Category': 'New Installation FTTH',
          'Status WO Agent': 'Assigned',
          'Status WO Installer': 'Assigned'
        }
      ];
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, fileName);
    setExportNotice(`Template blank "${fileName}" berhasil diunduh.`);
    showToast(`Template "${fileName}" berhasil diunduh.`, 'success', 'Template Diunduh');
    setTimeout(() => setExportNotice(null), 4000);
  };

  // Download Excel Error Report for non-valid / duplicate rows
  const handleDownloadErrorReport = () => {
    if (!parseResult) return;
    const problematicRows = parseResult.parsedRows.filter(r => !r.isValid || r.isDuplicate);
    if (problematicRows.length === 0) {
      showToast('Tidak ada baris duplikat atau error untuk diunduh.', 'info', 'Semua Baris Valid');
      return;
    }

    const rows = problematicRows.map(r => ({
      'Baris': r.rowIndex + 1,
      'Status Validasi': r.statusType || (r.isDuplicate ? 'WO DUPLIKAT' : 'ERROR'),
      'WO Number': r.mapped.woNumber || '',
      'Customer ID': r.mapped.idCustomer || '',
      'Nama Pelanggan': r.mapped.customerName || '',
      'Kontraktor': r.mapped.contactorName || r.mapped.contractorName || '',
      'Area': r.mapped.area || '',
      'Appointment Date': r.mapped.appointmentDate || '',
      'Kolom Bermasalah': (r.problematicColumns || []).join(', '),
      'Detail Keterangan': (r.validationErrors || []).join(' | ')
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Laporan_Error_Validasi');
    const fileName = `MoraJaws_Laporan_Error_Import_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
    showToast(`Laporan ${rows.length} baris bermasalah diunduh ke ${fileName}.`, 'success', 'Laporan Error Diunduh');
  };

  const canImport = currentUser.role === 'super_admin' || currentUser.role === 'management_data';

  if (!canImport) {
    return (
      <div className="card-3d-lavender rounded-2xl p-8 text-center max-w-lg mx-auto space-y-4 my-8">
        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-[#BA1A1A] dark:text-rose-300 rounded-2xl flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h3 className="font-display font-extrabold text-[#1F1638] dark:text-white text-base">
          Akses Ditolak: Otoritas Import Work Order Dibatasi
        </h3>
        <p className="text-xs text-[#4B4452] dark:text-[#CABDE8] leading-relaxed">
          Berdasarkan App Flow MoraJaws, proses import Work Order (Text-to-Table, XLSX, CSV)
          hanya dapat dilakukan oleh peran <strong>Super Admin</strong> dan <strong>Management Data</strong>.
        </p>
        <div className="p-3 bg-[#f8f1ff] dark:bg-[#160d29] border border-[#e8ddff] dark:border-[#3b1d78] rounded-xl text-xs text-[#4B4452] dark:text-[#CABDE8] font-medium">
          Akun Anda: <span className="font-bold capitalize text-[#1F1638] dark:text-white">{currentUser.name} ({currentUser.role})</span>. Akses import ditolak pada level UI dan Backend Server.
        </div>
      </div>
    );
  }

  const existingWos = tickets.map(t => t.woNumber);

  const handleParse = (textToParse?: string, shouldScrollToConfirm = false) => {
    const text = textToParse !== undefined ? textToParse : rawText;
    if (!text.trim()) {
      showToast('Masukkan data teks/tabel atau unggah file Excel/CSV terlebih dahulu.', 'warning', 'Data Kosong');
      return;
    }
    const result = parseWorkOrderText(text, {
      customMappings: headerMappings,
      existingWoNumbers: existingWos,
      contractors,
      coverageAreas
    });
    setParseResult(result);
    setImportReport(null);
    setStatusFilter('ALL');
    if (shouldScrollToConfirm) {
      setTimeout(() => {
        batchConfirmSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 90);
    }
  };

  const processUploadedFile = (file: File) => {
    const lowerName = file.name.toLowerCase();
    if (
      !lowerName.endsWith('.xlsx') &&
      !lowerName.endsWith('.xls') &&
      !lowerName.endsWith('.csv') &&
      !lowerName.endsWith('.txt')
    ) {
      showToast('Format file harus .xlsx, .xls, .csv, atau .txt.', 'error', 'Format Tidak Didukung');
      return;
    }

    setSourceFileName(file.name);
    setStatusFilter('ALL');
    const reader = new FileReader();

    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      reader.onload = event => {
        const buffer = event.target?.result as ArrayBuffer;
        if (buffer) {
          const result = parseWorkOrderFile(buffer, {
            customMappings: headerMappings,
            existingWoNumbers: existingWos,
            contractors,
            coverageAreas
          });
          setParseResult(result);
          setImportReport(null);
          showToast(`Berkas "${file.name}" terbaca (${result.parsedRows.length} baris).`, 'success', 'Berkas Diparsing');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = event => {
        const text = event.target?.result as string;
        if (text) {
          setRawText(text);
          handleParse(text);
          showToast(`Berkas "${file.name}" berhasil dibaca.`, 'success', 'Berkas Diparsing');
        }
      };
      reader.readAsText(file);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processUploadedFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processUploadedFile(file);
    }
  };

  const handleLoadBaseDataSample = () => {
    setSourceFileName('BASE_DATA_WO.xlsx');
    setRawText(SAMPLE_BASE_DATA_WO);
    handleParse(SAMPLE_BASE_DATA_WO);
  };

  const handleLoadOperationalSample = () => {
    setSourceFileName('data_wo_20261018.xlsx');
    setRawText(SAMPLE_DATA_WO_OPERATIONAL);
    handleParse(SAMPLE_DATA_WO_OPERATIONAL);
  };

  const handleResetWorkspace = () => {
    setParseResult(null);
    setRawText('');
    setImportReport(null);
    setStatusFilter('ALL');
    setPreviewCategoryFilter('ALL');
    setPreviewCategorySearch('');
    setEditingRowIndex(null);
    setSourceFileName('Belum ada berkas');
    setShowConfirmModal(false);
  };

  const handleDeleteRow = (rowIndex: number) => {
    if (!parseResult) return;
    const updatedRows = parseResult.parsedRows.filter(r => r.rowIndex !== rowIndex);
    const validCount = updatedRows.filter(r => r.isValid).length;
    const problematicCount = updatedRows.length - validCount;
    setParseResult({
      ...parseResult,
      totalDetected: updatedRows.length,
      validCount,
      problematicCount,
      duplicateCount: updatedRows.filter(r => r.isDuplicate).length,
      parsedRows: updatedRows
    });
  };

  const handleStartEditRow = (row: ParsedRowData) => {
    setEditingRowIndex(row.rowIndex);
    setEditingRowData({ ...(row.mapped as any) });
  };

  const handleSaveEditRow = (rowIndex: number) => {
    if (!parseResult) return;
    const updatedRows = parseResult.parsedRows.map(r => {
      if (r.rowIndex !== rowIndex) return r;
      const updatedMapped = { ...r.mapped, ...editingRowData };
      const woVal = (updatedMapped.woNumber || '').trim().toUpperCase();
      const isDup = existingWos.includes(woVal);

      const emptyCols: string[] = [];
      const formatErrs: string[] = [];
      const probCols: string[] = [];

      const custId = (updatedMapped.idCustomer || updatedMapped.customerId || '').trim();
      if (!custId) {
        emptyCols.push('Customer ID');
        probCols.push('Customer ID');
      } else if (!/^\d{7}$/.test(custId)) {
        formatErrs.push('Customer ID harus 7 digit numerik');
        probCols.push('Customer ID');
      }

      if (!woVal) {
        emptyCols.push('WO Number');
        probCols.push('WO Number');
      } else if (!isValidWoNumber(woVal)) {
        formatErrs.push('WO Number tidak valid');
        probCols.push('WO Number');
      }

      if (!(updatedMapped.streetName || '').trim()) {
        emptyCols.push('Street Name');
        probCols.push('Street Name');
      }

      if (!(updatedMapped.clusterName || '').trim()) {
        emptyCols.push('Cluster Name');
        probCols.push('Cluster Name');
      }

      if (!(updatedMapped.fatCode || updatedMapped.fat || '').trim()) {
        emptyCols.push('FAT');
        probCols.push('FAT');
      }

      if (!(updatedMapped.fdtCode || updatedMapped.fdt || '').trim()) {
        emptyCols.push('FDT');
        probCols.push('FDT');
      }

      const phone = (updatedMapped.customerPhone || updatedMapped.customerContact1 || '').trim().replace(/\D/g, '');
      if (!phone) {
        emptyCols.push('Customer Phone');
        probCols.push('Customer Phone');
      } else if (phone.length < 8) {
        formatErrs.push('Customer Phone tidak valid (minimal 8 digit)');
        probCols.push('Customer Phone');
      }

      if (!(updatedMapped.contactorName || updatedMapped.contractorName || '').trim()) {
        emptyCols.push('Contractor Name');
        probCols.push('Contractor Name');
      }

      if (!(updatedMapped.area || '').trim()) {
        emptyCols.push('Area');
        probCols.push('Area');
      }

      const dateVal = (updatedMapped.appointmentDate || '').trim();
      if (!dateVal) {
        emptyCols.push('Appointment Date');
        probCols.push('Appointment Date');
      }

      let statusType: 'VALID' | 'DATA KOSONG' | 'HEADER TIDAK DITEMUKAN' | 'FORMAT TIDAK VALID' | 'WO DUPLIKAT';
      const validationErrors: string[] = [];

      if (isDup) {
        statusType = 'WO DUPLIKAT';
        validationErrors.push(`Nomor WO ${woVal} sudah terdaftar di database Supabase PostgreSQL`);
      } else if (emptyCols.length > 0) {
        statusType = 'DATA KOSONG';
        validationErrors.push(`Kolom wajib kosong: ${emptyCols.join(', ')}`);
      } else if (formatErrs.length > 0) {
        statusType = 'FORMAT TIDAK VALID';
        validationErrors.push(...formatErrs);
      } else {
        statusType = 'VALID';
      }

      const isValid = statusType === 'VALID' && !isDup;

      return {
        ...r,
        mapped: updatedMapped,
        isValid,
        statusType,
        problematicColumns: probCols,
        isDuplicate: isDup,
        validationErrors
      };
    });

    setParseResult({
      ...parseResult,
      validCount: updatedRows.filter(r => r.isValid && !r.isDuplicate).length,
      problematicCount: updatedRows.filter(r => !r.isValid).length,
      duplicateCount: updatedRows.filter(r => r.isDuplicate).length,
      parsedRows: updatedRows
    });
    setEditingRowIndex(null);
  };

  const handleExecuteImport = () => {
    if (!parseResult || parseResult.parsedRows.length === 0) return;

    if (parseResult.headerCheckPassed === false) {
      showToast(
        `Proses import dihentikan: Header wajib tidak ditemukan (${parseResult.missingMandatoryHeaders?.join(', ')}).`,
        'error',
        'Header Wajib Tidak Ditemukan'
      );
      return;
    }

    const rowsToImport = parseResult.parsedRows.filter(r => r.isValid && !r.isDuplicate);

    if (rowsToImport.length === 0) {
      showToast(
        'Tidak ada baris data valid yang siap diimpor. Semua baris ditolak karena data kosong, format tidak valid, atau nomor WO duplikat.',
        'warning',
        'Tidak Ada Data Valid'
      );
      return;
    }

    const validMapped = rowsToImport.map(r => ({
      ...r.mapped,
      fileName: sourceFileName
    }));

    let enrolledNewCount = 0;
    if (autoRegisterNewContractors) {
      const contractorsToRegister = newContractorsFound.length > 0
        ? newContractorsFound.map((c: { name: string; area?: string; woCount: number }) => {
            const code = c.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'MTR';
            return {
              id: 'ctr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
              name: c.name,
              code,
              coverageAreas: c.area ? [c.area] : [],
              phone: '0812' + Math.floor(10000000 + Math.random() * 90000000),
              email: `ops@${code.toLowerCase()}.morajaws.net`,
              active: true,
              createdAt: new Date().toISOString()
            };
          })
        : (parseResult.detectedContractors?.filter(c => c.isNew) || []).map(c => ({
            id: c.id || ('ctr-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4)),
            name: c.name,
            code: c.code || 'MTR',
            coverageAreas: c.coverageAreas || [],
            phone: c.phone || '081299880000',
            email: c.email || `ops@${c.code.toLowerCase()}.morajaws.net`,
            active: true,
            createdAt: new Date().toISOString()
          }));

      if (contractorsToRegister.length > 0) {
        const regRes = autoRegisterContractors(contractorsToRegister);
        enrolledNewCount = regRes.addedCount;
      }
    }

    const report = bulkImportTickets(validMapped, { duplicatePolicy });
    setImportReport({
      imported: report.importedCount,
      duplicates: report.duplicatesIgnored,
      enrolledContractors: enrolledNewCount,
      newContractors: enrolledNewCount,
      distributedCount: report.distributedCount,
      undistributedCount: report.undistributedCount
    });
    showToast(`${report.importedCount} Work Order valid berhasil disimpan ke database.`, 'success', 'Batch Import Selesai');
    setParseResult(null);
    setRawText('');
    setShowConfirmModal(false);
    setTimeout(() => {
      onImportSuccess();
    }, 1500);
  };

  return (
    <div className="space-y-5">
      {/* Top 3D Tactile Tab Ribbon: Import vs Export vs Riwayat & Hapus */}
      <div className="mj-tactile-tab-bar p-1.5 inline-flex flex-wrap items-center gap-1.5 text-xs max-w-full">
        <button
          type="button"
          onClick={() => setMainTab('import')}
          className={`px-4 py-2 min-h-[38px] rounded-lg flex items-center gap-2 transition-all cursor-pointer ${
            mainTab === 'import'
              ? 'btn-3d-primary font-bold'
              : 'text-[#4B4452] dark:text-[#CABDE8] font-semibold hover:bg-white/75 dark:hover:bg-[#261942]'
          }`}
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Import Work Order</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab('export')}
          className={`px-4 py-2 min-h-[38px] rounded-lg flex items-center gap-2 transition-all cursor-pointer ${
            mainTab === 'export'
              ? 'btn-3d-primary font-bold'
              : 'text-[#4B4452] dark:text-[#CABDE8] font-semibold hover:bg-white/75 dark:hover:bg-[#261942]'
          }`}
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Work Order &amp; Template</span>
        </button>

        {isManagementData && (
          <button
            type="button"
            onClick={() => setMainTab('history_delete')}
            className={`px-4 py-2 min-h-[38px] rounded-lg flex items-center gap-2 transition-all cursor-pointer ${
              mainTab === 'history_delete'
                ? 'btn-3d-maroon font-bold'
                : 'text-[#4B4452] dark:text-[#CABDE8] font-semibold hover:bg-white/75 dark:hover:bg-[#261942]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Riwayat &amp; Hapus Data Import (7 Hari)</span>
          </button>
        )}
      </div>

      {/* ============================================================ */}
      {/* TAB 1: IMPORT WORK ORDER (STITCH SCREENSHOT 2 LAYOUT)        */}
      {/* ============================================================ */}
      {mainTab === 'import' && (
        <div className="space-y-5">
          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls,.csv,.txt"
            className="hidden"
            id="file-upload-input"
          />

          {/* Top Header Card */}
          <div className="card-3d-lavender rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
              <div className="space-y-2 min-w-0 flex-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-gradient-to-b from-[#6b103b] to-[#480123] text-white shadow-[0_2px_0_#260112] whitespace-nowrap">
                    {currentUser.role === 'super_admin' ? 'SUPERADMIN ONLY' : 'MANAGEMENT DATA'}
                  </span>
                  <span className="font-mono text-[11px] font-bold tracking-wider uppercase text-[#4B4452] dark:text-[#CABDE8] truncate">
                    {sourceFileName !== 'Belum ada berkas' ? `${sourceFileName} • ` : ''}
                    {parseResult ? 'STAGING VALIDATION' : 'WOFIELD MAPPING ENGINE'}
                  </span>
                </div>

                <h2 className="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-[#1F1638] dark:text-white">
                  Import Data Work Order (WO)
                </h2>

                <p className="text-xs text-[#4B4452] dark:text-[#CABDE8] max-w-2xl leading-relaxed">
                  Unggah berkas CSV/Excel, sinkronisasi Google Sheets, atau gunakan Text-to-Table deterministik untuk validasi massal sebelum masuk ke antrean dispatch FTTH.
                </p>
              </div>

              {/* 4 Action Buttons matching Stitch Screenshot 2 */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0 lg:max-w-[420px] lg:justify-end">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-3d-primary min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>+ Upload File CSV / Excel</span>
                </button>

                <button
                  type="button"
                  onClick={handleSyncFromGoogleSheetsNow}
                  disabled={isPullingFromSheets}
                  className="btn-3d-primary min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  title={
                    googleSheetsConfig.spreadsheetId
                      ? `Tarik data terkini dari Google Sheet: ${googleSheetsConfig.sheetName}`
                      : 'Lihat status integrasi Google Sheets'
                  }
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isPullingFromSheets ? 'animate-spin' : ''}`} />
                  <span>{isPullingFromSheets ? 'Menyinkronkan...' : 'Sync Google Sheets'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadBlankTemplate('master_46')}
                  className="btn-3d-lilac min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Template</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetWorkspace}
                  className="btn-3d-lilac min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </div>
            </div>

            {/* MoraJaws Quick Sample & Catalog Utility Strip */}
            <div className="pt-3 border-t border-[#e8ddff] dark:border-[#3b1d78] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleLoadBaseDataSample}
                  className="tactile-chip px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-[#58149C] dark:text-[#DAB9FF] flex items-center gap-1.5 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>1. BASE_DATA_WO (46 Kolom)</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadOperationalSample}
                  className="tactile-chip px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5 cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>2. data_wo_20261018 (45 Kolom)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowMappingCatalog(!showMappingCatalog)}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer ${
                    showMappingCatalog ? 'tactile-chip-active' : 'tactile-chip text-[#4B4452] dark:text-[#E9D5FF]'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Katalog 46 Kolom</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowTextEditor(!showTextEditor)}
                className="btn-3d-lilac px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                <span>Mode Paste Text-to-Table</span>
                {showTextEditor || rawText ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Drag-and-Drop Dropzone Well */}
          <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 space-y-4">
            <div
              onDragOver={e => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDropFile}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-2xl border-2 border-dashed p-6 sm:p-8 flex flex-col items-center justify-center text-center transition-all cursor-pointer ${
                isDragOver
                  ? 'border-[#58149C] bg-[#f3eaff] dark:bg-[#2a154b] scale-[0.998]'
                  : 'border-[#c9b6ea] dark:border-[#4b386b] bg-[#f8f1ff] dark:bg-[#160d29] hover:border-[#7135B5]'
              }`}
            >
              <div className="w-12 h-12 rounded-2xl bg-white dark:bg-[#261942] border border-[#e8ddff] dark:border-[#4b386b] shadow-[0_3px_0_#d8ccf3] dark:shadow-[0_3px_0_#160d29] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center mb-3">
                <Upload className="w-5 h-5" />
              </div>

              <h3 className="font-display text-sm sm:text-base font-extrabold text-[#1F1638] dark:text-white">
                Tarik &amp; Lepas Berkas CSV atau Excel (.xlsx) di Sini
              </h3>

              <p className="text-xs text-[#4B4452] dark:text-[#CABDE8] mt-1">
                Berkas aktif saat ini:{' '}
                <strong className="font-mono text-[#58149C] dark:text-[#DAB9FF]">{sourceFileName}</strong>
                {parseResult && (
                  <span className="ml-1 font-mono tabular-nums">
                    ({validationSummary.total} baris terdeteksi)
                  </span>
                )}
              </p>

              {/* Canonical Required Field Pills */}
              <div className="flex flex-wrap items-center justify-center gap-1.5 mt-4">
                {REQUIRED_FIELD_PILLS.map(fieldLabel => (
                  <span
                    key={fieldLabel}
                    className="px-2.5 py-1 rounded-lg text-[10.5px] font-semibold bg-white dark:bg-[#1e1238] border border-[#e8ddff] dark:border-[#3b1d78] text-[#4B4452] dark:text-[#CABDE8] shadow-[0_1.5px_0_#e8ddff] dark:shadow-none"
                  >
                    {fieldLabel}
                  </span>
                ))}
              </div>
            </div>

            {/* Integrated Text-to-Table Editor (auto-open when text loaded or toggled) */}
            {(showTextEditor || Boolean(rawText.trim())) && (
              <div className="pt-2 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#1F1638] dark:text-white flex items-center gap-1.5">
                    <ClipboardPaste className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                    <span>Editor Text-to-Table (Paste dari Excel / Pipe-Separated)</span>
                  </span>
                  <span className="text-[11px] font-mono text-[#7D7484] dark:text-[#A79BC0]">
                    Customer ID wajib 7 digit (^[0-9]&#123;7&#125;$)
                  </span>
                </div>

                <textarea
                  rows={5}
                  placeholder="|WO Number|Customer Name|ID Customer|Customer Phone|Area|Cluster Name|Contactor Name|Slot Time|Ticket Category|&#10;|WO20267399330|Haji Sulaiman|7399330|081299883344|Jakarta Selatan|Grand Melati Residence|PT Mitra Jaringan Solusi|09:00 - 11:00 WIB|New Installation FTTH|"
                  value={rawText}
                  onChange={e => {
                    setRawText(e.target.value);
                    setSourceFileName('Text_Input.txt');
                  }}
                  className="tactile-debossed-input w-full p-3 font-mono text-xs bg-[#f8f1ff] dark:bg-[#160d29] border border-[#d8ccf3] dark:border-[#3b1d78] rounded-xl text-[#1F1638] dark:text-white focus:outline-hidden focus:ring-2 focus:ring-[#7135B5]/30"
                />

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {rawText && (
                    <button
                      type="button"
                      onClick={() => {
                        setRawText('');
                        setParseResult(null);
                        setSourceFileName('Belum ada berkas');
                      }}
                      className="btn-3d-lilac px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      Kosongkan Teks
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleParse(undefined, true)}
                    disabled={!rawText.trim()}
                    className="btn-3d-primary px-4 py-2 disabled:opacity-40 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>1. Periksa Data</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 4 Validation KPI Bento Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Total Baris */}
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`card-3d-lavender text-left rounded-2xl p-4 flex flex-col justify-between min-h-[116px] transition-all cursor-pointer ${
                statusFilter === 'ALL' && parseResult ? 'ring-2 ring-[#58149C] dark:ring-[#DAB9FF]' : 'hover:border-[#a78bfa]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#4B4452] dark:text-[#CABDE8]">
                  TOTAL BARIS
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#f3eaff] dark:bg-[#2e1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                  <FileSpreadsheet className="w-4 h-4" />
                </span>
              </div>
              <div className="font-display text-3xl font-extrabold tabular-nums text-[#1F1638] dark:text-white leading-none my-1">
                {validationSummary.total}
              </div>
              <div className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                {parseResult ? '100% terbaca sistem' : 'Menunggu berkas / teks'}
              </div>
            </button>

            {/* Siap Import / Valid */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'VALID' ? 'ALL' : 'VALID')}
              className={`card-3d-lavender text-left rounded-2xl p-4 flex flex-col justify-between min-h-[116px] transition-all cursor-pointer ${
                statusFilter === 'VALID' ? 'ring-2 ring-[#58149C] dark:ring-[#DAB9FF]' : 'hover:border-[#a78bfa]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#4B4452] dark:text-[#CABDE8]">
                  SIAP IMPORT / VALID
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#f3eaff] dark:bg-[#2e1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </span>
              </div>
              <div className="font-display text-3xl font-extrabold tabular-nums text-[#58149C] dark:text-[#DAB9FF] leading-none my-1">
                {validationSummary.valid}
              </div>
              <div className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                {validationSummary.validPct}% lolos validasi
              </div>
            </button>

            {/* Duplikat / Peringatan */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'DUPLICATE' ? 'ALL' : 'DUPLICATE')}
              className={`card-3d-lavender text-left rounded-2xl p-4 flex flex-col justify-between min-h-[116px] transition-all cursor-pointer ${
                statusFilter === 'DUPLICATE' ? 'ring-2 ring-[#58149C] dark:ring-[#DAB9FF]' : 'hover:border-[#a78bfa]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#4B4452] dark:text-[#CABDE8]">
                  DUPLIKAT / PERINGATAN
                </span>
                <span className="w-8 h-8 rounded-xl bg-[#f3eaff] dark:bg-[#2e1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-4 h-4" />
                </span>
              </div>
              <div className="font-display text-3xl font-extrabold tabular-nums text-[#58149C] dark:text-[#DAB9FF] leading-none my-1">
                {validationSummary.duplicate}
              </div>
              <div className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                WO sudah terdaftar
              </div>
            </button>

            {/* Error Format / Kosong */}
            <button
              type="button"
              onClick={() => setStatusFilter(statusFilter === 'ERROR' ? 'ALL' : 'ERROR')}
              className={`card-3d-lavender text-left rounded-2xl p-4 flex flex-col justify-between min-h-[116px] transition-all cursor-pointer ${
                statusFilter === 'ERROR' ? 'ring-2 ring-[#BA1A1A] dark:ring-rose-400' : 'hover:border-rose-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#BA1A1A] dark:text-rose-300">
                  ERROR FORMAT / KOSONG
                </span>
                <span className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-[#BA1A1A] dark:text-rose-300 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-4 h-4" />
                </span>
              </div>
              <div className="font-display text-3xl font-extrabold tabular-nums text-[#BA1A1A] dark:text-rose-300 leading-none my-1">
                {validationSummary.error}
              </div>
              <div className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                Perlu perbaikan kolom
              </div>
            </button>
          </div>

          {/* Katalog Master Canonical Fields */}
          {showMappingCatalog && (
            <div className="card-3d-lavender rounded-2xl p-5 space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-[#e8ddff] dark:border-[#3b1d78] pb-2.5">
                <div>
                  <h4 className="font-display font-bold text-[#1F1638] dark:text-white flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />
                    <span>Katalog Master Canonical Field WOFieldMappingEngine ({MASTER_CANONICAL_FIELDS.length} Master Fields)</span>
                  </h4>
                  <p className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                    Baseline 46 kolom mencakup Identitas, Jadwal Appointment, Hardware Jaringan (OLT/FDT/FAT/ONT/STB), Kontraktor, Leader, dan Teknisi.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMappingCatalog(false)}
                  className="btn-3d-lilac px-3 py-1 rounded-lg text-xs font-bold cursor-pointer"
                >
                  Tutup
                </button>
              </div>

              <ResponsiveDataTable
                data={MASTER_CANONICAL_FIELDS}
                getRowKey={f => f.canonicalField}
                maxTableHeightClass="max-h-72"
                mobileTitle={f => <span className="font-mono text-[#58149C] dark:text-[#DAB9FF]">{f.canonicalField}</span>}
                mobileSubtitle={f => f.displayLabel}
                mobileStatus={f =>
                  f.required ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-[#BA1A1A] dark:bg-rose-950 dark:text-rose-300">
                      Wajib
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#f3eaff] text-[#4B4452] dark:bg-[#261942] dark:text-[#CABDE8]">
                      Opsional
                    </span>
                  )
                }
                columns={[
                  {
                    key: 'index',
                    label: '#',
                    priority: 'hidden_mobile',
                    numeric: true,
                    render: (_f, i) => <span className="text-[#7D7484]">{i + 1}</span>
                  },
                  {
                    key: 'canonicalField',
                    label: 'Canonical Field',
                    priority: 'primary',
                    numeric: true,
                    render: f => <span className="font-bold text-[#58149C] dark:text-[#DAB9FF]">{f.canonicalField}</span>
                  },
                  {
                    key: 'displayLabel',
                    label: 'Display Label',
                    priority: 'primary',
                    render: f => <span className="text-[#1F1638] dark:text-white">{f.displayLabel}</span>
                  },
                  {
                    key: 'category',
                    label: 'Kategori',
                    priority: 'secondary',
                    render: f => <span className="capitalize text-[#4B4452] dark:text-[#CABDE8]">{f.category}</span>
                  },
                  {
                    key: 'dataType',
                    label: 'Tipe Data',
                    priority: 'secondary',
                    numeric: true,
                    render: f => <span className="text-[#4B4452] dark:text-[#CABDE8]">{f.dataType}</span>
                  },
                  {
                    key: 'required',
                    label: 'Wajib',
                    priority: 'hidden_mobile',
                    render: f =>
                      f.required ? (
                        <span className="text-[#BA1A1A] font-bold">Wajib</span>
                      ) : (
                        <span className="text-[#7D7484]">Opsional</span>
                      )
                  },
                  {
                    key: 'aliases',
                    label: 'Alias Terverifikasi',
                    priority: 'secondary',
                    render: f => (
                      <span className="text-[10.5px] text-[#4B4452] dark:text-[#CABDE8] max-w-xs block truncate">
                        {f.aliases.join(', ')}
                      </span>
                    )
                  }
                ]}
              />
            </div>
          )}

          {/* Import Success Banner */}
          {importReport && (
            <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600" />
              <div>
                <p className="font-display font-bold text-sm">Proses Import Berhasil!</p>
                <p className="mt-0.5">
                  {importReport.imported} tiket baru berhasil ditambahkan ({importReport.distributedCount ?? 0} terdistribusi ke Leader
                  {(importReport.undistributedCount ?? 0) > 0 ? `, ${importReport.undistributedCount} Belum Terdistribusi` : ''}).
                  {importReport.enrolledContractors !== undefined && importReport.enrolledContractors > 0 && (
                    <span className="font-medium text-emerald-900 dark:text-emerald-200">
                      {' '}{importReport.enrolledContractors} kategori kontraktor ({importReport.newContractors || 0} baru) telah terdaftar di Master Data.
                    </span>
                  )}
                  {importReport.duplicates > 0 && (
                    <span className="block mt-1 text-amber-700 dark:text-amber-300 font-medium">
                      {importReport.duplicates} tiket dengan nomor WO yang sama (duplikat) otomatis ditolak demi menjaga keunikan data.
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Parse Preview Section */}
          {parseResult && (
            <>
              <div className="card-3d-lavender rounded-2xl p-5 sm:p-6 space-y-4">
                {/* Header + 4 Status Filter Pills */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#e8ddff] dark:border-[#3b1d78]">
                  <div>
                    <h3 className="font-display text-base font-extrabold text-[#1F1638] dark:text-white">
                      Preview &amp; Validasi Data WO
                    </h3>
                    <p className="text-xs text-[#4B4452] dark:text-[#CABDE8]">
                      Periksa status setiap baris sebelum mengeksekusi penyimpanan ke database produksi.
                    </p>
                  </div>

                  {/* Status Filter Tabs: Semua / Valid / Duplikat / Error */}
                  <div className="mj-tactile-tab-bar p-1 inline-flex flex-wrap items-center gap-1 self-start lg:self-auto">
                    <button
                      type="button"
                      onClick={() => setStatusFilter('ALL')}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                        statusFilter === 'ALL'
                          ? 'btn-3d-primary'
                          : 'text-[#4B4452] dark:text-[#CABDE8] hover:bg-white/75 dark:hover:bg-[#261942]'
                      }`}
                    >
                      Semua ({validationSummary.total})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('VALID')}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                        statusFilter === 'VALID'
                          ? 'btn-3d-primary'
                          : 'text-[#4B4452] dark:text-[#CABDE8] hover:bg-white/75 dark:hover:bg-[#261942]'
                      }`}
                    >
                      Valid ({validationSummary.valid})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('DUPLICATE')}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                        statusFilter === 'DUPLICATE'
                          ? 'btn-3d-primary'
                          : 'text-[#4B4452] dark:text-[#CABDE8] hover:bg-white/75 dark:hover:bg-[#261942]'
                      }`}
                    >
                      Duplikat ({validationSummary.duplicate})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter('ERROR')}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold cursor-pointer transition-all ${
                        statusFilter === 'ERROR'
                          ? 'btn-3d-crimson'
                          : 'text-[#BA1A1A] dark:text-rose-300 hover:bg-white/75 dark:hover:bg-[#261942]'
                      }`}
                    >
                      Error ({validationSummary.error})
                    </button>
                  </div>
                </div>

                {/* Critical Alert: Missing Mandatory Headers */}
                {(!parseResult.headerCheckPassed || (parseResult.missingMandatoryHeaders && parseResult.missingMandatoryHeaders.length > 0)) && (
                  <div className="p-4 bg-rose-50 dark:bg-rose-950/60 border-2 border-rose-400 dark:border-rose-800 rounded-xl text-rose-900 dark:text-rose-200 text-xs flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-[#BA1A1A] shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h5 className="font-bold text-sm text-[#BA1A1A] dark:text-rose-300">
                        HEADER WAJIB TIDAK DITEMUKAN - PROSES IMPORT DIHENTIKAN!
                      </h5>
                      <p>
                        Setiap baris data wajib memiliki 9 kolom: <strong>Customer ID, WO Number, Street Name, Cluster Name, FAT, FDT, Customer Phone, Contractor Name, Area</strong> serta <strong>Appointment Date</strong> yang valid.
                      </p>
                      <div className="mt-2 p-2 bg-rose-100 dark:bg-rose-900/60 rounded-lg font-mono font-bold text-[#BA1A1A] dark:text-rose-200">
                        Header wajib yang bermasalah / hilang: {parseResult.missingMandatoryHeaders?.join(', ')}
                      </div>
                    </div>
                  </div>
                )}

                {/* Unnamed & Unrecognized Headers Notification */}
                {parseResult.unrecognizedHeaders.length > 0 && (
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
                    <Info className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Kolom Khusus / Tanpa Nama Header Terdeteksi ({parseResult.unrecognizedHeaders.length}):</p>
                      <p className="mt-0.5">
                        Kolom: <span className="font-mono">{parseResult.unrecognizedHeaders.join(', ')}</span>. Seluruh nilai kolom disimpan utuh dalam <code className="font-mono text-xs">additionalFields</code> agar tidak ada data yang hilang.
                      </p>
                    </div>
                  </div>
                )}

                {/* Detected & Auto-Enrolled Contractors */}
                {parseResult.detectedContractors && parseResult.detectedContractors.length > 0 && (
                  <div className="p-4 rounded-xl border border-[#d8ccf3] dark:border-[#3b1d78] bg-[#f8f1ff] dark:bg-[#160d29] space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#e8ddff] dark:border-[#3b1d78]">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-b from-[#7135B5] to-[#58149C] text-white flex items-center justify-center shrink-0">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div>
                          <h5 className="font-bold text-[#1F1638] dark:text-white text-xs flex items-center gap-2 flex-wrap">
                            <span>Kategori Kontraktor Terdeteksi ({parseResult.detectedContractors.length} Mitra)</span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-[#e8ddff] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] font-bold">
                              Auto-Enrolled
                            </span>
                          </h5>
                          <p className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                            Mitra baru otomatis terdaftar ke Master Data MoraJaws saat import dieksekusi.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-2 bg-white dark:bg-[#1e1238] px-3 py-1.5 rounded-xl border border-[#e8ddff] dark:border-[#3b1d78]">
                          <span className="text-[11px] font-semibold text-[#1F1638] dark:text-white">
                            Auto-register Mitra Baru:
                          </span>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={autoRegisterNewContractors}
                              onChange={e => setAutoRegisterNewContractors(e.target.checked)}
                              className="sr-only peer"
                            />
                            <div className="w-8 h-4 bg-[#cec3d4] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#cec3d4] after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#58149C]"></div>
                          </label>
                          <span className={`text-[10px] font-bold ${autoRegisterNewContractors ? 'text-[#58149C] dark:text-[#DAB9FF]' : 'text-[#7D7484]'}`}>
                            {autoRegisterNewContractors ? 'ON' : 'OFF'}
                          </span>
                        </div>

                        {parseResult.detectedContractors.some(c => c.isNew) && (
                          <button
                            type="button"
                            onClick={handleEnrollContractorsNow}
                            className="btn-3d-emerald px-3 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer shrink-0"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Daftarkan Sekarang</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {contractorEnrollNotice && (
                      <div className="p-2.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2 font-medium">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>{contractorEnrollNotice}</span>
                      </div>
                    )}

                    <div className={`grid grid-cols-1 ${isCompactUI ? '' : 'sm:grid-cols-2 lg:grid-cols-3'} gap-3`}>
                      {parseResult.detectedContractors.map((c, cIdx) => (
                        <div
                          key={`detected-contractor-card-${c.id || c.name}-${cIdx}`}
                          className={`p-3 rounded-xl border text-xs bg-white dark:bg-[#1e1238] ${
                            c.isNew
                              ? 'border-emerald-300 dark:border-emerald-800 ring-1 ring-emerald-400/30'
                              : 'border-[#e8ddff] dark:border-[#3b1d78]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <div className="font-bold text-[#1F1638] dark:text-white truncate" title={c.name}>
                              {c.name}
                            </div>
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                c.isNew
                                  ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-[#f3eaff] dark:bg-[#2e1459] text-[#58149C] dark:text-[#DAB9FF]'
                              }`}
                            >
                              {c.isNew ? 'Baru' : 'Terdaftar'}
                            </span>
                          </div>
                          <div className="space-y-1 text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                            <div className="flex items-center justify-between">
                              <span className="text-[#7D7484]">Kode Vendor:</span>
                              <span className="font-mono font-bold text-[#58149C] dark:text-[#DAB9FF]">[{c.code}]</span>
                            </div>
                            <div className="flex items-start justify-between gap-1">
                              <span className="text-[#7D7484] shrink-0">Cakupan Area:</span>
                              <span className="font-medium text-[#1F1638] dark:text-white text-right truncate">
                                {c.coverageAreas.length > 0 ? c.coverageAreas.join(', ') : 'Semua Area'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-[#e8ddff] dark:border-[#3b1d78]">
                              <span className="text-[#7D7484]">Alokasi WO:</span>
                              <span className="font-bold text-[#1F1638] dark:text-white">{c.woCount} Work Orders</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Search & Category Filter Toolbar */}
                <div className="p-3 bg-[#f8f1ff] dark:bg-[#160d29] rounded-xl border border-[#e8ddff] dark:border-[#3b1d78] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Cari Kategori Tiket, WO, Pelanggan, Mitra..."
                        value={previewCategorySearch}
                        onChange={e => setPreviewCategorySearch(e.target.value)}
                        className="tactile-debossed-input w-full pl-8.5 pr-3 py-1.5 text-xs bg-white dark:bg-[#1e1238] border border-[#d8ccf3] dark:border-[#3b1d78] rounded-xl text-[#1F1638] dark:text-white"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-[#4B4452] dark:text-[#CABDE8] shrink-0">
                        Kategori:
                      </span>
                      <select
                        value={previewCategoryFilter}
                        onChange={e => setPreviewCategoryFilter(e.target.value)}
                        className="tactile-debossed-input px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-[#1e1238] border border-[#d8ccf3] dark:border-[#3b1d78] rounded-xl text-[#1F1638] dark:text-white"
                      >
                        <option value="ALL">Semua Kategori ({detectedTicketCategories.length})</option>
                        {detectedTicketCategories.map((cat: string) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      {(previewCategoryFilter !== 'ALL' || previewCategorySearch || statusFilter !== 'ALL') && (
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewCategoryFilter('ALL');
                            setPreviewCategorySearch('');
                            setStatusFilter('ALL');
                          }}
                          className="btn-3d-lilac px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer"
                        >
                          Reset Filter
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="text-[11px] text-[#4B4452] dark:text-[#CABDE8] shrink-0 self-end sm:self-auto font-mono tabular-nums">
                    Menampilkan <span className="font-bold text-[#58149C] dark:text-[#DAB9FF]">{displayedPreviewRows.length}</span> dari {parseResult.parsedRows.length} baris
                  </div>
                </div>

                {/* Responsive Preview Table */}
                <ResponsiveDataTable<ParsedRowData>
                  data={displayedPreviewRows}
                  getRowKey={row => String(row.rowIndex)}
                  maxTableHeightClass="max-h-96"
                  getRowClassName={row =>
                    !row.isValid || row.isDuplicate ? 'bg-rose-50/40 dark:bg-rose-950/20' : ''
                  }
                  mobileTitle={row => (
                    <span className="font-mono">
                      Baris #{row.rowIndex + 1} · {row.mapped.woNumber || '[WO Kosong]'}
                    </span>
                  )}
                  mobileSubtitle={row => row.mapped.customerName || row.mapped.contactorName || row.mapped.contractorName || undefined}
                  mobileStatus={row => {
                    const status = row.statusType || (row.isDuplicate ? 'WO DUPLIKAT' : row.isValid ? 'VALID' : 'DATA KOSONG');
                    if (status === 'VALID') {
                      return (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#f3eaff] text-[#58149C] dark:bg-emerald-950 dark:text-emerald-300 border border-[#e8ddff] dark:border-emerald-800">
                          <CheckCircle2 className="w-3 h-3" /> VALID
                        </span>
                      );
                    }
                    if (status === 'WO DUPLIKAT') {
                      return (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#f3eaff] text-[#7135B5] dark:bg-purple-950 dark:text-purple-300 border border-[#d8ccf3] dark:border-purple-800">
                          <AlertTriangle className="w-3 h-3" /> WO DUPLIKAT
                        </span>
                      );
                    }
                    if (status === 'HEADER TIDAK DITEMUKAN') {
                      return (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-[#4C1D95] dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                          <ShieldAlert className="w-3 h-3" /> HEADER TIDAK DITEMUKAN
                        </span>
                      );
                    }
                    if (status === 'DATA KOSONG') {
                      return (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                          <AlertCircle className="w-3 h-3" /> DATA KOSONG
                        </span>
                      );
                    }
                    return (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-[#BA1A1A] dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                        <AlertCircle className="w-3 h-3" /> FORMAT TIDAK VALID
                      </span>
                    );
                  }}
                  columns={
                    [
                      {
                        key: 'rowIndex',
                        label: 'NO',
                        priority: 'hidden_mobile',
                        numeric: true,
                        render: row => (
                          <span className="font-mono text-[#7D7484] dark:text-[#A79BC0] font-bold">
                            {String(row.rowIndex + 1).padStart(2, '0')}
                          </span>
                        )
                      },
                      {
                        key: 'woNumber',
                        label: 'WO NUMBER',
                        priority: 'primary',
                        numeric: true,
                        render: row =>
                          editingRowIndex === row.rowIndex ? (
                            <input
                              type="text"
                              value={editingRowData.woNumber || ''}
                              onChange={e => setEditingRowData({ ...editingRowData, woNumber: e.target.value })}
                              className="p-1.5 border border-[#d8ccf3] rounded-lg w-full sm:w-32 text-xs bg-white dark:bg-[#160d29]"
                            />
                          ) : (
                            <span
                              className={`font-mono font-bold ${
                                !row.isValid && !row.isDuplicate ? 'text-[#BA1A1A] dark:text-rose-300' : 'text-[#58149C] dark:text-[#DAB9FF]'
                              }`}
                            >
                              {row.mapped.woNumber || <span className="text-[#BA1A1A] font-bold">[Kosong]</span>}
                            </span>
                          )
                      },
                      {
                        key: 'customer',
                        label: 'PELANGGAN',
                        priority: 'primary',
                        render: row =>
                          editingRowIndex === row.rowIndex ? (
                            <div className="space-y-1">
                              <input
                                type="text"
                                maxLength={7}
                                value={editingRowData.idCustomer || ''}
                                onChange={e => setEditingRowData({ ...editingRowData, idCustomer: e.target.value })}
                                placeholder="ID 7 digit"
                                className="p-1 border border-[#d8ccf3] rounded-lg w-full sm:w-28 text-xs bg-white dark:bg-[#160d29]"
                              />
                              <input
                                type="text"
                                value={editingRowData.customerPhone || ''}
                                onChange={e => setEditingRowData({ ...editingRowData, customerPhone: e.target.value })}
                                placeholder="Telepon"
                                className="p-1 border border-[#d8ccf3] rounded-lg w-full sm:w-28 text-xs bg-white dark:bg-[#160d29]"
                              />
                            </div>
                          ) : (
                            <div>
                              <div className="font-bold text-[#1F1638] dark:text-white">
                                {row.mapped.customerName || <span className="text-[#BA1A1A]">[Nama Kosong]</span>}
                              </div>
                              <div className="text-[11px] font-mono text-[#7D7484] dark:text-[#A79BC0]">
                                <span className={row.mapped.idCustomer?.length === 7 ? 'text-[#58149C] dark:text-[#DAB9FF] font-semibold' : 'text-[#BA1A1A] font-bold'}>
                                  {row.mapped.idCustomer || '[ID Kosong]'}
                                </span>
                                {' · '}
                                {row.mapped.customerPhone || '[No HP Kosong]'}
                              </div>
                            </div>
                          )
                      },
                      {
                        key: 'areaCluster',
                        label: 'AREA / CLUSTER & MITRA',
                        priority: 'secondary',
                        render: row =>
                          editingRowIndex === row.rowIndex ? (
                            <div className="space-y-1">
                              <input
                                type="text"
                                value={editingRowData.area || ''}
                                onChange={e => setEditingRowData({ ...editingRowData, area: e.target.value })}
                                placeholder="Area"
                                className="p-1 border border-[#d8ccf3] rounded-lg w-full sm:w-32 text-xs bg-white dark:bg-[#160d29]"
                              />
                              <input
                                type="text"
                                value={editingRowData.clusterName || ''}
                                onChange={e => setEditingRowData({ ...editingRowData, clusterName: e.target.value })}
                                placeholder="Cluster"
                                className="p-1 border border-[#d8ccf3] rounded-lg w-full sm:w-32 text-xs bg-white dark:bg-[#160d29]"
                              />
                              <input
                                type="text"
                                value={editingRowData.contactorName || ''}
                                onChange={e => setEditingRowData({ ...editingRowData, contactorName: e.target.value })}
                                placeholder="Kontraktor"
                                className="p-1 border border-[#d8ccf3] rounded-lg w-full sm:w-32 text-xs bg-white dark:bg-[#160d29]"
                              />
                            </div>
                          ) : (
                            <div>
                              <div className="font-medium text-[#1F1638] dark:text-white">
                                {row.mapped.area || <span className="text-[#BA1A1A] font-bold">[Area Kosong]</span>}
                                {row.mapped.clusterName ? ` / ${row.mapped.clusterName}` : ''}
                              </div>
                              <div className="text-[11px] text-[#7D7484] dark:text-[#A79BC0]">
                                {row.mapped.contactorName || row.mapped.contractorName || '[Mitra Kosong]'}
                                {(row.mapped.fatCode || row.mapped.fdtCode) && ` · ${row.mapped.fatCode || row.mapped.fdtCode}`}
                              </div>
                            </div>
                          )
                      },
                      {
                        key: 'appointmentDate',
                        label: 'TANGGAL JANJI',
                        priority: 'secondary',
                        render: row =>
                          editingRowIndex === row.rowIndex ? (
                            <input
                              type="date"
                              value={editingRowData.appointmentDate || ''}
                              onChange={e => setEditingRowData({ ...editingRowData, appointmentDate: e.target.value })}
                              className="p-1 border border-[#d8ccf3] rounded-lg w-full sm:w-auto text-xs bg-white dark:bg-[#160d29]"
                            />
                          ) : (
                            <div>
                              <div className="font-semibold text-[#1F1638] dark:text-[#E9D5FF] font-mono tabular-nums">
                                {row.mapped.appointmentDate || <span className="text-[#BA1A1A] font-bold">[Kosong]</span>}
                              </div>
                              {row.mapped.slotTime && (
                                <div className="text-[10.5px] text-[#7D7484]">{row.mapped.slotTime}</div>
                              )}
                            </div>
                          )
                      },
                      {
                        key: 'status',
                        label: 'STATUS VALIDASI',
                        priority: 'hidden_mobile',
                        render: row => {
                          const status = row.statusType || (row.isDuplicate ? 'WO DUPLIKAT' : row.isValid ? 'VALID' : 'DATA KOSONG');
                          return status === 'VALID' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#f3eaff] text-[#58149C] dark:bg-emerald-950 dark:text-emerald-300 border border-[#e8ddff] dark:border-emerald-800 whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#7135B5] dark:bg-emerald-400" />
                              VALID
                            </span>
                          ) : status === 'WO DUPLIKAT' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#f3eaff] text-[#7135B5] dark:bg-purple-950 dark:text-purple-300 border border-[#d8ccf3] dark:border-purple-800 whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#A380FE]" />
                              WO DUPLIKAT
                            </span>
                          ) : status === 'HEADER TIDAK DITEMUKAN' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-[#4C1D95] dark:bg-purple-950 dark:text-purple-300 border border-purple-300 dark:border-purple-800 whitespace-nowrap">
                              <ShieldAlert className="w-3 h-3" />
                              HEADER HILANG
                            </span>
                          ) : status === 'DATA KOSONG' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800 whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                              DATA KOSONG
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-rose-50 text-[#BA1A1A] dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800 whitespace-nowrap">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#BA1A1A]" />
                              ERROR FORMAT
                            </span>
                          );
                        }
                      },
                      {
                        key: 'problematicColumns',
                        label: 'KETERANGAN',
                        priority: 'primary',
                        render: row =>
                          row.isValid && !row.isDuplicate ? (
                            <span className="text-[11px] font-medium text-[#4B4452] dark:text-[#CABDE8]">
                              Siap diproses ke sistem dispatch
                            </span>
                          ) : (
                            <div className={`text-[11px] font-semibold max-w-xs ${row.isDuplicate ? 'text-[#58149C] dark:text-[#DAB9FF]' : 'text-[#BA1A1A] dark:text-rose-300'}`}>
                              {row.validationErrors[0] || (row.problematicColumns?.length ? `Periksa: ${row.problematicColumns.join(', ')}` : 'Perlu perbaikan kolom')}
                            </div>
                          )
                      },
                      {
                        key: 'streetName',
                        label: 'ALAMAT',
                        priority: 'secondary',
                        render: row =>
                          editingRowIndex === row.rowIndex ? (
                            <input
                              type="text"
                              value={editingRowData.streetName || ''}
                              onChange={e => setEditingRowData({ ...editingRowData, streetName: e.target.value })}
                              placeholder="Alamat / Street Name"
                              className="p-1 border border-[#d8ccf3] rounded-lg w-full sm:w-44 text-xs bg-white dark:bg-[#160d29]"
                            />
                          ) : (
                            <span className="max-w-[180px] block truncate text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                              {row.mapped.streetName || <span className="text-[#BA1A1A] font-bold">[Kosong]</span>}
                            </span>
                          )
                      }
                    ] as ResponsiveColumn<ParsedRowData>[]
                  }
                  getRowActions={row =>
                    editingRowIndex === row.rowIndex
                      ? [
                          {
                            id: 'save',
                            label: 'Simpan Perbaikan',
                            icon: <Check className="w-3.5 h-3.5" />,
                            tone: 'success',
                            onClick: () => handleSaveEditRow(row.rowIndex)
                          },
                          {
                            id: 'cancel',
                            label: 'Batal Edit',
                            icon: <X className="w-3.5 h-3.5" />,
                            onClick: () => setEditingRowIndex(null)
                          }
                        ]
                      : [
                          {
                            id: 'edit',
                            label: 'Edit Baris',
                            icon: <Edit className="w-3.5 h-3.5" />,
                            onClick: () => handleStartEditRow(row)
                          },
                          {
                            id: 'delete',
                            label: 'Hapus Baris',
                            icon: <Trash2 className="w-3.5 h-3.5" />,
                            tone: 'danger',
                            onClick: () => handleDeleteRow(row.rowIndex)
                          }
                        ]
                  }
                  renderDesktopActions={row =>
                    editingRowIndex === row.rowIndex ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSaveEditRow(row.rowIndex)}
                          className="btn-3d-emerald px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                          title="Simpan perbaikan data"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          <span>Simpan</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingRowIndex(null)}
                          className="btn-3d-lilac px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer"
                          title="Batalkan edit"
                        >
                          Batal
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => handleStartEditRow(row)}
                          className="btn-3d-icon p-1.5 cursor-pointer"
                          title="Edit data baris ini"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRow(row.rowIndex)}
                          className="btn-3d-icon p-1.5 text-[#BA1A1A] hover:text-[#BA1A1A] cursor-pointer"
                          title="Hapus baris data ini"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )
                  }
                />
              </div>

              {/* Bottom Batch Confirmation Card (Stitch Screenshot 2 Style) */}
              <div
                ref={batchConfirmSectionRef}
                className="card-3d-lavender rounded-2xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 scroll-mt-20"
              >
                <div className="flex items-start sm:items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#f3eaff] dark:bg-[#2e1459] text-[#58149C] dark:text-[#DAB9FF] border border-[#e8ddff] dark:border-[#5b35b1] flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-display font-extrabold text-sm text-[#1F1638] dark:text-white">
                      Konfirmasi Eksekusi Batch
                    </h4>
                    <p className="text-xs text-[#4B4452] dark:text-[#CABDE8] mt-0.5">
                      Hanya <strong className="font-mono text-[#58149C] dark:text-[#DAB9FF]">{validationSummary.valid} baris berstatus VALID</strong> yang akan diproses ke sistem dispatch &amp; Supabase PostgreSQL.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    disabled={
                      parseResult.headerCheckPassed === false ||
                      (parseResult.missingMandatoryHeaders && parseResult.missingMandatoryHeaders.length > 0) ||
                      validationSummary.valid === 0
                    }
                    onClick={() => setShowConfirmModal(true)}
                    className="btn-3d-primary min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Proses &amp; Simpan {validationSummary.valid} WO Valid</span>
                  </button>

                  <button
                    type="button"
                    disabled={validationSummary.error + validationSummary.duplicate === 0}
                    onClick={handleDownloadErrorReport}
                    className="btn-3d-lilac min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <FileWarning className="w-3.5 h-3.5" />
                    <span>Unduh Laporan Error</span>
                  </button>

                  {rawText.trim() && (
                    <button
                      type="button"
                      onClick={() => handleParse()}
                      className="btn-3d-lilac min-h-[40px] px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Periksa Ulang</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleResetWorkspace}
                    className="btn-3d-crimson min-h-[40px] px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Batalkan Batch</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Riwayat Import Terakhir Card (100% Real Data from Tickets & AuditLogs) */}
          <div className="card-3d-lavender rounded-2xl p-5 space-y-3.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display font-extrabold text-sm text-[#1F1638] dark:text-white flex items-center gap-2">
                <History className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />
                <span>Riwayat Import Terakhir</span>
              </h4>
              <span className="font-mono text-[10.5px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A79BC0]">
                LOG SUPERADMIN &amp; DATA
              </span>
            </div>

            {recentImportBatches.length === 0 ? (
              <div className="p-5 rounded-xl bg-[#f8f1ff] dark:bg-[#160d29] border border-[#e8ddff] dark:border-[#3b1d78] text-center text-xs text-[#7D7484] dark:text-[#A79BC0] flex flex-col items-center gap-1.5">
                <Inbox className="w-5 h-5 text-[#58149C] dark:text-[#DAB9FF] opacity-75" />
                <span>Belum ada riwayat batch import yang tercatat pada database aktif saat ini.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {recentImportBatches.map(batch => (
                  <div
                    key={batch.key}
                    className="p-3.5 rounded-xl bg-[#f8f1ff] dark:bg-[#160d29] border border-[#e8ddff] dark:border-[#3b1d78] flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white dark:bg-[#261942] border border-[#e8ddff] dark:border-[#4b386b] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                        <FileSpreadsheet className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-display font-bold text-xs text-[#1F1638] dark:text-white truncate">
                          {batch.label}
                        </div>
                        <div className="text-[11px] text-[#7D7484] dark:text-[#A79BC0] truncate">
                          {new Date(batch.timeLabel).toLocaleString('id-ID', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}{' '}
                          • oleh {batch.performer}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-1">
                      <span className="inline-block px-2 py-0.5 rounded-full text-[9.5px] font-extrabold uppercase bg-[#f3eaff] text-[#58149C] dark:bg-emerald-950/70 dark:text-emerald-300 border border-[#e8ddff] dark:border-emerald-800">
                        {batch.statusLabel}
                      </span>
                      {batch.count > 0 && (
                        <div className="text-xs font-extrabold font-mono tabular-nums text-[#58149C] dark:text-[#DAB9FF]">
                          {batch.count} WO Masuk
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Confirmation Modal */}
          {parseResult && (
            <ResponsiveModal
              isOpen={showConfirmModal}
              onClose={() => {
                if (!isExecutingImport) setShowConfirmModal(false);
              }}
              closeOnBackdropClick={!isExecutingImport}
              size="md"
              mobileVariant="sheet"
              zIndexClass="z-70"
              icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              title="Konfirmasi Import Work Order"
              subtitle="Periksa ringkasan validasi sebelum data disimpan permanen ke database"
              footer={
                <div className="w-full flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                  <button
                    type="button"
                    disabled={isExecutingImport}
                    onClick={() => setShowConfirmModal(false)}
                    className="btn-3d-lilac px-4 py-2 rounded-xl cursor-pointer font-bold disabled:opacity-50 text-xs min-h-[38px]"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    disabled={isExecutingImport}
                    onClick={async () => {
                      setIsExecutingImport(true);
                      try {
                        await handleExecuteImport();
                      } finally {
                        setIsExecutingImport(false);
                      }
                    }}
                    className="btn-3d-emerald px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 cursor-pointer text-xs disabled:opacity-60 disabled:cursor-not-allowed min-h-[38px]"
                  >
                    {isExecutingImport ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Menyimpan ke Database...</span>
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 stroke-[3]" />
                        <span>Konfirmasi &amp; Simpan ({validationSummary.valid} WO Valid)</span>
                      </>
                    )}
                  </button>
                </div>
              }
            >
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div className="p-2.5 bg-[#f8f1ff] dark:bg-[#160d29] border border-[#e8ddff] dark:border-[#3b1d78] rounded-xl">
                    <div className="text-[10.5px] text-[#7D7484]">Total Baris Dibaca</div>
                    <div className="text-base font-extrabold text-[#1F1638] dark:text-white">{parseResult.parsedRows.length}</div>
                  </div>
                  <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                    <div className="text-[10.5px] text-emerald-700 dark:text-emerald-300">Baris Valid</div>
                    <div className="text-base font-extrabold text-emerald-700 dark:text-emerald-300">
                      {validationSummary.valid}
                    </div>
                  </div>
                  <div className="p-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl">
                    <div className="text-[10.5px] text-amber-700 dark:text-amber-300">Gagal Validasi</div>
                    <div className="text-base font-extrabold text-amber-700 dark:text-amber-300">{parseResult.problematicCount}</div>
                  </div>
                  <div className="p-2.5 bg-[#f3eaff] dark:bg-[#2a154b] border border-[#d8ccf3] dark:border-[#5b35b1] rounded-xl">
                    <div className="text-[10.5px] text-[#58149C] dark:text-[#DAB9FF]">Kontraktor Baru</div>
                    <div className="text-base font-extrabold text-[#58149C] dark:text-[#DAB9FF]">
                      {parseResult.detectedContractors?.filter(c => c.isNew).length || newContractorsFound.length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-xl">
                    <div className="text-[10.5px] text-purple-700 dark:text-purple-300">Kontraktor Terdaftar</div>
                    <div className="text-base font-extrabold text-purple-700 dark:text-purple-300">
                      {parseResult.detectedContractors?.filter(c => !c.isNew).length || 0}
                    </div>
                  </div>
                  <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl">
                    <div className="text-[10.5px] text-[#BA1A1A] dark:text-rose-300">Data Duplikat</div>
                    <div className="text-base font-extrabold text-[#BA1A1A] dark:text-rose-300">{parseResult.duplicateCount}</div>
                  </div>
                </div>

                <div className="p-3 bg-[#f8f1ff] dark:bg-[#160d29] rounded-xl border border-[#e8ddff] dark:border-[#3b1d78] space-y-1.5 text-xs">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[#7D7484]">File Sumber:</span>
                    <span className="font-mono font-bold text-[#1F1638] dark:text-white truncate">{sourceFileName}</span>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[#7D7484]">Operator:</span>
                    <span className="font-bold text-[#1F1638] dark:text-white truncate">{currentUser.name} ({currentUser.role})</span>
                  </div>
                </div>

                {parseResult.unrecognizedHeaders && parseResult.unrecognizedHeaders.length > 0 && (
                  <div className="p-3 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs space-y-1">
                    <div className="font-bold text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Header Tidak Terpetakan ({parseResult.unrecognizedHeaders.length}):</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {parseResult.unrecognizedHeaders.map(h => (
                        <span key={h} className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 rounded text-[10.5px] font-mono">
                          {h}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {((parseResult.detectedContractors && parseResult.detectedContractors.length > 0) || newContractorsFound.length > 0) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#1F1638] dark:text-white flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                        <span>Daftar Kontraktor Terdeteksi:</span>
                      </span>
                      <span className="text-[11px] text-[#7D7484]">
                        {parseResult.detectedContractors?.length || newContractorsFound.length} Mitra
                      </span>
                    </div>
                    <div className="max-h-36 overflow-y-auto p-2.5 bg-[#f8f1ff] dark:bg-[#160d29] rounded-xl border border-[#e8ddff] dark:border-[#3b1d78] flex flex-wrap gap-1.5">
                      {parseResult.detectedContractors && parseResult.detectedContractors.length > 0
                        ? parseResult.detectedContractors.map((c, cIdx) => (
                            <span
                              key={`modal-detected-cont-${c.id || c.name}-${cIdx}`}
                              className={`px-2 py-1 rounded-lg text-[11px] font-medium flex items-center gap-1 ${
                                c.isNew
                                  ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                  : 'bg-[#e8ddff] dark:bg-[#2e1459] text-[#58149C] dark:text-[#DAB9FF]'
                              }`}
                            >
                              <span>{c.name}</span>
                              {c.isNew && <span className="font-bold text-[9.5px] text-emerald-600 dark:text-emerald-400 uppercase">(Baru)</span>}
                              <span className="text-[10px] opacity-75">· {c.woCount || 1} WO</span>
                            </span>
                          ))
                        : newContractorsFound.map((c: any, cIdx: number) => (
                            <span
                              key={`modal-new-cont-${c.name}-${cIdx}`}
                              className="px-2 py-1 rounded-lg text-[11px] font-medium bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 flex items-center gap-1"
                            >
                              <span>{c.name}</span>
                              <span className="font-bold text-[9.5px] uppercase">(Baru)</span>
                              <span className="text-[10px] opacity-75">· {c.woCount} WO</span>
                            </span>
                          ))}
                    </div>
                  </div>
                )}

                <div className="p-3 bg-[#f3eaff] dark:bg-[#2a154b] border border-[#d8ccf3] dark:border-[#5b35b1] rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF] shrink-0" />
                      <span className="font-bold text-[#1F1638] dark:text-white text-xs">
                        Pendaftaran Otomatis Kontraktor Baru
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={autoRegisterNewContractors}
                        onChange={e => setAutoRegisterNewContractors(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-[#cec3d4] dark:bg-[#342b4e] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#cec3d4] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#58149C]"></div>
                    </label>
                  </div>
                  <p className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                    {autoRegisterNewContractors
                      ? 'Aktif — Kontraktor yang belum ada di master data akan langsung didaftarkan otomatis saat import disimpan.'
                      : 'Nonaktif — Kontraktor baru tidak ditambahkan ke Master Database.'}
                  </p>
                </div>

                <div className="p-3 bg-[#f8f1ff] dark:bg-[#160d29] rounded-xl border border-[#e8ddff] dark:border-[#3b1d78] space-y-2">
                  <span className="font-bold text-[#1F1638] dark:text-white text-xs block">
                    Kebijakan Duplikasi Nomor WO:
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label
                      className={`p-2.5 rounded-xl border text-[11px] cursor-pointer flex items-center gap-2 transition-colors ${
                        duplicatePolicy === 'skip'
                          ? 'bg-white dark:bg-[#1e1238] border-[#58149C] font-bold text-[#58149C] dark:text-[#DAB9FF] ring-1 ring-[#58149C]/30'
                          : 'bg-[#f8f1ff] dark:bg-[#160d29] border-[#e8ddff] dark:border-[#3b1d78] text-[#4B4452] dark:text-[#CABDE8]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="dupPolicy"
                        checked={duplicatePolicy === 'skip'}
                        onChange={() => setDuplicatePolicy('skip')}
                        className="text-[#58149C]"
                      />
                      <span>Lewati Duplikat (Skip)</span>
                    </label>
                    <label
                      className={`p-2.5 rounded-xl border text-[11px] cursor-pointer flex items-center gap-2 transition-colors ${
                        duplicatePolicy === 'update_allowed'
                          ? 'bg-white dark:bg-[#1e1238] border-[#58149C] font-bold text-[#58149C] dark:text-[#DAB9FF] ring-1 ring-[#58149C]/30'
                          : 'bg-[#f8f1ff] dark:bg-[#160d29] border-[#e8ddff] dark:border-[#3b1d78] text-[#4B4452] dark:text-[#CABDE8]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="dupPolicy"
                        checked={duplicatePolicy === 'update_allowed'}
                        onChange={() => setDuplicatePolicy('update_allowed')}
                        className="text-[#58149C]"
                      />
                      <span>Perbarui WO (Update)</span>
                    </label>
                  </div>
                </div>
              </div>
            </ResponsiveModal>
          )}
        </div>
      )}

      {/* ============================================================ */}
      {/* TAB 3: HISTORY & DELETE IMPORT (7-DAY RETENTION - MGMT DATA) */}
      {/* ============================================================ */}
      {mainTab === 'history_delete' && isManagementData && (
        <div className="space-y-5">
          <div className="card-3d-lavender rounded-2xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#e8ddff] dark:border-[#3b1d78] pb-4">
              <div>
                <h3 className="font-display text-sm sm:text-base font-extrabold text-[#1F1638] dark:text-white flex items-center gap-2">
                  <History className="w-4 h-4 text-[#BA1A1A]" />
                  <span>Riwayat &amp; Hapus Data Import per Tanggal</span>
                </h3>
                <p className="text-xs text-[#4B4452] dark:text-[#CABDE8] mt-1">
                  Filter dan hapus data tiket hasil import berdasarkan tanggal import. Batas rentang data yang dapat dihapus adalah <strong>maksimal 7 hari kalender</strong> sejak data diimpor.
                </p>
              </div>

              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 rounded-xl text-amber-800 dark:text-amber-300 text-xs font-bold">
                <Lock className="w-3.5 h-3.5 shrink-0" />
                <span>Aturan Retensi: Maksimal 7 Hari</span>
              </div>
            </div>

            <div className="p-4 bg-[#f8f1ff] dark:bg-[#160d29] rounded-xl border border-[#e8ddff] dark:border-[#3b1d78] flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-[#1F1638] dark:text-white mb-1">
                  Pilih / Filter Tanggal Import untuk Dihapus
                </label>
                <input
                  type="date"
                  value={selectedPurgeDate}
                  onChange={e => setSelectedPurgeDate(e.target.value)}
                  className="tactile-debossed-input w-full px-3 py-2 text-xs border border-[#d8ccf3] dark:border-[#3b1d78] rounded-xl bg-white dark:bg-[#1e1238] text-[#1F1638] dark:text-white"
                />
              </div>

              {selectedPurgeDate && (
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const count = tickets.filter(t => (t.importDate === selectedPurgeDate || t.date === selectedPurgeDate) && !t.isArchived).length;
                      if (count === 0) {
                        showToast(`Tidak ada data tiket hasil import pada tanggal ${selectedPurgeDate}.`, 'info');
                        return;
                      }
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      const target = new Date(selectedPurgeDate);
                      target.setHours(0, 0, 0, 0);
                      const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));

                      if (diffDays > 7) {
                        showToast(`Tanggal ${selectedPurgeDate} berjarak ${diffDays} hari lalu (melebihi batas retensi 7 hari). Data terkunci dan tidak dapat dihapus massal.`, 'error');
                        return;
                      }

                      setDateToPurge(selectedPurgeDate);
                      setPurgeCount(count);
                      setPurgeReason('');
                      setPurgeConfirmPhrase('');
                      setShowPurgeModal(true);
                    }}
                    className="btn-3d-crimson px-4 py-2 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus Data Tanggal Ini</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPurgeDate('')}
                    className="btn-3d-lilac px-3 py-2 text-xs rounded-xl font-bold cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-extrabold text-[#4B4452] dark:text-[#CABDE8] uppercase tracking-wider">
                Daftar Tanggal Import Tersimpan di Sistem
              </h4>

              {(() => {
                const dateMap: Record<string, number> = {};
                for (const t of tickets) {
                  if (t.isArchived) continue;
                  const d = t.importDate || t.date || new Date().toISOString().slice(0, 10);
                  dateMap[d] = (dateMap[d] || 0) + 1;
                }

                const sortedDates = Object.keys(dateMap).sort((a, b) => b.localeCompare(a));
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                if (sortedDates.length === 0) {
                  return (
                    <div className="p-6 text-center text-[#7D7484] italic text-xs border border-[#e8ddff] dark:border-[#3b1d78] rounded-xl">
                      Belum ada data tiket yang tersimpan di sistem.
                    </div>
                  );
                }

                return (
                  <div className="border border-[#e8ddff] dark:border-[#3b1d78] rounded-xl overflow-hidden divide-y divide-[#e8ddff] dark:divide-[#3b1d78]">
                    {sortedDates.map(dateStr => {
                      const count = dateMap[dateStr];
                      const target = new Date(dateStr);
                      target.setHours(0, 0, 0, 0);
                      const diffDays = Math.round((today.getTime() - target.getTime()) / (1000 * 60 * 60 * 24));
                      const isEligible = diffDays >= 0 && diffDays <= 7;

                      return (
                        <div
                          key={dateStr}
                          className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#f8f1ff] dark:hover:bg-[#160d29] transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                                isEligible
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600'
                                  : 'bg-[#f3eaff] dark:bg-[#261942] text-[#7D7484]'
                              }`}
                            >
                              <Calendar className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="font-bold text-[#1F1638] dark:text-white text-xs flex items-center gap-2 flex-wrap">
                                <span className="font-mono">{dateStr}</span>
                                {isEligible ? (
                                  <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                    <Unlock className="w-3 h-3" />
                                    <span>Dalam Rentang 7 Hari ({diffDays === 0 ? 'Hari Ini' : `${diffDays} hari lalu`})</span>
                                  </span>
                                ) : (
                                  <span className="text-[10px] bg-[#f3eaff] dark:bg-[#261942] text-[#7D7484] dark:text-[#A79BC0] px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                                    <Lock className="w-3 h-3" />
                                    <span>Terkunci ({diffDays} hari lalu, &gt; 7 hari)</span>
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-[#4B4452] dark:text-[#CABDE8] mt-0.5">
                                Total {count} data Work Order tersimpan pada tanggal ini.
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 self-end sm:self-auto">
                            {isEligible ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setDateToPurge(dateStr);
                                  setPurgeCount(count);
                                  setPurgeReason('');
                                  setPurgeConfirmPhrase('');
                                  setShowPurgeModal(true);
                                }}
                                className="btn-3d-crimson px-3 py-1.5 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Hapus Data Import ({count} WO)</span>
                              </button>
                            ) : (
                              <span
                                title="Data telah melewati batas retensi 7 hari kalender dan dilindungi dari penghapusan massal"
                                className="px-3 py-1.5 bg-[#f8f1ff] dark:bg-[#160d29] text-[#7D7484] text-xs rounded-xl border border-[#e8ddff] dark:border-[#3b1d78] flex items-center gap-1.5 cursor-not-allowed"
                              >
                                <Lock className="w-3.5 h-3.5" />
                                <span>Terkunci (Proteksi Audit)</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Deleting Imported Data by Date - Strictly Management Data */}
      {dateToPurge && isManagementData && (
        <ResponsiveModal
          isOpen={showPurgeModal}
          onClose={() => {
            setShowPurgeModal(false);
            setDateToPurge(null);
          }}
          size="sm"
          mobileVariant="sheet"
          zIndexClass="z-70"
          icon={<Trash2 className="w-5 h-5 text-[#BA1A1A]" />}
          title="Konfirmasi Hapus Data Import"
          subtitle={
            <>
              Tanggal Import: <span className="font-semibold text-[#BA1A1A] dark:text-rose-400">{dateToPurge}</span>
            </>
          }
          footer={
            <div className="w-full flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPurgeModal(false);
                  setDateToPurge(null);
                }}
                className="btn-3d-lilac px-3.5 py-1.5 text-xs font-bold rounded-xl cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={!purgeReason.trim() || purgeConfirmPhrase.trim() !== 'HAPUS IMPORT'}
                onClick={() => {
                  const res = deleteImportedTicketsByDate(dateToPurge, purgeReason.trim());
                  if (res.success) {
                    showToast(`Berhasil menghapus ${res.count} data tiket hasil import pada tanggal ${dateToPurge}.`, 'success');
                    setShowPurgeModal(false);
                    setDateToPurge(null);
                  } else {
                    showToast(res.error || 'Gagal menghapus data import.', 'error');
                  }
                }}
                className="btn-3d-crimson px-4 py-2 disabled:opacity-40 font-bold rounded-xl flex items-center gap-1.5 text-xs cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Ya, Hapus Data Import ({purgeCount} WO)</span>
              </button>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-rose-900 dark:text-rose-200 leading-relaxed text-[11px]">
              Tindakan ini akan menghapus <strong>{purgeCount} Work Order</strong> yang diimpor pada tanggal {dateToPurge}. Penghapusan ini dicatat pada audit log resmi.
            </div>

            <div>
              <label className="block font-bold text-[#1F1638] dark:text-white mb-1">
                Alasan Penghapusan (Wajib diisi):
              </label>
              <textarea
                rows={2}
                placeholder="misal: Salah input file import, data duplikat dari vendor..."
                value={purgeReason}
                onChange={e => setPurgeReason(e.target.value)}
                className="tactile-debossed-input w-full p-2.5 border border-[#d8ccf3] dark:border-[#3b1d78] rounded-xl bg-[#f8f1ff] dark:bg-[#160d29] text-[#1F1638] dark:text-white"
              />
            </div>

            <div>
              <label className="block font-bold text-[#1F1638] dark:text-white mb-1">
                Ketik <span className="font-mono text-[#BA1A1A] font-bold">HAPUS IMPORT</span> untuk konfirmasi:
              </label>
              <input
                type="text"
                placeholder="HAPUS IMPORT"
                value={purgeConfirmPhrase}
                onChange={e => setPurgeConfirmPhrase(e.target.value)}
                className="tactile-debossed-input w-full px-3 py-2 border border-[#d8ccf3] dark:border-[#3b1d78] rounded-xl bg-[#f8f1ff] dark:bg-[#160d29] text-[#1F1638] dark:text-white font-mono"
              />
            </div>
          </div>
        </ResponsiveModal>
      )}

      {/* ============================================================ */}
      {/* TAB 2: EXPORT WORK ORDER & TEMPLATES                         */}
      {/* ============================================================ */}
      {mainTab === 'export' && (
        <div className="space-y-5">
          <div className="card-3d-lavender rounded-2xl p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#e8ddff] dark:border-[#3b1d78]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-b from-[#7135B5] to-[#58149C] text-white flex items-center justify-center font-bold shadow-[0_2px_0_#35105E] shrink-0">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-sm sm:text-base font-extrabold text-[#1F1638] dark:text-white">
                    Pusat Ekspor Data Work Order &amp; Template Blank Lapangan
                  </h3>
                  <p className="text-xs text-[#4B4452] dark:text-[#CABDE8] mt-0.5">
                    Ekspor seluruh data Work Order ke format Excel (.xlsx) atau CSV deterministik, serta unduh template penugasan Korlap &amp; Teknisi.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-[#4B4452] dark:text-[#CABDE8]">Total Tiket Tersimpan:</span>
                <span className="px-3 py-1 rounded-full bg-[#f3eaff] dark:bg-[#2e1459] font-mono font-bold text-xs text-[#58149C] dark:text-[#DAB9FF] border border-[#e8ddff] dark:border-[#5b35b1]">
                  {tickets.filter(t => !t.isArchived).length} WO
                </span>
              </div>
            </div>

            {exportNotice && (
              <div className="mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{exportNotice}</span>
              </div>
            )}

            <div className={`grid grid-cols-1 ${isCompactUI ? '' : 'lg:grid-cols-3'} gap-6 pt-5 text-xs`}>
              {/* Card 1: Format Template Ekspor */}
              <div className="space-y-3">
                <label className="block font-extrabold text-[#1F1638] dark:text-white uppercase tracking-wider text-[11px]">
                  1. Pilih Format Kolom Ekspor:
                </label>
                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setExportFormat('full_46')}
                    className={`w-full text-left p-3.5 rounded-xl border flex items-start gap-3 transition-all cursor-pointer ${
                      exportFormat === 'full_46'
                        ? 'border-[#58149C] bg-[#f3eaff] dark:bg-[#2e1459] text-[#1F1638] dark:text-white ring-2 ring-[#7135B5]/30'
                        : 'border-[#e8ddff] dark:border-[#3b1d78] bg-[#f8f1ff]/60 dark:bg-[#160d29] hover:border-[#a78bfa] text-[#4B4452] dark:text-[#CABDE8]'
                    }`}
                  >
                    <FileSpreadsheet className="w-5 h-5 text-[#58149C] dark:text-[#DAB9FF] mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-[#1F1638] dark:text-white">Format Master 46 Kolom</div>
                      <div className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                        Sesuai standar template BASE_DATA_WO (semua field identitas, teknis, jadwal, mitra).
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat('korlap_template')}
                    className={`w-full text-left p-3.5 rounded-xl border flex items-start gap-3 transition-all cursor-pointer ${
                      exportFormat === 'korlap_template'
                        ? 'border-amber-600 bg-amber-50/70 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 ring-2 ring-amber-500/30'
                        : 'border-[#e8ddff] dark:border-[#3b1d78] bg-[#f8f1ff]/60 dark:bg-[#160d29] hover:border-[#a78bfa] text-[#4B4452] dark:text-[#CABDE8]'
                    }`}
                  >
                    <Building2 className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-[#1F1638] dark:text-white">Template WO Korlap</div>
                      <div className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                        Format ringkas koordinator: WO Number, ID Cust, Lokasi, Mitra, Leader, Slot Time.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setExportFormat('teknisi_template')}
                    className={`w-full text-left p-3.5 rounded-xl border flex items-start gap-3 transition-all cursor-pointer ${
                      exportFormat === 'teknisi_template'
                        ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/30'
                        : 'border-[#e8ddff] dark:border-[#3b1d78] bg-[#f8f1ff]/60 dark:bg-[#160d29] hover:border-[#a78bfa] text-[#4B4452] dark:text-[#CABDE8]'
                    }`}
                  >
                    <Wrench className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-bold text-[#1F1638] dark:text-white">Template Assigned Teknisi</div>
                      <div className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                        Format penugasan teknisi: WO Number, FAT/Port, Installer Name, Slot Time, Status.
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Card 2: Filter Data yang Diekspor */}
              <div className="space-y-3">
                <label className="block font-extrabold text-[#1F1638] dark:text-white uppercase tracking-wider text-[11px]">
                  2. Filter Data Work Order:
                </label>
                <div className="space-y-3 p-4 rounded-xl border border-[#e8ddff] dark:border-[#3b1d78] bg-[#f8f1ff] dark:bg-[#160d29]">
                  <div>
                    <label className="block text-[#4B4452] dark:text-[#CABDE8] font-bold mb-1">
                      Filter Mitra Kontraktor:
                    </label>
                    <select
                      value={exportContractor}
                      onChange={e => setExportContractor(e.target.value)}
                      className="tactile-debossed-input w-full px-3 py-2 rounded-xl border border-[#d8ccf3] dark:border-[#3b1d78] bg-white dark:bg-[#1e1238] text-[#1F1638] dark:text-white font-semibold"
                    >
                      <option value="ALL">Semua Mitra Kontraktor</option>
                      {contractors.map((c, cIdx) => (
                        <option key={`export-contractor-${c.id || c.name}-${cIdx}`} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[#4B4452] dark:text-[#CABDE8] font-bold mb-1">
                      Filter Status Penugasan:
                    </label>
                    <select
                      value={exportStatus}
                      onChange={e => setExportStatus(e.target.value)}
                      className="tactile-debossed-input w-full px-3 py-2 rounded-xl border border-[#d8ccf3] dark:border-[#3b1d78] bg-white dark:bg-[#1e1238] text-[#1F1638] dark:text-white font-semibold"
                    >
                      <option value="ALL">Semua Status</option>
                      <option value="UNASSIGNED">Belum Ditugaskan ke Teknisi</option>
                      <option value="ASSIGNED">Sudah Ditugaskan ke Teknisi</option>
                      <option value="Closed">Closed (Selesai)</option>
                    </select>
                  </div>

                  <div className="pt-2 border-t border-[#e8ddff] dark:border-[#3b1d78] text-[11.5px] text-[#4B4452] dark:text-[#CABDE8]">
                    <div>
                      WO Siap Ekspor:{' '}
                      <strong className="text-[#58149C] dark:text-[#DAB9FF] font-mono font-bold">
                        {
                          tickets.filter(t => {
                            if (t.isArchived) return false;
                            if (exportContractor !== 'ALL' && t.contactorName !== exportContractor) return false;
                            if (exportStatus === 'UNASSIGNED' && t.installerName) return false;
                            if (exportStatus === 'ASSIGNED' && !t.installerName) return false;
                            if (exportStatus === 'Closed' && t.statusWOAgent !== 'Closed') return false;
                            return true;
                          }).length
                        }{' '}
                        data
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => handleExportFile('xlsx')}
                    className="btn-3d-emerald py-2.5 px-3 font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-4 h-4" />
                    <span>Ekspor Excel (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleExportFile('csv')}
                    className="btn-3d-primary py-2.5 px-3 font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Ekspor CSV (.csv)</span>
                  </button>
                </div>
              </div>

              {/* Card 3: Download Blank Templates */}
              <div className="space-y-3">
                <label className="block font-extrabold text-[#1F1638] dark:text-white uppercase tracking-wider text-[11px]">
                  3. Unduh Template Blank:
                </label>
                <div className="space-y-2.5 p-4 rounded-xl border border-[#e8ddff] dark:border-[#3b1d78] bg-[#f8f1ff] dark:bg-[#160d29]">
                  <p className="text-[11px] text-[#4B4452] dark:text-[#CABDE8]">
                    Unduh file spreadsheet template kosong berheader resmi untuk diisi secara offline sebelum diimpor kembali:
                  </p>

                  <button
                    type="button"
                    onClick={() => handleDownloadBlankTemplate('master_46')}
                    className="btn-3d-lilac w-full text-left p-2.5 rounded-xl flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <FileDown className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF]" />
                      <div>
                        <div className="font-bold text-[#1F1638] dark:text-white">Template Master BASE_DATA_WO</div>
                        <div className="text-[10px] text-[#7D7484]">46 Kolom resmi standar</div>
                      </div>
                    </div>
                    <Download className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadBlankTemplate('korlap')}
                    className="btn-3d-lilac w-full text-left p-2.5 rounded-xl flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <FileDown className="w-4 h-4 text-amber-600" />
                      <div>
                        <div className="font-bold text-[#1F1638] dark:text-white">Template WO Korlap</div>
                        <div className="text-[10px] text-[#7D7484]">Untuk bulk assign Leader / Korlap</div>
                      </div>
                    </div>
                    <Download className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDownloadBlankTemplate('teknisi')}
                    className="btn-3d-lilac w-full text-left p-2.5 rounded-xl flex items-center justify-between cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <FileDown className="w-4 h-4 text-emerald-600" />
                      <div>
                        <div className="font-bold text-[#1F1638] dark:text-white">Template Assigned Teknisi</div>
                        <div className="text-[10px] text-[#7D7484]">Untuk bulk assign teknisi di lapangan</div>
                      </div>
                    </div>
                    <Download className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
