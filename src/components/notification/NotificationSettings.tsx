import React, { useEffect, useState } from 'react';
import {
  Volume2,
  VolumeX,
  BellRing,
  Play,
  RotateCcw,
  ShieldAlert,
  ArrowUpRight,
  BellOff
} from 'lucide-react';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useApp } from '../../context/AppContext';
import { NotificationSoundCategory } from '../../types';
import { SOUND_CATEGORY_CATALOG } from '../../services/notificationAudioService';

interface NotificationSettingsProps {
  onOpenFullAudioEngine?: () => void;
}

export const NotificationSettings: React.FC<NotificationSettingsProps> = ({
  onOpenFullAudioEngine
}) => {
  const { currentUser } = useApp();
  const {
    soundSettings,
    soundScope,
    audioEngineState,
    isSoundSaving,
    unlockAudio,
    updateSoundSettings,
    restoreDefaultSoundSettings,
    previewSound
  } = useMoraJawsSound();

  const [selectedCategory, setSelectedCategory] = useState<NotificationSoundCategory>('normal');
  const [draftMasterVolume, setDraftMasterVolume] = useState<number>(soundSettings.volume);

  useEffect(() => {
    setDraftMasterVolume(soundSettings.volume);
  }, [soundSettings.volume]);

  const canOpenSoundSettingsPage =
    currentUser.role === 'super_admin' || currentUser.role === 'dispatch';

  const commitMasterVolume = (val: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(val)));
    if (clamped !== soundSettings.volume) {
      void updateSoundSettings({ volume: clamped });
    }
  };

  return (
    <div className="rounded-[18px] p-3.5 bg-[#EEE5FF]/65 dark:bg-[#231144]/90 border border-[#DCCBFF] dark:border-[#5424A8]/60 space-y-3">
      {/* Header + Master Toggle */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-[11px] bg-white dark:bg-[#30104B] text-[#5424A8] dark:text-[#DEC8FF] flex items-center justify-center border border-[#DFD0FA] dark:border-[#5D30B5] shrink-0">
            <BellRing className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-[#28203A] dark:text-white truncate">
              Notification Sound Settings
            </div>
            <div className="text-[10.5px] text-[#756C86] dark:text-[#BFB2DC] truncate">
              {soundSettings.enabled
                ? `Aktif · Master ${draftMasterVolume}% (${soundScope === 'global' ? 'Global' : 'Perangkat'})`
                : soundSettings.criticalSeparate
                ? 'Normal Senyap · Critical Tetap Aktif'
                : 'Mode Senyap'}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={isSoundSaving}
          onClick={() => updateSoundSettings({ enabled: !soundSettings.enabled })}
          aria-label="Aktifkan atau nonaktifkan suara notifikasi"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[12px] text-[11px] font-bold cursor-pointer disabled:opacity-60 ${
            soundSettings.enabled ? 'mj-notif-btn-3d' : 'mj-notif-btn-3d-soft'
          }`}
        >
          {soundSettings.enabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>{soundSettings.enabled ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {(audioEngineState === 'suspended' || audioEngineState === 'idle') && (
        <button
          type="button"
          onClick={() => void unlockAudio().then(() => previewSound('live_chat', draftMasterVolume))}
          className="w-full px-3 py-2 rounded-[12px] bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-950/80 border border-amber-300 dark:border-amber-700/80 text-amber-900 dark:text-amber-200 text-[11px] font-bold flex items-center justify-between gap-2 transition-colors cursor-pointer"
        >
          <span className="inline-flex items-center gap-1.5 text-left">
            <BellRing className="w-3.5 h-3.5 shrink-0" />
            <span>
              {audioEngineState === 'suspended'
                ? 'Audio Terkunci Autoplay — Klik untuk Aktifkan'
                : 'Aktifkan & Uji Suara Notifikasi'}
            </span>
          </span>
          <span className="px-2 py-0.5 rounded-md bg-amber-200/80 dark:bg-amber-800/70 text-[10px] font-extrabold shrink-0">
            Aktifkan
          </span>
        </button>
      )}

      {/* Master Volume Slider (0-100%) */}
      <div className="rounded-[12px] bg-white/80 dark:bg-[#190B33]/85 border border-[#E2D4FF] dark:border-[#4B238F] p-2.5 space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-[#28203A] dark:text-[#EEE5FF]">Master Volume</span>
          <div className="flex items-center gap-2">
            <span className="font-mono font-extrabold text-[#5424A8] dark:text-[#D5B8FF] tabular-nums">
              {draftMasterVolume}%
            </span>
            <button
              type="button"
              onClick={() => previewSound(selectedCategory, draftMasterVolume)}
              className="text-[10px] font-bold text-[#5424A8] dark:text-[#C9A8FF] hover:underline cursor-pointer"
            >
              Preview
            </button>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={draftMasterVolume}
          onChange={e => setDraftMasterVolume(Number(e.target.value))}
          onMouseUp={() => commitMasterVolume(draftMasterVolume)}
          onTouchEnd={() => commitMasterVolume(draftMasterVolume)}
          onBlur={() => commitMasterVolume(draftMasterVolume)}
          aria-label="Master Volume"
          className="w-full h-1.5 bg-[#E2D4FF] dark:bg-[#351766] rounded-lg appearance-none cursor-pointer accent-[#5424A8]"
        />
      </div>

      {/* Mute Normal & Separate Critical Toggles */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={isSoundSaving}
          onClick={() => updateSoundSettings({ muteNormal: !soundSettings.muteNormal })}
          className={`px-2.5 py-2 rounded-[12px] border text-left transition-all cursor-pointer ${
            soundSettings.muteNormal
              ? 'bg-[#5424A8]/12 border-[#5424A8]/45 text-[#30104B] dark:bg-[#8648F5]/25 dark:border-[#8648F5]/55 dark:text-white'
              : 'bg-white/75 dark:bg-[#190B33]/75 border-[#E2D4FF] dark:border-[#4B238F] text-[#5B5270] dark:text-[#CFC3EC]'
          }`}
        >
          <div className="flex items-center justify-between gap-1 text-[10.5px] font-bold">
            <span className="inline-flex items-center gap-1">
              <BellOff className="w-3 h-3" />
              <span>Mute Normal</span>
            </span>
            <span className="font-mono text-[9.5px] uppercase">
              {soundSettings.muteNormal ? 'ON' : 'OFF'}
            </span>
          </div>
        </button>

        <button
          type="button"
          disabled={isSoundSaving}
          onClick={() => updateSoundSettings({ criticalSeparate: !soundSettings.criticalSeparate })}
          className={`px-2.5 py-2 rounded-[12px] border text-left transition-all cursor-pointer ${
            soundSettings.criticalSeparate
              ? 'bg-rose-500/10 border-rose-400/45 text-rose-800 dark:bg-rose-500/18 dark:border-rose-400/40 dark:text-rose-200'
              : 'bg-white/75 dark:bg-[#190B33]/75 border-[#E2D4FF] dark:border-[#4B238F] text-[#5B5270] dark:text-[#CFC3EC]'
          }`}
        >
          <div className="flex items-center justify-between gap-1 text-[10.5px] font-bold">
            <span className="inline-flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" />
              <span>Critical Bypass</span>
            </span>
            <span className="font-mono text-[9.5px] uppercase">
              {soundSettings.criticalSeparate ? 'ON' : 'OFF'}
            </span>
          </div>
        </button>
      </div>

      {/* Category Preview & Restore Default */}
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value as NotificationSoundCategory)}
          aria-label="Pilih kategori suara"
          className="flex-1 min-w-[130px] px-2.5 py-1.5 rounded-[11px] text-[11px] font-bold bg-white dark:bg-[#190B33] text-[#28203A] dark:text-white border border-[#DFD0FA] dark:border-[#5D30B5] outline-none"
        >
          {SOUND_CATEGORY_CATALOG.map(cat => (
            <option key={cat.id} value={cat.id}>
              {cat.label} ({cat.durationLabel})
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => previewSound(selectedCategory, draftMasterVolume)}
          className="mj-notif-btn-3d px-3 py-1.5 rounded-[11px] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
        >
          <Play className="w-3 h-3 fill-current" />
          <span>Test Sound</span>
        </button>

        <button
          type="button"
          disabled={isSoundSaving}
          onClick={() => void restoreDefaultSoundSettings()}
          title="Kembalikan pengaturan suara ke default (Master 80%, Normal 65%, Important 85%, Critical 90%)"
          className="mj-notif-btn-3d-soft px-2.5 py-1.5 rounded-[11px] text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Default</span>
        </button>
      </div>

      {canOpenSoundSettingsPage && onOpenFullAudioEngine && (
        <div className="flex justify-end pt-0.5">
          <button
            type="button"
            onClick={onOpenFullAudioEngine}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-[#5424A8] dark:text-[#C59CFF] hover:underline cursor-pointer"
          >
            <span>Buka Pengaturan Suara Lengkap</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};
