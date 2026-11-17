import React, { useState } from 'react';
import { Ticket, User } from '../../types/index.ts';
import { useApp } from '../../context/AppContext';
import { FileUp, CheckCircle2, AlertTriangle, FileSpreadsheet, ShieldAlert } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ResponsiveModal } from '../common/ResponsiveModal';

interface UploadAssignModalProps {
  isOpen: boolean;
  onClose: () => void;
  contractorTickets: Ticket[];
  myInstallers: User[];
  onExecuteBulkAssign: (assignments: { ticketId: string; installerName: string; slotTime?: string }[]) => void;
}

export const UploadAssignModal: React.FC<UploadAssignModalProps> = ({
  isOpen,
  onClose,
  contractorTickets,
  myInstallers,
  onExecuteBulkAssign
}) => {
  const { currentUser } = useApp();
  const isLeaderRole = currentUser.role === 'leader';

  const [pasteData, setPasteData] = useState('');
  const [parsedRows, setParsedRows] = useState<{
    woNumber: string;
    installerName: string;
    slotTime?: string;
    isValid: boolean;
    ticketId?: string;
    error?: string;
  }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const activeInstallers = myInstallers.filter(inst => inst.active !== false && !inst.isArchived);
  const installerNamesMap = new Map<string, string>();
  activeInstallers.forEach(inst => {
    installerNamesMap.set(inst.name.toLowerCase().trim(), inst.name);
    installerNamesMap.set(inst.username.toLowerCase().trim(), inst.name);
  });

  const ticketsByWo = new Map<string, Ticket>();
  contractorTickets.forEach(t => {
    ticketsByWo.set(t.woNumber.toUpperCase().trim(), t);
  });

  const parseLines = (rawText: string) => {
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    const results: typeof parsedRows = [];

    lines.forEach(line => {
      const parts = line.split(/[\t,|;]+/).map(p => p.trim());
      if (parts.length < 2) return;

      const woCandidate = parts[0].toUpperCase();
      const installerCandidate = parts[1].toLowerCase();
      const slotCandidate = parts[2] || undefined;

      if (woCandidate.includes('WO') && (installerCandidate.includes('INSTALLER') || installerCandidate.includes('TEKNISI'))) {
        return;
      }

      const matchedTicket = ticketsByWo.get(woCandidate);
      const matchedInstaller = installerNamesMap.get(installerCandidate);

      if (!matchedTicket) {
        results.push({
          woNumber: parts[0],
          installerName: parts[1],
          slotTime: slotCandidate,
          isValid: false,
          error: 'Nomor WO tidak ditemukan pada kontraktor ini.'
        });
      } else if (!matchedInstaller) {
        results.push({
          woNumber: parts[0],
          installerName: parts[1],
          slotTime: slotCandidate,
          isValid: false,
          error: 'Teknisi tidak terdaftar di tim kontraktor Anda.'
        });
      } else {
        results.push({
          woNumber: matchedTicket.woNumber,
          installerName: matchedInstaller,
          slotTime: slotCandidate || matchedTicket.slotTime,
          isValid: true,
          ticketId: matchedTicket.id
        });
      }
    });

    setParsedRows(results);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = evt => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[firstSheetName];
        const rawJson: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        const lines = rawJson
          .map(row => (Array.isArray(row) ? row.join('\t') : ''))
          .filter(Boolean)
          .join('\n');

        setPasteData(lines);
        parseLines(lines);
      } catch (err) {
        console.warn('Failed parsing spreadsheet', err);
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleConfirm = () => {
    if (!isLeaderRole) return;
    const validOnes = parsedRows.filter(r => r.isValid && r.ticketId);
    if (validOnes.length === 0) return;

    setIsProcessing(true);
    onExecuteBulkAssign(
      validOnes.map(r => ({
        ticketId: r.ticketId!,
        installerName: r.installerName,
        slotTime: r.slotTime
      }))
    );
    setIsProcessing(false);
    onClose();
  };

  const validCount = parsedRows.filter(r => r.isValid).length;

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Upload Assign WO"
      subtitle="Unggah berkas Excel/CSV atau tempel teks pemetaan penugasan teknisi (WO Number | Nama Teknisi)"
      icon={<FileUp className="w-4 h-4 text-[#6D28D9] dark:text-[#DAB9FF]" />}
      size="lg"
      mobileVariant="sheet"
      zIndexClass="z-60"
      footer={
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-2.5 w-full text-xs">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] sm:min-h-[38px] px-4 py-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-700 rounded-xl font-medium cursor-pointer"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!isLeaderRole || validCount === 0 || isProcessing}
            className={`min-h-[42px] sm:min-h-[38px] px-5 py-2 rounded-xl font-bold text-white transition-all shadow-sm cursor-pointer ${
              !isLeaderRole || validCount === 0 || isProcessing
                ? 'bg-slate-300 dark:bg-slate-700 cursor-not-allowed opacity-60'
                : 'bg-[#6D28D9] hover:bg-[#5B21B6]'
            }`}
          >
            {isProcessing ? 'Memproses...' : `Tugaskan ${validCount} WO Sekarang`}
          </button>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {!isLeaderRole && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-rose-700 dark:text-rose-300 text-xs font-medium">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>Hanya akun dengan peran <strong>Leader</strong> yang berwenang melakukan penugasan teknisi (Assign WO).</span>
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <label className="flex-1 border-2 border-dashed border-[#C4B5FD] hover:border-[#6D28D9] rounded-xl p-4 text-center cursor-pointer bg-[#EDE9FE]/20 dark:bg-[#261942]/40 transition-colors">
            <FileSpreadsheet className="w-6 h-6 text-[#6D28D9] dark:text-[#DAB9FF] mx-auto mb-1" />
            <span className="font-semibold text-slate-800 dark:text-slate-200 block text-xs">
              Klik untuk unggah Excel (.xlsx, .csv)
            </span>
            <span className="text-[10px] text-slate-400">
              Format kolom: [WO Number], [Nama Teknisi], [Slot Waktu (Opsional)]
            </span>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        <div>
          <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Atau Tempel / Salin Teks Pemetaan (Clipboard Paste):
          </label>
          <textarea
            rows={4}
            placeholder={`Contoh:\nWO20267399330\tAndi Saputra\t09:00 - 11:00 WIB\nWO20267399331\tDedi Kurniawan`}
            value={pasteData}
            onChange={e => {
              setPasteData(e.target.value);
              parseLines(e.target.value);
            }}
            className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl font-mono text-[11px] text-slate-800 dark:text-slate-200"
          />
        </div>

        {parsedRows.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="font-bold text-slate-800 dark:text-slate-200">
                Hasil Pemindaian ({validCount} Valid dari {parsedRows.length} baris):
              </span>
              <span className="text-emerald-600 font-semibold">{validCount} Siap Di-assign</span>
            </div>

            <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl divide-y divide-slate-200 dark:divide-slate-800">
              {parsedRows.map((r, idx) => (
                <div
                  key={idx}
                  className={`p-2.5 flex flex-wrap items-center justify-between gap-2 text-xs ${
                    r.isValid
                      ? 'bg-emerald-50/30 dark:bg-emerald-950/20 text-slate-800 dark:text-slate-200'
                      : 'bg-rose-50/50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    {r.isValid ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                    )}
                    <span className="font-mono font-bold">{r.woNumber}</span>
                    <span>➔</span>
                    <span className="font-medium truncate">{r.installerName}</span>
                    {r.slotTime && <span className="text-slate-400 font-mono text-[10px]">({r.slotTime})</span>}
                  </div>
                  {r.error && <span className="text-[10px] text-rose-600">{r.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ResponsiveModal>
  );
};
