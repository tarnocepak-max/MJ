import React from 'react';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { WifiOff, RefreshCw } from 'lucide-react';
import { NotificationSnackbar } from '../notification/NotificationSnackbar';

export const OfflineBanner: React.FC = () => {
  const { isOnline, isSimulatedOffline, pendingCount, setIsOfflineModalOpen, syncNow, isSyncing } = useOfflineSync();

  const visible = !isOnline || pendingCount > 0;
  if (!visible) return null;

  const title = !isOnline
    ? isSimulatedOffline
      ? 'Mode Simulasi Offline'
      : 'Mode Offline Aktif'
    : `Tersambung · ${pendingCount} Antrean Sync`;

  const description = !isOnline
    ? pendingCount > 0
      ? `${pendingCount} perubahan lapangan disimpan aman di cache lokal.`
      : 'Perubahan lapangan akan disimpan lokal sampai koneksi pulih.'
    : `${pendingCount} perubahan operasional siap disinkronkan ke server.`;

  return (
    <NotificationSnackbar
      visible={visible}
      variant={!isOnline ? 'warning' : 'violet'}
      icon={
        !isOnline ? (
          <WifiOff className="w-4 h-4" />
        ) : (
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
        )
      }
      title={title}
      description={description}
      action={
        isOnline && pendingCount > 0
          ? {
              label: isSyncing ? 'Sync...' : 'Sync Sekarang',
              onClick: () => {
                void syncNow();
              },
              disabled: isSyncing
            }
          : undefined
      }
      secondaryAction={{
        label: 'Detail',
        onClick: () => setIsOfflineModalOpen(true)
      }}
    />
  );
};

