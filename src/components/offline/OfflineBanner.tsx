import React from 'react';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { WifiOff, RefreshCw, ChevronRight } from 'lucide-react';

export const OfflineBanner: React.FC = () => {
  const { isOnline, isSimulatedOffline, pendingCount, setIsOfflineModalOpen, syncNow, isSyncing } = useOfflineSync();

  if (isOnline && pendingCount === 0) return null;

  return (
    <div className="fixed bottom-20 sm:bottom-4 left-1/2 -translate-x-1/2 z-40 max-w-xl w-[92%] sm:w-auto mj-toast-enter">
      <div
        className={`px-3.5 py-2.5 rounded-2xl border flex items-center justify-between gap-3 text-xs backdrop-blur-xl transition-all ${
          !isOnline
            ? 'bg-[#FFFBEB]/95 dark:bg-[#291C0B]/95 text-amber-950 dark:text-amber-100 border-amber-300 dark:border-amber-500/50 shadow-lg'
            : 'bg-white/95 dark:bg-[#0F172A]/95 text-[#0F172A] dark:text-white border-slate-200 dark:border-slate-700 shadow-lg'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
              !isOnline
                ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                : 'bg-blue-50 dark:bg-[#1E293B] text-[#2563EB] dark:text-[#38BDF8] border-blue-200 dark:border-slate-700'
            }`}
          >
            {!isOnline ? (
              <WifiOff className="w-4 h-4" />
            ) : (
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            )}
          </div>
          <div className="min-w-0">
            <div className="font-bold flex items-center gap-1.5 flex-wrap">
              <span>
                {!isOnline
                  ? isSimulatedOffline
                    ? 'Mode Simulasi Offline'
                    : 'Mode Offline Aktif'
                  : 'Tersambung Ulang'}
              </span>
              {pendingCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#2563EB] text-white tabular-nums">
                  {pendingCount} antrean
                </span>
              )}
            </div>
            <p className="text-[11px] opacity-80 truncate hidden sm:block">
              {!isOnline
                ? 'Perubahan lapangan disimpan aman di cache lokal perangkat Anda.'
                : `${pendingCount} perubahan operasional siap disinkronkan ke server.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isOnline && pendingCount > 0 && (
            <button
              type="button"
              onClick={() => syncNow()}
              disabled={isSyncing}
              className="flex items-center gap-1 px-3 py-1.5 min-h-[40px] sm:min-h-[34px] bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-bold rounded-xl cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sync...' : 'Sync'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsOfflineModalOpen(true)}
            className="flex items-center gap-1 px-3 py-1.5 min-h-[40px] sm:min-h-[34px] bg-slate-100 dark:bg-[#1E293B] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl font-bold cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            <span className="hidden xs:inline">Detail</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
