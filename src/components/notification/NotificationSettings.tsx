import React from 'react';
import { Volume2, VolumeX, BellRing, Lock, ArrowUpRight } from 'lucide-react';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useApp } from '../../context/AppContext';

interface NotificationSettingsProps {
  onOpenFullAudioEngine?: () => void;
}

export const NotificationSettings: React.FC<NotificationSettingsProps> = ({
  onOpenFullAudioEngine
}) => {
  const { currentUser } = useApp();
  const { soundSettings, isSoundSaving, updateSoundSettings, playReadySound } = useMoraJawsSound();
  const isSuperAdmin = currentUser.role === 'super_admin';
  const canOpenSoundSettingsPage = currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  return (
    <div className="rounded-[18px] p-3.5 bg-[#EEE5FF]/60 dark:bg-[#231144]/90 border border-[#DCCBFF] dark:border-[#5424A8]/60 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-[11px] bg-white dark:bg-[#30104B] text-[#5424A8] dark:text-[#DEC8FF] flex items-center justify-center border border-[#DFD0FA] dark:border-[#5D30B5] shrink-0">
            <BellRing className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-[#28203A] dark:text-white truncate">
              Preferensi Audio Notifikasi
            </div>
            <div className="text-[10.5px] text-[#756C86] dark:text-[#BFB2DC] truncate">
              {soundSettings.enabled ? `Aktif · Volume ${Math.round(soundSettings.volume * 100)}%` : 'Mode Senyap'}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={!isSuperAdmin || isSoundSaving}
          onClick={() => updateSoundSettings({ enabled: !soundSettings.enabled })}
          aria-label="Aktifkan atau nonaktifkan suara notifikasi"
          title={isSuperAdmin ? 'Ubah Master Audio Global' : 'Konfigurasi global dikunci untuk Super Admin'}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[12px] text-[11px] font-bold cursor-pointer disabled:opacity-60 ${
            soundSettings.enabled ? 'mj-notif-btn-3d' : 'mj-notif-btn-3d-soft'
          }`}
        >
          {soundSettings.enabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>{soundSettings.enabled ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {!isSuperAdmin && (
        <div className="flex items-center gap-1.5 text-[10.5px] text-[#756C86] dark:text-[#BFB2DC]">
          <Lock className="w-3 h-3 shrink-0 text-[#5424A8] dark:text-[#C59CFF]" />
          <span>Pengaturan audio global dikelola oleh Super Admin.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
        <button
          type="button"
          onClick={playReadySound}
          className="mj-notif-btn-3d-soft px-3 py-1.5 rounded-[11px] text-[11px] font-bold cursor-pointer"
        >
          Uji Chime
        </button>

        {canOpenSoundSettingsPage && onOpenFullAudioEngine && (
          <button
            type="button"
            onClick={onOpenFullAudioEngine}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#5424A8] dark:text-[#C59CFF] hover:underline cursor-pointer"
          >
            <span>Buka Alert &amp; Audio Engine</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
