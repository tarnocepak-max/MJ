import React from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  XCircle
} from 'lucide-react';
import { ImportJobSummary } from '../../types/index.ts';

interface ImportJobMonitorPanelProps {
  activeJob: ImportJobSummary | null;
  phaseLabel?: string;
  isBusy: boolean;
  recentJobs?: ImportJobSummary[];
  onResumeJob: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
  onRetryFailed: (jobId: string) => void;
  onDownloadErrors: (jobId: string) => void;
  onRefreshJob: (jobId: string) => void;
  onSelectJob: (job: ImportJobSummary) => void;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  staging: {
    label: 'STAGING',
    cls: 'bg-[#EAE8FF] text-[#5145A6] border-[#C5BEEF] dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800'
  },
  queued: {
    label: 'ANTRIAN',
    cls: 'bg-[#EAE8FF] text-[#5145A6] border-[#C5BEEF] dark:bg-purple-950/70 dark:text-purple-300 dark:border-purple-800'
  },
  processing: {
    label: 'MEMPROSES',
    cls: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800'
  },
  paused: {
    label: 'DIJEDA',
    cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
  },
  completed: {
    label: 'SELESAI',
    cls: 'bg-[#DDF4F4] text-[#2E7D8B] border-[#BDE4E8] dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800'
  },
  completed_with_errors: {
    label: 'SELESAI (ADA ERROR)',
    cls: 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
  },
  failed: {
    label: 'GAGAL',
    cls: 'bg-rose-50 text-[#BA1A1A] border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800'
  },
  cancelled: {
    label: 'DIBATALKAN',
    cls: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700'
  }
};

function formatDuration(ms?: number | null): string {
  if (!ms || ms < 0) return '-';
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} dtk`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}d`;
}

