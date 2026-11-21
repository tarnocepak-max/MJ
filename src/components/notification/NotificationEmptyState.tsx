import React from 'react';
import { BellOff, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { NotificationTab } from './notificationTypes';

interface NotificationEmptyStateProps {
  mode: 'empty' | 'loading' | 'error';
  activeTab?: NotificationTab;
  hasActiveFilter?: boolean;
  errorMessage?: string | null;
  onResetFilters?: () => void;
  onRetry?: () => void;
  compact?: boolean;
}

export const NotificationEmptyState: React.FC<NotificationEmptyStateProps> = ({
  mode,
  activeTab = 'all',
  hasActiveFilter = false,
  errorMessage,
  onResetFilters,
  onRetry,
  compact = false
}) => {
  if (mode === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex flex-col items-center justify-center text-center ${compact ? 'p-6' : 'p-10'}`}
      >
        <div className="w-12 h-12 rounded-[16px] bg-[#EEE5FF] dark:bg-[#2B1354] text-[#5424A8] dark:text-[#DDD0FF] flex items-center justify-center mb-3 border border-[#D8C5FF] dark:border-[#5424A8]/50">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
        <p className="text-xs sm:text-sm font-bold text-[#28203A] dark:text-white">
          Menyelaraskan notifikasi operasional...
        </p>
        <p className="text-[11px] text-[#756C86] dark:text-[#BFB2DC] mt-1 max-w-xs">
          Mengambil status tiket, antrean verifikasi, dan live chat sesuai peran Anda.
        </p>
      </div>
    );
  }

  if (mode === 'error') {
    return (
      <div
        role="alert"
        className={`flex flex-col items-center justify-center text-center ${compact ? 'p-6' : 'p-10'}`}
      >
        <div className="w-12 h-12 rounded-[16px] bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-300 flex items-center justify-center mb-3 border border-rose-200 dark:border-rose-800/70">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <p className="text-xs sm:text-sm font-bold text-[#28203A] dark:text-white">
          Sinkronisasi notifikasi mengalami kendala
        </p>
        <p className="text-[11px] text-[#756C86] dark:text-[#BFB2DC] mt-1 max-w-xs leading-relaxed">
          {errorMessage || 'Tidak dapat memuat pembaruan terbaru dari server.'}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3.5 mj-notif-btn-3d px-4 py-2 rounded-[14px] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Coba Sinkron Ulang</span>
          </button>
        )}
      </div>
    );
  }

  const titleByTab =
    hasActiveFilter
      ? 'Tidak ada notifikasi yang cocok'
      : activeTab === 'unread'
      ? 'Semua notifikasi sudah dibaca'
      : activeTab === 'read'
      ? 'Belum ada riwayat notifikasi terbaca'
      : 'Belum ada notifikasi aktif';

  const descByTab = hasActiveFilter
    ? 'Ubah kata kunci pencarian atau reset filter kategori, prioritas, dan tanggal.'
    : activeTab === 'unread'
    ? 'Antrean Live Chat, tugas WO, dan pembaruan sistem Anda dalam kondisi terkendali.'
    : 'Notifikasi operasional nyata sesuai peran Anda akan tampil di sini saat aktivitas masuk.';

  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'p-6' : 'p-10'}`}>
      <div className="w-12 h-12 rounded-[16px] bg-[#EEE5FF] dark:bg-[#2B1354] text-[#5424A8] dark:text-[#D8C2FF] flex items-center justify-center mb-3 border border-[#DFCFFF] dark:border-[#5424A8]/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] dark:shadow-none">
        <BellOff className="w-5 h-5" />
      </div>
      <p className="text-xs sm:text-sm font-bold text-[#28203A] dark:text-white">
        {titleByTab}
      </p>
      <p className="text-[11px] text-[#756C86] dark:text-[#BFB2DC] mt-1 max-w-xs leading-relaxed">
        {descByTab}
      </p>
      {hasActiveFilter && onResetFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="mt-3.5 mj-notif-btn-3d-soft px-3.5 py-1.5 rounded-[12px] text-[11px] font-bold cursor-pointer"
        >
          Reset Filter
        </button>
      )}
    </div>
  );
};
