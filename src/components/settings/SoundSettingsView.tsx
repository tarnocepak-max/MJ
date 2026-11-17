import React from 'react';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import {
  Volume2,
  VolumeX,
  Play,
  Radio,
  Sliders,
  Smartphone,
  Lock,
  AlertTriangle,
  Loader2,
  BellRing,
  CheckCircle2,
  RefreshCw,
  ShieldAlert
} from 'lucide-react';

export const SoundSettingsView: React.FC = () => {
  const { currentUser } = useApp();
  const { toast } = useToast();
  const isSuperAdmin = currentUser.role === 'super_admin';

  const {
    soundSettings,
    soundVersion,
    isSoundSaving,
    soundError,
    updateSoundSettings,
    playLoadingSound,
    playReadySound,
    playReportSavedSound,
    playErrorSound,
    playSyncSound
  } = useMoraJawsSound();

  const soundList = [
    {
      id: 'soundLoading' as const,
      name: '1. Loading Sound',
      desc: 'Nada sintetis pembuka saat aplikasi atau modul memuat data.',
      action: playLoadingSound
    },
    {
      id: 'soundReady' as const,
      name: '2. Ready Sound',
      desc: 'Chime kesiapan sistem saat inisialisasi atau login selesai.',
      action: playReadySound
    },
    {
      id: 'soundReportSaved' as const,
      name: '3. Report Saved Sound',
      desc: 'Nada selebrasi sukses saat teknisi menyimpan laporan WO.',
      action: playReportSavedSound
    },
    {
      id: 'soundError' as const,
      name: '4. Error Alert Sound',
      desc: 'Peringatan nada ganda saat terjadi kesalahan atau validasi gagal.',
      action: playErrorSound
    },
    {
      id: 'soundSync' as const,
      name: '5. Sync Data Sound',
      desc: 'Efek akustik saat sinkronisasi database PostgreSQL atau refresh ditekan.',
      action: playSyncSound
    }
  ];

  const handleTriggerInteractiveToast = (preset: 'success' | 'warning' | 'error' | 'sync') => {
    if (preset === 'success') {
      toast.success(
        'Check-in lapangan #PROGRESS & sinkronisasi telemetry OPM berhasil tercatat.',
        'Check-in GPS Berhasil',
        { withSound: true, badge: 'VERIFIED OPS' }
      );
    } else if (preset === 'warning') {
      toast.warning(
        'Antrean sinkronisasi lokal mendekati kapasitas. Pastikan koneksi 4G/Wi-Fi stabil.',
        'Kapasitas Antrean Lokal',
        {
          withSound: true,
          badge: 'PERINGATAN SISTEM',
          actionLabel: 'Periksa Sync',
          onAction: () => {
            toast.info('Panel Pusat Sinkron siap digunakan.', 'Navigasi');
          }
        }
      );
    } else if (preset === 'error') {
      toast.error(
        'Redaman melebihi batas toleransi FTTH (-24 dBm). Cek tekukan dropcore & kebersihan ferrule!',
        'Peringatan Redaman Tinggi',
        {
          withSound: true,
          badge: 'CRITICAL OPM',
          actionLabel: 'Perbaiki Jalur',
          onAction: () => {
            toast.info('Checklist perbaikan jalur dibuka.', 'Panduan SOP');
          }
        }
      );
    } else {
      toast.sync(
        'Data telemetry Work Order & foto bukti lapangan telah disinkronkan ke server.',
        'Sinkronisasi Telemetry Selesai',
        { withSound: true, badge: 'LIVE SYNC' }
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-[#160D29] rounded-2xl border border-[#D8B4FE]/30 p-5 shadow-[0_4px_24px_rgba(22,13,41,0.6)] relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#35105E] border border-[#D8B4FE]/40 text-white flex items-center justify-center shrink-0">
            <Volume2 className="w-5 h-5 text-[#E9D5FF]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-extrabold text-white tracking-tight">
                MoraJaws Audio & Sound Notifications
              </h3>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-[#35105E] text-[#D8B4FE] border border-[#D8B4FE]/30">
                <Radio className="w-3 h-3 text-emerald-400" />
                <span>Global Web Audio</span>
              </span>
              <span className="px-2 py-0.5 rounded text-[10.5px] font-mono tabular-nums font-bold bg-emerald-950/70 text-emerald-300 border border-emerald-500/30">
                v{soundVersion} • DB-First
              </span>
            </div>
            <p className="text-xs text-[#D8B4FE]/80 mt-0.5">
              Konfigurasi audio global tersimpan di PostgreSQL dan otomatis tersinkronisasi ke seluruh pengguna aktif.
            </p>
          </div>
        </div>

        {/* Master Sound Switch */}
        <div className="flex items-center gap-3 bg-[#35105E]/60 border border-[#D8B4FE]/30 px-3.5 py-2 rounded-xl">
          <span className="text-xs font-bold text-white">Master Sound:</span>
          <button
            type="button"
            disabled={!isSuperAdmin || isSoundSaving}
            onClick={() => updateSoundSettings({ enabled: !soundSettings.enabled })}
            className={`px-3 py-1 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
              soundSettings.enabled
                ? 'bg-[#7135B5] text-white border border-[#E9D5FF]/40'
                : 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
            } ${isSuperAdmin && !isSoundSaving ? 'cursor-pointer hover:bg-[#8245C7]' : 'opacity-60 cursor-not-allowed'}`}
          >
            {isSoundSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : soundSettings.enabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
            <span>{isSoundSaving ? 'MENYIMPAN...' : soundSettings.enabled ? 'AKTIF' : 'SENYAP'}</span>
          </button>
        </div>
      </div>

      {!isSuperAdmin && (
        <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center gap-2.5 text-xs text-amber-800 dark:text-amber-200">
          <Lock className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            <strong>Mode Baca Saja:</strong> Pengaturan audio global dikelola oleh Super Admin. Anda tetap dapat menguji suara pratinjau di perangkat ini.
          </span>
        </div>
      )}

      {soundError && (
        <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 flex items-center gap-2.5 text-xs text-rose-200">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{soundError}</span>
        </div>
      )}

      {/* Volume Slider Card */}
      <div className="bg-[#160D29] rounded-2xl border border-[#D8B4FE]/25 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#D8B4FE]/15">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#D8B4FE]" />
            <h4 className="font-extrabold text-white text-sm">
              Volume Output Audio Global
            </h4>
          </div>
          <span className="text-xs font-mono tabular-nums font-bold text-[#D8B4FE] bg-[#35105E] px-2.5 py-0.5 rounded-lg border border-[#D8B4FE]/30">
            {soundSettings.volume}%
          </span>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-4">
            <VolumeX className="w-4 h-4 text-[#D8B4FE]/50" />
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              disabled={!isSuperAdmin || isSoundSaving}
              value={soundSettings.volume}
              onChange={e => updateSoundSettings({ volume: parseInt(e.target.value, 10) })}
              className={`w-full h-2 bg-[#35105E] rounded-lg appearance-none accent-[#A855F7] ${
                isSuperAdmin && !isSoundSaving ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'
              }`}
            />
            <Volume2 className="w-5 h-5 text-[#A855F7]" />
          </div>
          <div className="flex justify-between text-[10.5px] text-[#D8B4FE]/60">
            <span>Senyap (0%)</span>
            <span>Standar Nyaman (50% - 75%)</span>
            <span>Maksimum (100%)</span>
          </div>
        </div>
      </div>

      {/* Sound Chimes Preview & Individual Toggles */}
      <div className="bg-[#160D29] rounded-2xl border border-[#D8B4FE]/25 p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#D8B4FE]/15">
          <div>
            <h4 className="font-extrabold text-white text-sm">
              Pratinjau Chime & Konfigurasi Notifikasi
            </h4>
            <p className="text-[11px] text-[#D8B4FE]/70 mt-0.5">
              Klik tombol uji untuk mendengarkan nada harmonik sintetis pada browser ini.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {soundList.map(item => {
            const isItemEnabled = soundSettings[item.id];
            return (
              <div
                key={item.id}
                className="p-4 rounded-xl bg-[#1E1138]/70 border border-[#D8B4FE]/20 hover:border-[#A855F7]/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-extrabold text-white text-xs sm:text-sm">
                      {item.name}
                    </span>
                    <button
                      type="button"
                      disabled={!isSuperAdmin || isSoundSaving}
                      onClick={() => updateSoundSettings({ [item.id]: !isItemEnabled })}
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold border transition-colors ${
                        isItemEnabled
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30'
                          : 'bg-rose-500/20 text-rose-300 border-rose-400/30'
                      } ${isSuperAdmin && !isSoundSaving ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}
                    >
                      {isItemEnabled ? 'Aktif' : 'Nonaktif'}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#D8B4FE]/70">
                    {item.desc}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={item.action}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-[#7135B5] hover:bg-[#7E3CC7] border border-[#E9D5FF]/30 flex items-center justify-center gap-1.5 transition-all cursor-pointer shrink-0 self-end sm:self-center"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Uji Suara</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Interactive Tactile Toast + Audio Sandbox (in Settings only, away from technician operational views) */}
      <div className="tactile-card-shell bg-white dark:bg-[#1E1238] rounded-2xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E8DDFF] dark:border-[#35105E]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center border border-[#E8DDFF] dark:border-[#7135B5]/50">
              <BellRing className="w-4.5 h-4.5" />
            </div>
            <div>
              <h4 className="font-display font-bold text-sm text-[#1F1638] dark:text-white">
                Test Interaktif Tactile Toast &amp; Audio
              </h4>
              <p className="text-[11px] text-[#7D7484] dark:text-[#CEC0E8]">
                Uji notifikasi 3D melayang (hover untuk menahan timer) sekaligus memutar chime operasional.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <button
            type="button"
            onClick={() => handleTriggerInteractiveToast('success')}
            className="tactile-btn-secondary p-3 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-emerald-200 dark:border-emerald-500/40 text-left flex items-center gap-2.5 cursor-pointer"
          >
            <span className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="font-bold text-xs text-[#1F1638] dark:text-white">Toast Sukses</div>
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#CEC0E8] truncate">Check-in &amp; Chime</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleTriggerInteractiveToast('warning')}
            className="tactile-btn-secondary p-3 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-amber-200 dark:border-amber-500/40 text-left flex items-center gap-2.5 cursor-pointer"
          >
            <span className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="font-bold text-xs text-[#1F1638] dark:text-white">Toast Peringatan</div>
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#CEC0E8] truncate">Antrean &amp; CTA Sync</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleTriggerInteractiveToast('error')}
            className="tactile-btn-secondary p-3 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-rose-200 dark:border-rose-500/40 text-left flex items-center gap-2.5 cursor-pointer"
          >
            <span className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-950 text-[#BA1A1A] dark:text-rose-300 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="font-bold text-xs text-[#1F1638] dark:text-white">Alert Kritis OPM</div>
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#CEC0E8] truncate">Error Tone + CTA</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleTriggerInteractiveToast('sync')}
            className="tactile-btn-secondary p-3 rounded-xl bg-[#F8F1FF] dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#7135B5]/50 text-left flex items-center gap-2.5 cursor-pointer"
          >
            <span className="w-8 h-8 rounded-lg bg-[#E9D5FF] dark:bg-[#35105E] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <RefreshCw className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <div className="font-bold text-xs text-[#1F1638] dark:text-white">Toast Telemetry Sync</div>
              <div className="text-[10.5px] text-[#7D7484] dark:text-[#CEC0E8] truncate">Sync Chime Feedback</div>
            </div>
          </button>
        </div>
      </div>

      {/* Android & Mobile Compatibility Info Box */}
      <div className="p-4 rounded-2xl bg-[#35105E]/40 border border-[#D8B4FE]/25 flex items-start gap-3 text-xs text-[#D8B4FE]">
        <Smartphone className="w-5 h-5 text-[#A855F7] shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold text-white">
            Optimasi Audio Layar Sentuh Android & Desktop
          </p>
          <p className="text-[11px] leading-relaxed text-[#E9D5FF]/85">
            Sistem audio MoraJaws secara otomatis membuka kunci Web Audio Context pada ketukan atau klik pertama pengguna di perangkat mobile/Android, sehingga notifikasi suara berbunyi jernih tanpa memerlukan unduhan aset audio eksternal.
          </p>
        </div>
      </div>
    </div>
  );
};