export const ImportJobMonitorPanel: React.FC<ImportJobMonitorPanelProps> = ({
  activeJob,
  phaseLabel,
  isBusy,
  recentJobs = [],
  onResumeJob,
  onCancelJob,
  onRetryFailed,
  onDownloadErrors,
  onRefreshJob,
  onSelectJob
}) => {
  const resumableInterruptedJobs = recentJobs.filter(
    j =>
      (!activeJob || j.id !== activeJob.id) &&
      (j.status === 'processing' || j.status === 'queued' || j.status === 'paused' || j.status === 'failed' || j.hasFailedBatches)
  );

  if (!activeJob && resumableInterruptedJobs.length === 0) {
    return null;
  }

  const badge = activeJob ? STATUS_BADGE[activeJob.status] || STATUS_BADGE.processing : STATUS_BADGE.processing;

  return (
    <div className="space-y-3">
      {resumableInterruptedJobs.length > 0 && (
        <div className="p-3.5 rounded-2xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="font-bold text-amber-900 dark:text-amber-200">
                Job Import Belum Selesai / Perlu Pemulihan ({resumableInterruptedJobs.length})
              </div>
              <div className="text-[11px] text-amber-800 dark:text-amber-300 truncate">
                {resumableInterruptedJobs[0].sourceFile} • {resumableInterruptedJobs[0].processedRows}/{resumableInterruptedJobs[0].totalRows} baris ({resumableInterruptedJobs[0].progressPercent}%)
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onSelectJob(resumableInterruptedJobs[0])}
              className="btn-3d-lilac px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer"
            >
              Pantau
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() =>
                resumableInterruptedJobs[0].hasFailedBatches || resumableInterruptedJobs[0].status === 'failed'
                  ? onRetryFailed(resumableInterruptedJobs[0].id)
                  : onResumeJob(resumableInterruptedJobs[0].id)
              }
              className="btn-3d-primary px-3.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Lanjutkan Job</span>
            </button>
          </div>
        </div>
      )}

      {activeJob && (
        <div className="card-3d-lavender rounded-2xl p-5 space-y-4">
          {/* Header Row */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-[#E2E8F0] dark:border-[#3b1d78]">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border tracking-wider ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="font-mono text-[11px] font-bold text-[#5145A6] dark:text-[#DAB9FF] truncate">
                  {activeJob.id}
                </span>
                <span className="text-[11px] font-mono text-[#8492A5] dark:text-[#A79BC0]">
                  • {activeJob.templateType} • {activeJob.batchSize} WO/batch
                </span>
              </div>

              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white flex items-center gap-2 truncate">
                {isBusy && (activeJob.status === 'staging' || activeJob.status === 'processing' || activeJob.status === 'queued') ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                ) : activeJob.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-[#2E7D8B] dark:text-emerald-400 shrink-0" />
                ) : activeJob.status === 'cancelled' || activeJob.status === 'failed' ? (
                  <XCircle className="w-4 h-4 text-[#BA1A1A] dark:text-rose-400 shrink-0" />
                ) : (
                  <Activity className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0" />
                )}
                <span className="truncate">{activeJob.sourceFile}</span>
              </h4>

              {phaseLabel && (
                <p className="text-xs text-[#52647A] dark:text-[#CABDE8] font-medium">
                  {phaseLabel}
                </p>
              )}
            </div>

            {/* Control Buttons */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onRefreshJob(activeJob.id)}
                className="btn-3d-lilac px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                title="Sinkronkan status terbaru dari database"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>

              {!isBusy && activeJob.canResume && (
                <button
                  type="button"
                  onClick={() => onResumeJob(activeJob.id)}
                  className="btn-3d-primary px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Resume Batch</span>
                </button>
              )}

              {!isBusy && activeJob.canRetry && (
                <button
                  type="button"
                  onClick={() => onRetryFailed(activeJob.id)}
                  className="btn-3d-emerald px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry Batch Gagal</span>
                </button>
              )}

              {(activeJob.failedRows > 0 || activeJob.duplicateRows > 0) && (
                <button
                  type="button"
                  onClick={() => onDownloadErrors(activeJob.id)}
                  className="btn-3d-lilac px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Error CSV</span>
                </button>
              )}

              {activeJob.canCancel && (
                <button
                  type="button"
                  onClick={() => onCancelJob(activeJob.id)}
                  className="btn-3d-crimson px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Square className="w-3 h-3" />
                  <span>Batalkan Aman</span>
                </button>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono tabular-nums">
              <span className="text-[#52647A] dark:text-[#CABDE8] font-semibold">
                Batch {activeJob.completedBatches}/{activeJob.totalBatches} • Aktif #{activeJob.currentBatch || 0}
              </span>
              <span className="font-extrabold text-[#5145A6] dark:text-[#DAB9FF]">
                {activeJob.progressPercent.toFixed(1)}% ({activeJob.processedRows}/{activeJob.totalRows})
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-[#E4F0F6] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78] overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  activeJob.status === 'failed'
                    ? 'bg-rose-500'
                    : activeJob.status === 'completed_with_errors'
                    ? 'bg-amber-500'
                    : 'bg-gradient-to-r from-[#5145A6] via-[#6657C8] to-[#2E7D8B]'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, activeJob.progressPercent))}%` }}
              />
            </div>
          </div>

          {/* Telemetry Counters */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs">
            <div className="p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78]">
              <div className="text-[10px] font-bold uppercase text-[#8492A5]">Total Baris</div>
              <div className="text-base font-extrabold font-mono tabular-nums text-[#26364A] dark:text-white">
                {activeJob.totalRows.toLocaleString('id-ID')}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78]">
              <div className="text-[10px] font-bold uppercase text-[#8492A5]">Diproses</div>
              <div className="text-base font-extrabold font-mono tabular-nums text-[#26364A] dark:text-white">
                {activeJob.processedRows.toLocaleString('id-ID')}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#DDF4F4]/60 dark:bg-emerald-950/30 border border-[#BDE4E8] dark:border-emerald-800">
              <div className="text-[10px] font-bold uppercase text-[#2E7D8B] dark:text-emerald-300">Sukses</div>
              <div className="text-base font-extrabold font-mono tabular-nums text-[#2E7D8B] dark:text-emerald-300">
                {activeJob.successfulRows.toLocaleString('id-ID')}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#EAE8FF]/70 dark:bg-purple-950/40 border border-[#C5BEEF] dark:border-purple-800">
              <div className="text-[10px] font-bold uppercase text-[#5145A6] dark:text-[#DAB9FF]">Duplikat</div>
              <div className="text-base font-extrabold font-mono tabular-nums text-[#5145A6] dark:text-[#DAB9FF]">
                {activeJob.duplicateRows.toLocaleString('id-ID')}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
              <div className="text-[10px] font-bold uppercase text-[#BA1A1A] dark:text-rose-300">Gagal</div>
              <div className="text-base font-extrabold font-mono tabular-nums text-[#BA1A1A] dark:text-rose-300">
                {activeJob.failedRows.toLocaleString('id-ID')}
              </div>
            </div>
            <div className="p-2.5 rounded-xl bg-[#F4F7FB] dark:bg-[#160d29] border border-[#DDE6F0] dark:border-[#3b1d78]">
              <div className="text-[10px] font-bold uppercase text-[#8492A5] flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>Durasi</span>
              </div>
              <div className="text-base font-extrabold font-mono tabular-nums text-[#26364A] dark:text-white">
                {formatDuration(activeJob.durationMs)}
              </div>
            </div>
          </div>

          {/* Batch Strip */}
          {activeJob.batches && activeJob.batches.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-[#52647A] dark:text-[#CABDE8] flex items-center gap-1.5">
                <FileSpreadsheet className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
                <span>Status Per Batch ({activeJob.batches.length} Batch)</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {activeJob.batches.map(b => {
                  const colorCls =
                    b.status === 'completed'
                      ? 'bg-[#DDF4F4] text-[#2E7D8B] border-[#BDE4E8] dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800'
                      : b.status === 'processing'
                      ? 'bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-700 animate-pulse'
                      : b.status === 'failed'
                      ? 'bg-rose-100 text-[#BA1A1A] border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800'
                      : b.status === 'cancelled'
                      ? 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700'
                      : 'bg-white text-[#52647A] border-[#DDE6F0] dark:bg-[#1e1238] dark:text-[#CABDE8] dark:border-[#3b1d78]';

                  return (
                    <span
                      key={b.id}
                      title={`Batch #${b.batchNumber} (baris ${b.startRow}-${b.endRow}): ${b.successfulRows} sukses, ${b.duplicateRows} duplikat, ${b.failedRows} gagal${b.errorMessage ? ` — ${b.errorMessage}` : ''}`}
                      className={`px-2 py-1 rounded-lg border text-[10px] font-mono font-bold tabular-nums ${colorCls}`}
                    >
                      B{b.batchNumber}: {b.status === 'completed' ? `${b.successfulRows}/${b.rowCount}` : b.status.toUpperCase()}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {activeJob.errorSummary && (
            <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-[#BA1A1A] dark:text-rose-200">
              <strong>Ringkasan Error:</strong> {activeJob.errorSummary}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
