import React from 'react';
import { AlertTriangle, RefreshCw, UploadCloud, X } from 'lucide-react';
import { GlobalConfigConflictDetails } from '../../services/globalConfigService';

interface ConfigConflictModalProps {
  conflict: GlobalConfigConflictDetails | null;
  pendingLabel?: string;
  isResolving?: boolean;
  onReloadLatest: () => Promise<void> | void;
  onForceOverwrite: () => Promise<void> | void;
  onClose: () => void;
}

export const ConfigConflictModal: React.FC<ConfigConflictModalProps> = ({
  conflict,
  pendingLabel,
  isResolving = false,
  onReloadLatest,
  onForceOverwrite,
  onClose
}) => {
  if (!conflict) return null;

  const formattedTime = conflict.updatedAt
    ? new Date(conflict.updatedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Baru saja';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-modal-title"
        className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-xl dark:border-amber-900/60 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h3 id="conflict-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
                Konflik Perubahan Konfigurasi Terdeteksi
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                Konfigurasi <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">{pendingLabel || conflict.key}</span> telah
                diperbarui oleh Super Admin lain saat Anda mengedit. Penyimpanan dibatalkan demi mencegah kehilangan data.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isResolving}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
            aria-label="Tutup dialog konflik"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">Versi Draft Anda</span>
              <span className="font-mono font-bold tabular-nums text-slate-800 dark:text-slate-200">
                v{conflict.expectedVersion}
              </span>
            </div>
            <div>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">Versi Aktif di Database</span>
              <span className="font-mono font-bold tabular-nums text-amber-600 dark:text-amber-400">
                v{conflict.currentVersion}
              </span>
            </div>
            <div>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">Diubah Oleh</span>
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {conflict.updatedBy || 'Super Admin lain'}
              </span>
            </div>
            <div>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">Waktu Perubahan</span>
              <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                {formattedTime}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isResolving}
            onClick={() => void onReloadLatest()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isResolving ? 'animate-spin' : ''}`} />
            <span>Muat Versi Terbaru (v{conflict.currentVersion})</span>
          </button>
          <button
            type="button"
            disabled={isResolving}
            onClick={() => void onForceOverwrite()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#7C3AED] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#6D28D9] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span>Timpa dengan Perubahan Saya</span>
          </button>
        </div>
      </div>
    </div>
  );
};
