import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, RefreshCw, UploadCloud, X } from 'lucide-react';
import { GlobalConfigConflictDetails } from '../../services/globalConfigService';
import { useModalLayer } from '../../hooks/useModalLayer';

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
  const isOpen = Boolean(conflict);
  const layerZ = useModalLayer(isOpen, { tier: 'confirm' });

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isResolving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isResolving, onClose]);

  if (!conflict) return null;

  const formattedTime = conflict.updatedAt
    ? new Date(conflict.updatedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Baru saja';

  const content = (
    <div
      style={{ zIndex: layerZ }}
      className="fixed inset-0 flex items-end sm:items-center justify-center bg-[#26364A]/35 dark:bg-slate-950/60 p-0 sm:p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-modal-title"
        className="w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden rounded-t-[24px] sm:rounded-2xl border border-[#F2CF95] bg-white/95 backdrop-blur-xl dark:backdrop-blur-none shadow-xl dark:border-amber-900/60 dark:bg-slate-900"
      >
        <div className="px-4 pt-4 pb-3 sm:px-6 sm:pt-6 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFF2D9] text-[#C88735] border border-[#F2CF95] dark:border-transparent dark:bg-amber-950/60 dark:text-amber-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 id="conflict-modal-title" className="text-base font-bold text-[#26364A] dark:text-white">
                Konflik Perubahan Konfigurasi Terdeteksi
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-[#52647A] dark:text-slate-300">
                Konfigurasi <span className="font-mono font-semibold text-[#26364A] dark:text-slate-100">{pendingLabel || conflict.key}</span> telah
                diperbarui oleh Super Admin lain saat Anda mengedit. Penyimpanan dibatalkan demi mencegah kehilangan data.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isResolving}
            className="rounded-lg w-11 h-11 min-w-[44px] min-h-[44px] sm:w-8 sm:h-8 sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[#8492A5] hover:bg-[#EDF3F8] hover:text-[#26364A] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer shrink-0"
            aria-label="Tutup dialog konflik"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-2">
          <div className="rounded-xl border border-[#DDE6F0] bg-[#F8FAFD] p-3.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="block text-[11px] text-[#8492A5] dark:text-slate-400">Versi Draft Anda</span>
                <span className="font-mono font-bold tabular-nums text-[#26364A] dark:text-slate-200">
                  v{conflict.expectedVersion}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[#8492A5] dark:text-slate-400">Versi Aktif di Database</span>
                <span className="font-mono font-bold tabular-nums text-[#C88735] dark:text-amber-400">
                  v{conflict.currentVersion}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[#8492A5] dark:text-slate-400">Diubah Oleh</span>
                <span className="font-medium text-[#26364A] dark:text-slate-200">
                  {conflict.updatedBy || 'Super Admin lain'}
                </span>
              </div>
              <div>
                <span className="block text-[11px] text-[#8492A5] dark:text-slate-400">Waktu Perubahan</span>
                <span className="font-mono tabular-nums text-[#26364A] dark:text-slate-200">
                  {formattedTime}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end shrink-0">
          <button
            type="button"
            disabled={isResolving}
            onClick={() => void onReloadLatest()}
            className="btn-3d-secondary min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isResolving ? 'animate-spin' : ''}`} />
            <span>Muat Versi Terbaru (v{conflict.currentVersion})</span>
          </button>
          <button
            type="button"
            disabled={isResolving}
            onClick={() => void onForceOverwrite()}
            className="btn-3d-primary min-h-[44px] sm:min-h-0 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            <span>Timpa dengan Perubahan Saya</span>
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
};
