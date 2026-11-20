import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Layers,
  Info,
  Sparkles
} from 'lucide-react';
import { ImportValidationReport, ImportParsedRow } from '../utils/woImportEngine';
import { ResponsiveModal } from './common/ResponsiveModal';
import { ResponsiveDataTable, ResponsiveColumn } from './common/ResponsiveDataTable';

interface ImportReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: ImportValidationReport;
  onConfirmImport: (mode: 'merge' | 'replace') => void;
  isImporting?: boolean;
  onSelectSheet?: (sheetName: string) => void;
  onOpenColumnMapper?: () => void;
}

export const ImportReportModal: React.FC<ImportReportModalProps> = ({
  isOpen,
  onClose,
  report,
  onConfirmImport,
  isImporting = false,
  onSelectSheet,
  onOpenColumnMapper
}) => {
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge');
  const [filterTab, setFilterTab] = useState<'all' | 'valid' | 'partial' | 'duplicate' | 'invalid'>('all');
  const [showReplaceWarning, setShowReplaceWarning] = useState(false);

  if (!isOpen || !report) return null;

  const filteredRows = report.parsedRows.filter(r => {
    if (filterTab === 'valid') return r.status === 'VALID';
    if (filterTab === 'partial') return r.status === 'PARSIAL';
    if (filterTab === 'duplicate') return r.status === 'DUPLIKAT';
    if (filterTab === 'invalid') return r.status === 'INVALID';
    return true;
  });

  const handleExecute = () => {
    if (!report.canCreateWOTickets) {
      alert('Tidak ada tiket WO valid untuk diimpor.');
      return;
    }
    if (importMode === 'replace' && !showReplaceWarning) {
      setShowReplaceWarning(true);
      return;
    }
    onConfirmImport(importMode);
  };

  const renderStatusBadge = (status: ImportParsedRow['status']) => {
    if (status === 'VALID') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
          VALID
        </span>
      );
    }
    if (status === 'PARSIAL') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
          PARSIAL
        </span>
      );
    }
    if (status === 'DUPLIKAT') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300">
          DUPLIKAT
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
        INVALID
      </span>
    );
  };

  const previewColumns: ResponsiveColumn<ImportParsedRow>[] = [
    {
      key: 'rowIndex',
      label: '#',
      align: 'center',
      widthClass: 'w-12',
      numeric: true,
      priority: 'hidden_mobile',
      render: row => <span className="text-slate-400">{row.rowIndex}</span>
    },
    {
      key: 'status',
      label: 'Status',
      widthClass: 'w-28',
      priority: 'hidden_mobile',
      render: row => renderStatusBadge(row.status)
    },
    {
      key: 'woNumber',
      label: 'WO Number',
      priority: 'primary',
      numeric: true,
      render: row => (
        <span className="font-bold text-slate-900 dark:text-slate-100">{row.ticket?.woNumber || '-'}</span>
      )
    },
    {
      key: 'customerName',
      label: 'Pelanggan',
      priority: 'primary',
      render: row => (
        <span className="text-slate-700 dark:text-slate-300 font-sans">{row.ticket?.customerName || '-'}</span>
      )
    },
    {
      key: 'customerPhone',
      label: 'No HP',
      priority: 'secondary',
      numeric: true,
      render: row => (
        <span className="text-slate-600 dark:text-slate-400">{row.ticket?.customerPhone || '-'}</span>
      )
    },
    {
      key: 'address',
      label: 'Alamat / Koordinat',
      priority: 'secondary',
      render: row => {
        const t = row.ticket || {};
        return (
          <span className="text-slate-600 dark:text-slate-400 font-sans">
            {t.streetName || (t.latitude ? `${t.latitude}, ${t.longitude}` : '-')}
          </span>
        );
      }
    },
    {
      key: 'agentId',
      label: 'Agent ID',
      priority: 'secondary',
      numeric: true,
      render: row => (
        <span className="font-bold text-[#2563EB] dark:text-[#38BDF8]">
          {row.agentId || row.ticket?.agentId || '-'}
        </span>
      )
    },
    {
      key: 'reasons',
      label: 'Catatan / Alasan',
      priority: 'secondary',
      render: row => (
        <span className="text-slate-500 font-sans">{row.reasons.join('; ') || '-'}</span>
      )
    }
  ];

  return (
    <ResponsiveModal
      isOpen={isOpen && Boolean(report)}
      onClose={() => {
        if (!isImporting) onClose();
      }}
      size="2xl"
      mobileVariant="fullscreen"
      zIndexClass="z-[100]"
      closeOnBackdropClick={!isImporting}
      icon={<FileSpreadsheet className="w-5 h-5" />}
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span>Laporan Hasil Audit Import Work Order</span>
          {report.isAgentIdOnly ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
              Data Parsial / Metadata
            </span>
          ) : report.canCreateWOTickets ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 inline-flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Siap Import ({report.validWOCount} WO)
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
              Tidak Ada WO Valid
            </span>
          )}
        </div>
      }
      subtitle={
        <>
          Sheet: <strong className="font-mono text-[#2563EB] dark:text-[#38BDF8]">{report.selectedSheet}</strong> •{' '}
          {report.totalRead} baris terbaca • {report.usedColumnsCount} kolom digunakan
        </>
      }
      headerExtra={
        onOpenColumnMapper ? (
          <button
            type="button"
            onClick={onOpenColumnMapper}
            className="px-2.5 sm:px-3 py-1.5 min-h-[36px] text-xs font-semibold text-[#2563EB] dark:text-[#38BDF8] bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 border border-blue-200 dark:border-blue-800 rounded-lg transition-colors cursor-pointer"
          >
            Atur Kolom
          </button>
        ) : undefined
      }
      footer={
        <div className="w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {report.canCreateWOTickets ? (
              <span>Siap memproses {report.validWOCount} tiket WO ke sistem routing.</span>
            ) : (
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                Tidak ada tiket WO valid. Data WO existing tetap aman.
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isImporting}
              className="px-4 py-2 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer min-h-[44px] sm:min-h-[38px]"
            >
              Tutup
            </button>

            {report.canCreateWOTickets ? (
              <button
                type="button"
                onClick={handleExecute}
                disabled={isImporting}
                className="px-5 py-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 min-h-[44px] sm:min-h-[38px]"
              >
                {isImporting ? (
                  <span>Mengimpor...</span>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Eksekusi Import ({report.validWOCount} WO)</span>
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                disabled
                className="px-5 py-2 bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 rounded-xl text-xs font-bold cursor-not-allowed min-h-[44px] sm:min-h-[38px]"
                title="Tidak ada tiket WO valid untuk diimpor"
              >
                Import Dinonaktifkan (0 WO Valid)
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Multi-Sheet Selection Bar (If workbook has more than 1 sheet) */}
        {report.allSheets && report.allSheets.length > 1 && onSelectSheet && (
          <div className="p-3 bg-slate-50 dark:bg-[#1E293B] rounded-xl border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8] shrink-0" />
              <span className="font-semibold text-[#0F172A] dark:text-white">
                Pilih Sheet Workbook ({report.allSheets.length} sheet):
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {report.allSheets.map(s => {
                const isSelected = s.sheetName === report.selectedSheet;
                return (
                  <button
                    key={s.sheetName}
                    type="button"
                    onClick={() => onSelectSheet(s.sheetName)}
                    className={`px-2.5 py-1.5 min-h-[36px] rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'bg-[#2563EB] text-white shadow-xs font-bold'
                        : 'bg-white dark:bg-[#0F172A] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                    }`}
                    title={s.recommendationReason}
                  >
                    <span>{s.sheetName}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                        isSelected
                          ? 'bg-blue-900 text-blue-100'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {s.rowCount} baris
                    </span>
                    {s.hasWoNumber && <span className="text-[10px] text-emerald-300 font-bold">★ WO</span>}
                    {s.isAgentIdOnly && <span className="text-[10px] text-amber-300 font-bold">(Agent ID)</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* SPECIAL AGENT ID ONLY CALLOUT */}
        {report.isAgentIdOnly ? (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-800/80 space-y-3 animate-in fade-in">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold shrink-0 shadow-sm">
                <Info className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-bold text-amber-900 dark:text-amber-200 text-sm">
                  File Berisi Metadata Parsial (Hanya Kolom Agent ID)
                </h3>
                <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                  Sistem mendeteksi <strong>{report.totalRead} baris</strong> berisi nilai <strong>Agent ID</strong> (
                  {report.agentIdSummary.uniqueCount} kode unik), namun{' '}
                  <strong>tidak memiliki kolom WO Number dan Alamat Pelanggan</strong>. Sesuai aturan keselamatan sistem
                  MoraJaws, <strong>0 tiket WO dibuat</strong> dan data WO lama tidak akan diubah atau dihapus.
                </p>
              </div>
            </div>

            {/* Unique Agent IDs List Chips */}
            <div className="pt-2 border-t border-amber-200 dark:border-amber-900/60">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300 block mb-2">
                Daftar Kode Agent Terbaca ({report.agentIdSummary.uniqueCount} unik):
              </span>
              <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 bg-white/70 dark:bg-slate-900/60 rounded-xl border border-amber-200 dark:border-amber-900">
                {report.agentIdSummary.agentIds.slice(0, 30).map((agId, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 font-mono text-[11px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 rounded-md border border-amber-300 dark:border-amber-800"
                  >
                    {agId}
                  </span>
                ))}
                {report.agentIdSummary.agentIds.length > 30 && (
                  <span className="text-[11px] text-amber-700 dark:text-amber-400 px-2 py-0.5 font-semibold">
                    +{report.agentIdSummary.agentIds.length - 30} Agent ID lainnya
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl bg-blue-50 dark:bg-[#1E293B] border border-blue-200 dark:border-slate-700 text-[#0F172A] dark:text-slate-200 text-xs flex items-center gap-2.5">
            <Sparkles className="w-4 h-4 text-[#2563EB] dark:text-[#38BDF8] shrink-0" />
            <span>{report.summaryMessage}</span>
          </div>
        )}

        {/* 9 Metrics Dashboard Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Total Baris</span>
            <span className="font-mono font-bold text-base text-slate-800 dark:text-slate-200">{report.totalRead}</span>
          </div>

          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
            <span className="text-emerald-700 dark:text-emerald-400 text-[11px] block font-semibold">WO Valid</span>
            <span className="font-mono font-bold text-base text-emerald-800 dark:text-emerald-300">
              {report.validWOCount}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
            <span className="text-amber-700 dark:text-amber-400 text-[11px] block font-semibold">Data Parsial</span>
            <span className="font-mono font-bold text-base text-amber-800 dark:text-amber-300">
              {report.partialDataCount}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-orange-50 dark:bg-orange-950/40 border border-orange-200 dark:border-orange-800">
            <span className="text-orange-700 dark:text-orange-400 text-[11px] block font-semibold">WO Duplikat</span>
            <span className="font-mono font-bold text-base text-orange-800 dark:text-orange-300">
              {report.duplicateCount}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">
            <span className="text-rose-700 dark:text-rose-400 text-[11px] block font-semibold">Baris Invalid</span>
            <span className="font-mono font-bold text-base text-rose-800 dark:text-rose-300">
              {report.invalidCount}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800">
            <span className="text-teal-700 dark:text-teal-400 text-[11px] block font-semibold">Siap WhatsApp</span>
            <span className="font-mono font-bold text-base text-teal-800 dark:text-teal-300">
              {report.readyForWhatsAppCount}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800">
            <span className="text-indigo-700 dark:text-indigo-400 text-[11px] block font-semibold">Kolom Digunakan</span>
            <span className="font-mono font-bold text-base text-indigo-800 dark:text-indigo-300">
              {report.usedColumnsCount} / {report.recognizedHeadersCount + report.ignoredColumnsCount}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
            <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Kolom Diabaikan</span>
            <span className="font-mono font-bold text-base text-slate-800 dark:text-slate-200">
              {report.ignoredColumnsCount}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 col-span-2 sm:col-span-1">
            <span className="text-[#2563EB] dark:text-[#38BDF8] text-[11px] block font-semibold">Agent ID Unik</span>
            <span className="font-mono font-bold text-base text-[#0F172A] dark:text-white">
              {report.agentIdSummary.uniqueCount} ID
            </span>
          </div>
        </div>

        {/* Import Mode Selection (Only if WO tickets are available) */}
        {report.canCreateWOTickets && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-[#0F172A]/60 space-y-2">
            <span className="font-bold text-slate-800 dark:text-slate-200 text-xs block">
              Pilih Mode Penggabungan Data:
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label
                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                  importMode === 'merge'
                    ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="importMode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => {
                    setImportMode('merge');
                    setShowReplaceWarning(false);
                  }}
                  className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
                />
                <div>
                  <strong className="block text-slate-900 dark:text-slate-100 font-bold">
                    Mode Gabung (Merge) - Rekomendasi
                  </strong>
                  <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                    Menambahkan tiket WO baru tanpa menghapus tiket lama yang sudah ada di database.
                  </span>
                </div>
              </label>

              <label
                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-start gap-2.5 ${
                  importMode === 'replace'
                    ? 'border-rose-500 bg-rose-50/50 dark:bg-rose-950/30'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="radio"
                  name="importMode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                  className="mt-0.5 text-rose-600 focus:ring-rose-500"
                />
                <div>
                  <strong className="block text-rose-900 dark:text-rose-200 font-bold">Mode Ganti (Replace)</strong>
                  <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                    Mengganti dataset dengan data baru. Membutuhkan konfirmasi eksplisit tambahan.
                  </span>
                </div>
              </label>
            </div>

            {showReplaceWarning && (
              <div className="p-3 bg-rose-100 dark:bg-rose-950/80 border border-rose-300 dark:border-rose-800 rounded-xl text-rose-900 dark:text-rose-200 text-xs flex items-start gap-2 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Konfirmasi Proteksi:</strong> Anda memilih mode Ganti (Replace). Tiket yang sudah ada akan
                  digantikan. Klik tombol &quot;Eksekusi Import&quot; sekali lagi untuk melanjutkan.
                </div>
              </div>
            )}
          </div>
        )}

        {/* Table Preview Filter Tabs */}
        <div className="flex items-center justify-between gap-2 flex-wrap pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="font-bold text-slate-700 dark:text-slate-300 mr-1">Preview Baris:</span>
            <button
              type="button"
              onClick={() => setFilterTab('all')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                filterTab === 'all'
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }`}
            >
              Semua ({report.parsedRows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('valid')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                filterTab === 'valid'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              Valid ({report.validWOCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('partial')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                filterTab === 'partial'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
              }`}
            >
              Parsial ({report.partialDataCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('duplicate')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                filterTab === 'duplicate'
                  ? 'bg-orange-600 text-white'
                  : 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300'
              }`}
            >
              Duplikat ({report.duplicateCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('invalid')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                filterTab === 'invalid'
                  ? 'bg-rose-600 text-white'
                  : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
              }`}
            >
              Invalid ({report.invalidCount})
            </button>
          </div>
        </div>

        {/* Responsive Table Preview */}
        <ResponsiveDataTable
          data={filteredRows.slice(0, 50)}
          columns={previewColumns}
          getRowKey={row => String(row.rowIndex)}
          maxTableHeightClass="max-h-72"
          mobileTitle={row => (
            <span className="font-mono">
              Baris #{row.rowIndex} • {row.ticket?.woNumber || '-'}
            </span>
          )}
          mobileSubtitle={row => row.ticket?.customerName || 'Tanpa Nama Pelanggan'}
          mobileStatus={row => renderStatusBadge(row.status)}
          emptyState={{
            title: 'Tidak ada baris pada filter ini',
            description: 'Pilih kategori tab lain untuk melihat hasil validasi baris.'
          }}
        />
        {filteredRows.length > 50 && (
          <p className="text-[11px] text-slate-400 text-center">
            Menampilkan 50 baris pertama dari total {filteredRows.length} baris pada tab ini.
          </p>
        )}
      </div>
    </ResponsiveModal>
  );
};
