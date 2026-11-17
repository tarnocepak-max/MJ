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
            ? 'bg-[#FFFBEB]/95 dark:bg-[#291C0B]/95 text-amber-950 dark:text-amber-100 border-amber-300 dark:border-amber-500/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_4px_0_rgba(217,119,6,0.25),0_12px_24px_rgba(31,22,56,0.16)]'
            : 'bg-[#F3EAFF]/98 dark:bg-[#1E1238]/98 text-[#1F1638] dark:text-white border-[#DAB9FF] dark:border-[#7135B5]/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_4px_0_#CEC3D4,0_12px_24px_rgba(88,20,156,0.16)] dark:shadow-[0_10px_28px_rgba(22,13,41,0.7)]'
        }`}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
              !isOnline
                ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                : 'bg-white dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] border-[#E8DDFF] dark:border-[#7135B5]'
            }`}
          >
            {!isOnline ? (
              <WifiOff className="w-4 h-4 animate-pulse" />
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
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#58149C] text-white tabular-nums">
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
              className="tactile-pill-btn flex items-center gap-1 px-3 py-1.5 bg-[#58149C] hover:bg-[#7135B5] text-white font-bold rounded-xl cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Sync...' : 'Sync'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsOfflineModalOpen(true)}
            className="tactile-btn-secondary flex items-center gap-1 px-2.5 py-1.5 bg-white dark:bg-[#261942] text-[#4B4452] dark:text-[#E9D5FF] border border-[#CEC3D4] dark:border-[#4B386B] rounded-xl font-bold cursor-pointer"
          >
            <span className="hidden xs:inline">Detail</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
