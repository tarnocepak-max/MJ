import React, { useEffect, useMemo, useState } from 'react';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
import { NotificationInline } from '../notification/NotificationInline';
import { NotificationSoundCategory } from '../../types';
import {
  DEFAULT_CATEGORY_VOLUMES,
  DEFAULT_SOUND_SETTINGS,
  SOUND_CATEGORY_CATALOG
} from '../../services/notificationAudioService';
import {
  Volume2,
  VolumeX,
  Play,
  Radio,
  Sliders,
  Smartphone,
  AlertTriangle,
  Loader2,
  BellRing,
  BellOff,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Layers,
  Trash2,
  ArrowRight,
  Clock,
  Activity,
  MousePointerClick,
  PauseCircle,
  RotateCcw,
  MessageCircle,
  ClipboardCheck,
  Mail
} from 'lucide-react';

interface SoundSettingsViewProps {
  onNavigateTab?: (tab: string) => void;
  onOpenEmailNotifications?: () => void;
}

export const SoundSettingsView: React.FC<SoundSettingsViewProps> = ({
  onNavigateTab,
  onOpenEmailNotifications
}) => {
  const {
    currentUser,
    scopedTickets,
    overdueSummary,
    todayWIB,
    databaseStatus,
    syncStatus,
    refreshDatabaseData
  } = useApp();
  const { toast, toasts, clearAllToasts } = useToast();
  const { pendingCount } = useOfflineSync();

  const isSuperAdmin = currentUser.role === 'super_admin';
  const [pressCount, setPressCount] = useState(0);
  const [isRefreshingTelemetry, setIsRefreshingTelemetry] = useState(false);
  const [testCategory, setTestCategory] = useState<NotificationSoundCategory>('wo_assignment');

  const {
    soundSettings,
    soundVersion,
    soundScope,
    hasPersonalOverride,
    audioEngineState,
    isSoundSaving,
    soundError,
    updateSoundSettings,
    restoreDefaultSoundSettings,
    unlockAudio,
    playReadySound,
    previewSound
  } = useMoraJawsSound();

  const [draftMasterVol, setDraftMasterVol] = useState(soundSettings.volume);
  const [draftNormalVol, setDraftNormalVol] = useState(
    soundSettings.categoryVolumes?.normal ?? DEFAULT_CATEGORY_VOLUMES.normal
  );
  const [draftImportantVol, setDraftImportantVol] = useState(
    soundSettings.categoryVolumes?.important ?? DEFAULT_CATEGORY_VOLUMES.important
  );
  const [draftCriticalVol, setDraftCriticalVol] = useState(
    soundSettings.categoryVolumes?.critical ?? DEFAULT_CATEGORY_VOLUMES.critical
  );

  useEffect(() => {
    setDraftMasterVol(soundSettings.volume);
    setDraftNormalVol(soundSettings.categoryVolumes?.normal ?? DEFAULT_CATEGORY_VOLUMES.normal);
    setDraftImportantVol(
      soundSettings.categoryVolumes?.important ?? DEFAULT_CATEGORY_VOLUMES.important
    );
    setDraftCriticalVol(soundSettings.categoryVolumes?.critical ?? DEFAULT_CATEGORY_VOLUMES.critical);
  }, [soundSettings]);

  // Real operational telemetry computed dynamically from Supabase state
  const liveTelemetry = useMemo(() => {
    const activeNonDeleted = scopedTickets.filter(t => !t.isArchived && !t.isDeleted);
    const todayTickets = activeNonDeleted.filter(t => getTicketAppointmentDate(t) === todayWIB);

    const unassignedToday = todayTickets.filter(t => !t.installerName || !t.installerName.trim()).length;
    const pendingApprovalCount = activeNonDeleted.filter(t => t.approvalStatus === 'BUTUH APPROVAL').length;

    const completedToday = todayTickets.filter(t => {
      const s = (t.statusWOInstaller || '').toLowerCase();
      const a = (t.statusWOAgent || '').toLowerCase();
      return (
        s === 'completed' ||
        s === 'installed' ||
        a === 'done' ||
        a === 'resolved' ||
        a === 'closed' ||
        t.approvalStatus === 'APPROVED'
      );
    }).length;

    const approvalPct = todayTickets.length > 0 ? Math.min(100, Math.round((pendingApprovalCount / todayTickets.length) * 100)) : 0;
    const completionPct = todayTickets.length > 0 ? Math.min(100, Math.round((completedToday / todayTickets.length) * 100)) : 0;

    return {
      totalToday: todayTickets.length,
      unassignedToday,
      pendingApprovalCount,
      completedToday,
      approvalPct,
      completionPct,
      totalOverdue: overdueSummary?.totalOverdue || 0
    };
  }, [scopedTickets, todayWIB, overdueSummary]);

  const soundList = [
    {
      id: 'soundLoading' as const,
      name: '1. App Loading',
      freq: '340 ms · Digital Intro Chime',
      dotColor: 'bg-[#6657C8] dark:bg-[#8648F5]',
      action: () => previewSound('loading')
    },
    {
      id: 'soundReady' as const,
      name: '2. System Ready',
      freq: '340 ms · Elegant Digital Chime',
      dotColor: 'bg-emerald-500',
      action: () => previewSound('ready')
    },
    {
      id: 'soundReportSaved' as const,
      name: '3. Report Saved Success',
      freq: '400 ms · Confirmation Tone',
      dotColor: 'bg-emerald-600',
      action: () => previewSound('report_saved')
    },
    {
      id: 'soundError' as const,
      name: '4. Critical / Error Alert',
      freq: '780 ms · Multi-Tone Urgent',
      dotColor: 'bg-[#BA1A1A]',
      action: () => previewSound('error')
    },
    {
      id: 'soundSync' as const,
      name: '5. Auto-Sync Relay',
      freq: '340 ms · Clean Sync Chime',
      dotColor: 'bg-amber-500',
      action: () => previewSound('sync')
    }
  ];

  const handleTestCategoryNotification = (category: NotificationSoundCategory) => {
    previewSound(category, draftMasterVol);

    switch (category) {
      case 'success':
        toast.success(
          `Konfirmasi sukses: ${liveTelemetry.completedToday} WO hari ini rampung (${liveTelemetry.completionPct}%).`,
          'Success',
          { soundCategory: 'success', withSound: false }
        );
        break;
      case 'live_chat':
        toast.info('Ada pesan baru dari Dispatch terkait jadwal instalasi pelanggan.', 'Live Chat', {
          soundCategory: 'live_chat',
          withSound: false
        });
        break;
      case 'wo_assignment':
        toast.info('WO #MJ-2026-1001 berhasil di-assign ke teknisi lapangan.', 'WO Assignment', {
          soundCategory: 'wo_assignment',
          withSound: false
        });
        break;
      case 'important':
        toast.warning(
          `${liveTelemetry.pendingApprovalCount} laporan instalasi menunggu review QC Desk.`,
          'Important Alert',
          { soundCategory: 'important', withSound: false }
        );
        break;
      case 'critical':
        toast.error(
          `Terdeteksi ${liveTelemetry.totalOverdue} WO Overdue yang memerlukan tindak lanjut segera.`,
          'Critical Alert',
          { soundCategory: 'critical', withSound: false }
        );
        break;
      default:
        toast.info('Notifikasi sistem MoraJaws berjalan normal.', 'MoraJaws', {
          soundCategory: 'normal',
          withSound: false
        });
        break;
    }
  };

  const handleTriggerInteractiveToast = (preset: 'success' | 'warning' | 'error' | 'sync') => {
    if (preset === 'success') {
      toast.success(
        `Operasional sinkron: ${liveTelemetry.completedToday} WO hari ini selesai (${liveTelemetry.completionPct}%).`,
        'Success Dispatch',
        { withSound: true, badge: 'HTTP 200 OK', soundCategory: 'success' }
      );
    } else if (preset === 'warning') {
      toast.warning(
        `Antrean verifikasi foto QC saat ini: ${liveTelemetry.pendingApprovalCount} WO menunggu review.`,
        'Capacity & QA Queue Warn',
        {
          withSound: true,
          badge: 'TELEMETRY WARN',
          soundCategory: 'important',
          actionLabel: 'Buka QA Desk',
          onAction: () => onNavigateTab?.('verification_desk')
        }
      );
    } else if (preset === 'error') {
      toast.error(
        `Terdeteksi ${liveTelemetry.totalOverdue} WO Overdue & ${liveTelemetry.unassignedToday} WO belum di-assign hari ini.`,
        'Critical P1 Alert',
        {
          withSound: true,
          badge: 'CRITICAL P1',
          soundCategory: 'critical',
          actionLabel: 'Triage Overdue',
          onAction: () => onNavigateTab?.('overdue_wo')
        }
      );
    } else {
      toast.sync(
        `Status PostgreSQL: ${databaseStatus.toUpperCase()} · ${pendingCount} mutasi pending offline queue.`,
        'Auto-Sync Telemetry',
        { withSound: true, badge: 'DATA RELAY', soundCategory: 'normal' }
      );
    }
  };

  const handleRefreshTelemetry = async () => {
    setIsRefreshingTelemetry(true);
    try {
      await refreshDatabaseData();
      toast.sync('Telemetry database & alert engine telah diperbarui.', 'Refresh Telemetry', {
        withSound: true,
        badge: 'LIVE SYNC'
      });
    } finally {
      setIsRefreshingTelemetry(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* HERO HEADER CARD — Stitch v4.14 Spec in MoraJaws Lilac + Dark Purple + Maroon */}
      <div className="card-3d-lavender rounded-2xl p-5 sm:p-6 relative overflow-hidden">
        <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-[#6657C8]/10 dark:bg-[#7135B5]/20 blur-2xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#EAE8FF] via-[#DDF4F4] to-[#E2ECFA] text-[#5145A6] border border-[#C5BEEF] dark:border-transparent dark:from-[#58149C] dark:via-[#431599] dark:to-[#480123] dark:text-white flex items-center justify-center shrink-0 shadow-xs dark:shadow-[0_3px_0_#240644]">
              <BellRing className="w-6 h-6 text-[#5145A6] dark:text-[#F3EAFF]" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg sm:text-xl font-extrabold text-[#26364A] dark:text-white tracking-tight">
                  Tactile 3D Alerts &amp; Notification Engine
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-[#6657C8] dark:bg-[#58149C] text-white shadow-2xs">
                  V4.14 SPEC
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1]">
                  Audio v{soundVersion} · DB-First
                </span>
              </div>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] max-w-2xl leading-relaxed">
                Sistem notifikasi taktil 3D MoraJaws dengan specular highlights, animasi spring physics, integrasi telemetry live PostgreSQL, dan mesin audio Web Audio API.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                    soundSettings.enabled
                      ? 'bg-[#EAE8FF] text-[#5145A6] border-[#C5BEEF] dark:bg-[#2E1459] dark:text-[#DAB9FF] dark:border-[#5B35B1]'
                      : 'bg-rose-50 text-[#BA1A1A] border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                  }`}
                >
                  {soundSettings.enabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span>Operational Chirps: {soundSettings.enabled ? 'ON' : 'OFF'}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white dark:bg-[#160D29] text-[#5145A6] dark:text-[#D8B4FE] border border-[#DDE6F0] dark:border-[#3B1D78] font-mono tabular-nums">
                  <Activity className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#D8B4FE]" />
                  <span>Active Toasts: {toasts.length}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white dark:bg-[#160D29] text-[#52647A] dark:text-[#CEC0E8] border border-[#DDE6F0] dark:border-[#3B1D78]">
                  <span className={`w-2 h-2 rounded-full ${databaseStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span>Relay: {databaseStatus.toUpperCase()}</span>
                </span>
                {isSuperAdmin && (onOpenEmailNotifications || onNavigateTab) && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenEmailNotifications) onOpenEmailNotifications();
                      else onNavigateTab?.('email_notifications');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold bg-[#EAE8FF] hover:bg-[#DFDBFF] text-[#5145A6] border border-[#C5BEEF] dark:bg-[#2E1459] dark:hover:bg-[#3A1B6E] dark:text-[#E9D5FF] dark:border-[#5B35B1] transition-colors cursor-pointer"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Email Notification Center</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Master Audio Toggle */}
          <div className="flex items-center gap-3 mj-tactile-well px-4 py-3 rounded-xl shrink-0">
            {isSoundSaving && <Loader2 className="w-4 h-4 text-[#6657C8] dark:text-[#D8B4FE] animate-spin" />}
            <div>
              <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                Master Audio Notifikasi
              </div>
              <div className="text-[11px] font-semibold text-[#5145A6] dark:text-[#D8B4FE]">
                {soundSettings.enabled
                  ? `Aktif (${soundScope === 'global' ? 'Global DB' : 'Perangkat Ini'})`
                  : soundSettings.criticalSeparate
                  ? 'Normal Senyap · Critical Aktif'
                  : 'Nonaktif (Senyap)'}
              </div>
            </div>
            <button
              type="button"
              disabled={isSoundSaving}
              onClick={() => updateSoundSettings({ enabled: !soundSettings.enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                soundSettings.enabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
              }`}
              title="Aktif/Nonaktifkan Master Audio"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  soundSettings.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Role Scope & Error Status Banners */}
      {!isSuperAdmin && (
        <NotificationInline
          variant="info"
          message={
            hasPersonalOverride
              ? 'Menggunakan Preferensi Audio Perangkat Anda'
              : 'Mengikuti Standar Audio Global'
          }
          detail="Anda dapat mengatur volume, mute notifikasi normal, serta menguji setiap kategori suara untuk perangkat ini tanpa mengubah default global Super Admin."
        />
      )}

      {soundError && <NotificationInline variant="error" message={soundError} />}

      {/* 4 PHYSICS & ARCHITECTURE SPEC TILES */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card-3d-lavender rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
              DEFAULT DWELL
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white mt-0.5 tabular-nums">
              3,600–6,800 ms
            </div>
            <div className="text-[10.5px] font-semibold text-[#5145A6] dark:text-[#D8B4FE]">Adaptive Drain</div>
          </div>
        </div>

        <div className="card-3d-lavender rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
              PHYSICS CURVE
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white mt-0.5">
              Spring Overshoot
            </div>
            <div className="text-[10.5px] font-mono font-semibold text-[#5145A6] dark:text-[#D8B4FE]">c(0.34, 1.56)</div>
          </div>
        </div>

        <div className="card-3d-lavender rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
              Z-EXTRUSION
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white mt-0.5">
              3.5px Dual-Bevel
            </div>
            <div className="text-[10.5px] font-semibold text-[#5145A6] dark:text-[#D8B4FE]">Layered Tactile</div>
          </div>
        </div>

        <div className="card-3d-lavender rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
            <PauseCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#8492A5] dark:text-[#A493C2]">
              HOVER INTERRUPT
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white mt-0.5">
              Tactile Freeze
            </div>
            <div className="text-[10.5px] font-semibold text-[#5145A6] dark:text-[#D8B4FE]">Pointer Latch</div>
          </div>
        </div>
      </div>

      {/* INTERACTIVE DISPATCH PLAYGROUND */}
      <div className="card-3d-lavender rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[#5145A6] dark:text-[#D8B4FE] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#6657C8] dark:bg-[#7135B5] animate-pulse" />
              <span>INTERACTIVE DISPATCH PLAYGROUND</span>
            </div>
            <h3 className="font-display text-base sm:text-lg font-extrabold text-[#26364A] dark:text-white mt-0.5">
              Trigger Live 3D Extruded Notifications
            </h3>
            <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] mt-0.5">
              Klik tombol di bawah untuk memicu notifikasi toast 3D dengan angka telemetry nyata, progress bar drain otomatis, dan audio chirp.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              clearAllToasts();
            }}
            className="btn-3d-lilac px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center gap-2 cursor-pointer shrink-0 self-start sm:self-auto"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#DAB9FF]" />
            <span>Flush Toast Stack ({toasts.length})</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* Trigger 1: Success */}
          <button
            type="button"
            onClick={() => handleTriggerInteractiveToast('success')}
            className="mj-tactile-well p-4 rounded-2xl text-left flex flex-col justify-between gap-3 hover:border-emerald-400 dark:hover:border-emerald-700 hover:-translate-y-0.5 transition-all cursor-pointer group"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                  <CheckCircle2 className="w-4 h-4" />
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  HTTP 200 OK
                </span>
              </div>
              <div className="font-display font-bold text-sm text-[#26364A] dark:text-white">
                Success Dispatch
              </div>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] line-clamp-2">
                {liveTelemetry.completedToday} WO hari ini rampung ({liveTelemetry.completionPct}%) dengan sinkronisasi DB aktif.
              </p>
            </div>
            <div className="flex items-center justify-between text-[11px] font-extrabold text-emerald-700 dark:text-emerald-400 pt-1">
              <span>FIRE TOAST</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>

          {/* Trigger 2: Warning */}
          <button
            type="button"
            onClick={() => handleTriggerInteractiveToast('warning')}
            className="mj-tactile-well p-4 rounded-2xl text-left flex flex-col justify-between gap-3 hover:border-amber-400 dark:hover:border-amber-700 hover:-translate-y-0.5 transition-all cursor-pointer group"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                  <AlertTriangle className="w-4 h-4" />
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  TELEMETRY WARN
                </span>
              </div>
              <div className="font-display font-bold text-sm text-[#26364A] dark:text-white">
                Pending QC Alert
              </div>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] line-clamp-2">
                {liveTelemetry.pendingApprovalCount} laporan foto instalasi sedang menunggu antrean verifikasi QC.
              </p>
            </div>
            <div className="flex items-center justify-between text-[11px] font-extrabold text-amber-700 dark:text-amber-400 pt-1">
              <span>FIRE TOAST</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>

          {/* Trigger 3: Critical P1 / Maroon */}
          <button
            type="button"
            onClick={() => handleTriggerInteractiveToast('error')}
            className="mj-tactile-well p-4 rounded-2xl text-left flex flex-col justify-between gap-3 hover:border-[#881337] dark:hover:border-rose-700 hover:-translate-y-0.5 transition-all cursor-pointer group"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-[#881337] dark:text-rose-300 flex items-center justify-center">
                  <ShieldAlert className="w-4 h-4" />
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-50 text-[#881337] dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                  CRITICAL P1
                </span>
              </div>
              <div className="font-display font-bold text-sm text-[#26364A] dark:text-white">
                Overdue &amp; Unassigned
              </div>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] line-clamp-2">
                {liveTelemetry.totalOverdue} tiket overdue · {liveTelemetry.unassignedToday} belum ter-assign hari ini.
              </p>
            </div>
            <div className="flex items-center justify-between text-[11px] font-extrabold text-[#881337] dark:text-rose-400 pt-1">
              <span>FIRE TOAST</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>

          {/* Trigger 4: Auto-Sync Telemetry */}
          <button
            type="button"
            onClick={() => handleTriggerInteractiveToast('sync')}
            className="mj-tactile-well p-4 rounded-2xl text-left flex flex-col justify-between gap-3 hover:border-[#9E95DE] dark:hover:border-[#9B6BE8] hover:-translate-y-0.5 transition-all cursor-pointer group"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="w-8 h-8 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center">
                  <RefreshCw className="w-4 h-4" />
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1]">
                  DATA RELAY
                </span>
              </div>
              <div className="font-display font-bold text-sm text-[#26364A] dark:text-white">
                Auto-Sync Telemetry
              </div>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] line-clamp-2">
                Status sync: {syncStatus.toUpperCase()} · Antrean offline {pendingCount} mutasi siap disinkronkan.
              </p>
            </div>
            <div className="flex items-center justify-between text-[11px] font-extrabold text-[#5145A6] dark:text-[#D8B4FE] pt-1">
              <span>FIRE TOAST</span>
              <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </button>
        </div>
      </div>

      {/* ENTERPRISE BANNER SYSTEM — LIVE OPERATIONAL TELEMETRY BANNERS */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-1 px-1">
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[#5145A6] dark:text-[#D8B4FE]">
              ENTERPRISE BANNER SYSTEM
            </div>
            <h3 className="font-display text-base sm:text-lg font-extrabold text-[#26364A] dark:text-white">
              Standard Operations Alert Banners (Live Data)
            </h3>
          </div>
          <span className="text-[11px] text-[#8492A5] dark:text-[#A493C2]">
            Tactile extruded bars dengan CTA operasional langsung
          </span>
        </div>

        {/* 1. Critical Maroon Banner: Real Overdue & Unassigned WOs */}
        <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 border-l-4 border-l-[#881337] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/60 text-[#881337] dark:text-rose-300 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider">
                <span className="px-2 py-0.5 rounded bg-rose-100 text-[#881337] dark:bg-rose-950/70 dark:text-rose-300">
                  CRITICAL SLA WATCH
                </span>
                <span className="text-[#8492A5] dark:text-[#A493C2] font-mono">
                  Tanggal Operasional: {todayWIB} WIB
                </span>
              </div>
              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white">
                {liveTelemetry.totalOverdue} Tiket Overdue &amp; {liveTelemetry.unassignedToday} WO Belum Ter-Assign Hari Ini
              </h4>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                Pantau tiket yang melewati slot appointment agar distribusi teknisi mitra segera ditindaklanjuti dari antrean overdue dan dispatch desk.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onNavigateTab?.('overdue_wo')}
              className="btn-3d-maroon px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>Triage Overdue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab?.('tickets')}
              className="btn-3d-lilac px-3.5 py-2 min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>Buka Work Orders</span>
            </button>
          </div>
        </div>

        {/* 2. Verification / Approval Queue Banner */}
        <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 border-l-4 border-l-amber-500 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
              <Radio className="w-5 h-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider">
                <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                  VERIFICATION QUEUE
                </span>
                <span className="text-[#8492A5] dark:text-[#A493C2] font-mono">
                  BUTUH APPROVAL · QC DESK
                </span>
              </div>
              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white">
                {liveTelemetry.pendingApprovalCount} Laporan Teknisi Menunggu Persetujuan Dispatch / QA
              </h4>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                Laporan yang telah diunggah installer beserta bukti foto ODP/FAT dan redaman OPM menunggu validasi akhir sebelum status ditutup.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="mj-tactile-well px-3 py-2 rounded-xl min-w-[140px]">
              <div className="flex items-center justify-between text-[10px] font-bold text-[#52647A] dark:text-[#CEC0E8] mb-1">
                <span>Rasio Antrean</span>
                <span className="font-mono text-amber-700 dark:text-amber-300">{liveTelemetry.approvalPct}%</span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-amber-100 dark:bg-amber-950 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: `${liveTelemetry.approvalPct}%` }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigateTab?.('verification_desk')}
              className="btn-3d-amber px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>Buka Antrean QA</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 3. Completion Telemetry Banner */}
        <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 border-l-4 border-l-emerald-500 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider">
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                  DAILY EXECUTION RATE
                </span>
                <span className="text-[#8492A5] dark:text-[#A493C2] font-mono">
                  {liveTelemetry.completedToday}/{liveTelemetry.totalToday} WO SELESAI
                </span>
              </div>
              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white">
                {liveTelemetry.completedToday} dari {liveTelemetry.totalToday} Work Order Hari Ini Telah Selesai ({liveTelemetry.completionPct}%)
              </h4>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                Rekapitulasi penyelesaian harian berdasarkan kluster area, kontraktor pelaksana, dan status instalasi aktual dari server.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigateTab?.('contractor_recap')}
            className="btn-3d-emerald px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 self-start lg:self-auto"
          >
            <span>Lihat Rekap WO</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 4. System Sync & Offline Queue Banner */}
        <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 border-l-4 border-l-[#6657C8] dark:border-l-[#7135B5] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <RefreshCw className={`w-5 h-5 ${isRefreshingTelemetry ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider">
                <span className="px-2 py-0.5 rounded bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF]">
                  SYNC TELEMETRY ENGINE
                </span>
                <span className="text-[#8492A5] dark:text-[#A493C2] font-mono">
                  DB: {databaseStatus.toUpperCase()} · QUEUE: {pendingCount} PENDING
                </span>
              </div>
              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#26364A] dark:text-white">
                Sinkronisasi Cloud PostgreSQL ({syncStatus.toUpperCase()})
              </h4>
              <p className="text-xs text-[#52647A] dark:text-[#CEC0E8] leading-relaxed">
                Memastikan seluruh mutasi status tiket, log audit, dan preferensi audio tersinkron secara real-time di semua operator.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isRefreshingTelemetry}
            onClick={handleRefreshTelemetry}
            className="btn-3d-darkpurple px-4 py-2 min-h-[38px] rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer shrink-0 self-start lg:self-auto disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingTelemetry ? 'animate-spin' : ''}`} />
            <span>{isRefreshingTelemetry ? 'Menyinkronkan...' : 'Refresh Telemetry'}</span>
          </button>
        </div>
      </div>

      {/* BOTTOM ASYMMETRIC SPLIT: 3D TACTILE SPECS (7 COL) & TELECOMMUNICATIONS AUDIO ENGINE (5 COL) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* LEFT (7 Cols): 3D Tactile Rendering & Interactive Press Sandbox */}
        <div className="xl:col-span-7 card-3d-lavender rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#DDE6F0] dark:border-[#3B1D78]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#EAE8FF] dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-display font-extrabold text-sm text-[#26364A] dark:text-white">
                  3D Tactile Rendering &amp; Animation Physics Specs
                </h3>
                <p className="text-[11px] text-[#8492A5] dark:text-[#A493C2]">
                  Hardware-accelerated keyframe matrices &amp; dual-plane bevel shading
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#C5BEEF] dark:border-[#5B35B1] shrink-0">
              60fps GPU
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="mj-tactile-well p-3.5 rounded-xl space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">
                ENTRANCE VECTOR
              </div>
              <div className="font-bold text-xs text-[#26364A] dark:text-white">Spring Overshoot</div>
              <code className="block p-2 rounded-lg bg-[#EDF3F8] text-[#5145A6] border border-[#DDE6F0] dark:border-transparent dark:bg-[#160D29] dark:text-[#E9D5FF] text-[10px] font-mono leading-relaxed">
                cubic-bezier(0.34, 1.56, 0.64, 1)
              </code>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] leading-snug">
                Efek pegas 8px cepat yang langsung terkunci presisi saat alert masuk.
              </p>
            </div>

            <div className="mj-tactile-well p-3.5 rounded-xl space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">
                SURFACE SPECULAR
              </div>
              <div className="font-bold text-xs text-[#26364A] dark:text-white">Dual-Plane Extrusion</div>
              <code className="block p-2 rounded-lg bg-[#EDF3F8] text-[#5145A6] border border-[#DDE6F0] dark:border-transparent dark:bg-[#160D29] dark:text-[#E9D5FF] text-[10px] font-mono leading-relaxed">
                inset 0 1px rgba(255,255,255,0.6)
              </code>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] leading-snug">
                Top edge specular highlight dengan kedalaman bottom bezel 3.5px.
              </p>
            </div>

            <div className="mj-tactile-well p-3.5 rounded-xl space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">
                DECAY DYNAMICS
              </div>
              <div className="font-bold text-xs text-[#26364A] dark:text-white">Progressive Draining</div>
              <code className="block p-2 rounded-lg bg-[#EDF3F8] text-[#5145A6] border border-[#DDE6F0] dark:border-transparent dark:bg-[#160D29] dark:text-[#E9D5FF] text-[10px] font-mono leading-relaxed">
                transition: width linear
              </code>
              <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8] leading-snug">
                Timer bar berkurang halus dan langsung jeda saat pointer menyentuh toast.
              </p>
            </div>
          </div>

          {/* Interactive Tactile Pressing Sandbox */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-[#EAE8FF]/70 via-[#F4F7FB] to-[#DDF4F4]/70 dark:bg-none dark:bg-[#160D29]/80 border border-[#C5BEEF] dark:border-[#3B1D78] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#2E1459] text-[#5145A6] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                <MousePointerClick className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-extrabold text-[#26364A] dark:text-white">
                  Try Interactive Tactile Pressing
                </div>
                <p className="text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
                  Tekan &amp; tahan tombol untuk merasakan fisika key-travel 3D ({pressCount}x ditekan).
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setPressCount(c => c + 1);
                playReadySound();
              }}
              className="btn-3d-primary px-4 py-2.5 min-h-[40px] rounded-xl text-xs font-extrabold cursor-pointer shrink-0"
            >
              Press Me (Tactile Sunk)
            </button>
          </div>
        </div>

        {/* RIGHT (5 Cols): NOTIFICATION SOUND SETTINGS & CATEGORY PREVIEW */}
        <div className="xl:col-span-5 card-3d-lavender rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#DDE6F0] dark:border-[#3B1D78]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[#6657C8] dark:bg-[#8648F5]" />
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">
                  IMPERIAL VIOLET AUDIO ENGINE
                </div>
                <h3 className="font-display font-extrabold text-sm text-[#26364A] dark:text-white">
                  Notification Sound Settings
                </h3>
              </div>
            </div>

            <button
              type="button"
              disabled={isSoundSaving}
              onClick={() => {
                void restoreDefaultSoundSettings();
                toast.info(
                  `Pengaturan suara dikembalikan ke default (Master ${DEFAULT_SOUND_SETTINGS.volume}%).`,
                  'Restore Default'
                );
              }}
              className="btn-3d-lilac px-2.5 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
              title="Kembalikan pengaturan suara ke nilai default"
            >
              <RotateCcw className="w-3 h-3 text-[#5145A6] dark:text-[#DAB9FF]" />
              <span>Restore Default</span>
            </button>
          </div>

          {/* Master Volume Slider (0-100%) + Preview */}
          <div className="mj-tactile-well p-3.5 rounded-xl space-y-2.5">
            <div className="flex items-center justify-between text-xs gap-2">
              <div className="flex items-center gap-1.5 font-bold text-[#26364A] dark:text-white">
                <Sliders className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                <span>Master Volume</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-extrabold text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                  {draftMasterVol}%
                </span>
                <button
                  type="button"
                  onClick={() => previewSound(testCategory, draftMasterVol)}
                  className="mj-notif-btn-3d-soft px-2 py-0.5 rounded-lg text-[10.5px] font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>Preview</span>
                </button>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={draftMasterVol}
              onChange={e => setDraftMasterVol(Number(e.target.value))}
              onMouseUp={() => void updateSoundSettings({ volume: draftMasterVol })}
              onTouchEnd={() => void updateSoundSettings({ volume: draftMasterVol })}
              onBlur={() => {
                if (draftMasterVol !== soundSettings.volume) {
                  void updateSoundSettings({ volume: draftMasterVol });
                }
              }}
              aria-label="Master Volume"
              className="w-full h-2 bg-[#DDE6F0] dark:bg-[#2E1459] rounded-lg appearance-none cursor-pointer accent-[#6657C8] dark:accent-[#58149C]"
            />

            {/* Priority Tier Volume Controls: Normal 65% / Important 85% / Critical 90% */}
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#DDE6F0]/80 dark:border-[#3B1D78]/70">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-[#52647A] dark:text-[#CEC0E8]">Normal</span>
                  <span className="font-mono text-[#5145A6] dark:text-[#DAB9FF] tabular-nums">
                    {draftNormalVol}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={draftNormalVol}
                  onChange={e => setDraftNormalVol(Number(e.target.value))}
                  onMouseUp={() =>
                    void updateSoundSettings({
                      categoryVolumes: {
                        ...(soundSettings.categoryVolumes || DEFAULT_CATEGORY_VOLUMES),
                        normal: draftNormalVol
                      }
                    })
                  }
                  onTouchEnd={() =>
                    void updateSoundSettings({
                      categoryVolumes: {
                        ...(soundSettings.categoryVolumes || DEFAULT_CATEGORY_VOLUMES),
                        normal: draftNormalVol
                      }
                    })
                  }
                  className="w-full h-1.5 bg-[#DDE6F0] dark:bg-[#2E1459] rounded-lg appearance-none cursor-pointer accent-[#6657C8] dark:accent-[#58149C]"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-amber-700 dark:text-amber-300">Important</span>
                  <span className="font-mono text-amber-700 dark:text-amber-300 tabular-nums">
                    {draftImportantVol}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={draftImportantVol}
                  onChange={e => setDraftImportantVol(Number(e.target.value))}
                  onMouseUp={() =>
                    void updateSoundSettings({
                      categoryVolumes: {
                        ...(soundSettings.categoryVolumes || DEFAULT_CATEGORY_VOLUMES),
                        important: draftImportantVol
                      }
                    })
                  }
                  onTouchEnd={() =>
                    void updateSoundSettings({
                      categoryVolumes: {
                        ...(soundSettings.categoryVolumes || DEFAULT_CATEGORY_VOLUMES),
                        important: draftImportantVol
                      }
                    })
                  }
                  className="w-full h-1.5 bg-amber-100 dark:bg-amber-950/60 rounded-lg appearance-none cursor-pointer accent-amber-600"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] font-bold">
                  <span className="text-rose-700 dark:text-rose-300">Critical</span>
                  <span className="font-mono text-rose-700 dark:text-rose-300 tabular-nums">
                    {draftCriticalVol}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={draftCriticalVol}
                  onChange={e => setDraftCriticalVol(Number(e.target.value))}
                  onMouseUp={() =>
                    void updateSoundSettings({
                      categoryVolumes: {
                        ...(soundSettings.categoryVolumes || DEFAULT_CATEGORY_VOLUMES),
                        critical: draftCriticalVol
                      }
                    })
                  }
                  onTouchEnd={() =>
                    void updateSoundSettings({
                      categoryVolumes: {
                        ...(soundSettings.categoryVolumes || DEFAULT_CATEGORY_VOLUMES),
                        critical: draftCriticalVol
                      }
                    })
                  }
                  className="w-full h-1.5 bg-rose-100 dark:bg-rose-950/60 rounded-lg appearance-none cursor-pointer accent-rose-600"
                />
              </div>
            </div>
          </div>

          {/* Mute Normal & Separate Critical Notification Setting */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={isSoundSaving}
              onClick={() => updateSoundSettings({ muteNormal: !soundSettings.muteNormal })}
              className={`mj-tactile-well p-3 rounded-xl flex items-center justify-between gap-2 text-left cursor-pointer transition-all ${
                soundSettings.muteNormal ? 'ring-1 ring-[#6657C8]/50 bg-[#EAE8FF]/70 dark:ring-[#5424A8]/50 dark:bg-[#2E1459]/75' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#26364A] dark:text-white">
                  <BellOff className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                  <span>Mute Normal</span>
                </div>
                <p className="text-[10.5px] text-[#8492A5] dark:text-[#A493C2] truncate">
                  Senyapkan notifikasi normal &amp; chat
                </p>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                  soundSettings.muteNormal
                    ? 'bg-[#6657C8] dark:bg-[#58149C] text-white'
                    : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF]'
                }`}
              >
                {soundSettings.muteNormal ? 'MUTED' : 'ACTIVE'}
              </span>
            </button>

            <button
              type="button"
              disabled={isSoundSaving}
              onClick={() => updateSoundSettings({ criticalSeparate: !soundSettings.criticalSeparate })}
              className={`mj-tactile-well p-3 rounded-xl flex items-center justify-between gap-2 text-left cursor-pointer transition-all ${
                soundSettings.criticalSeparate ? 'ring-1 ring-rose-400/50' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#26364A] dark:text-white">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                  <span>Critical Terpisah</span>
                </div>
                <p className="text-[10.5px] text-[#8492A5] dark:text-[#A493C2] truncate">
                  Critical tetap bunyi meski mode senyap
                </p>
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold shrink-0 ${
                  soundSettings.criticalSeparate
                    ? 'bg-rose-600 text-white'
                    : 'bg-[#EAE8FF] text-[#5145A6] dark:bg-[#2E1459] dark:text-[#DAB9FF]'
                }`}
              >
                {soundSettings.criticalSeparate ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>

          {/* Test Notification Sound Bar */}
          <div className="p-3 rounded-xl bg-[#F4F7FB] dark:bg-[#1A0C33] border border-[#C5BEEF] dark:border-[#4B238F] flex flex-wrap items-center gap-2">
            <select
              value={testCategory}
              onChange={e => setTestCategory(e.target.value as NotificationSoundCategory)}
              aria-label="Pilih kategori Test Sound"
              className="flex-1 min-w-[150px] px-2.5 py-2 rounded-xl text-xs font-bold bg-white dark:bg-[#120826] text-[#26364A] dark:text-white border border-[#DDE6F0] dark:border-[#5B35B1] outline-none"
            >
              {SOUND_CATEGORY_CATALOG.map(cat => (
                <option key={cat.id} value={cat.id}>
                  {cat.label} — {cat.character}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => handleTestCategoryNotification(testCategory)}
              className="btn-3d-primary px-3.5 py-2 rounded-xl text-xs font-extrabold inline-flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Test Notification Sound</span>
            </button>
          </div>

          {/* 6 Notification Sound Categories + Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <span className="text-[10.5px] font-extrabold uppercase tracking-wider text-[#5145A6] dark:text-[#D8B4FE]">
                Kategori Suara Notifikasi (6 Profil)
              </span>
              <div className="flex items-center gap-2">
                {(audioEngineState === 'suspended' || audioEngineState === 'idle') && (
                  <button
                    type="button"
                    onClick={() =>
                      void unlockAudio().then(() => previewSound('live_chat', draftMasterVol))
                    }
                    className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-200 border border-amber-300 dark:border-amber-700 hover:bg-amber-200/80 transition-colors cursor-pointer"
                  >
                    Aktifkan Audio Browser
                  </button>
                )}
                <span className="text-[10px] font-mono text-[#8492A5] dark:text-[#A493C2]">
                  Engine: {audioEngineState.toUpperCase()}
                </span>
              </div>
            </div>

            {SOUND_CATEGORY_CATALOG.map(cat => {
              const isEnabled = soundSettings.categories?.[cat.id] ?? true;
              const badgeClass =
                cat.id === 'critical'
                  ? 'bg-rose-500'
                  : cat.id === 'important' || cat.id === 'wo_assignment'
                  ? 'bg-amber-500'
                  : cat.id === 'live_chat'
                  ? 'bg-blue-500'
                  : cat.id === 'success'
                  ? 'bg-emerald-500'
                  : 'bg-[#6657C8] dark:bg-[#8648F5]';

              const categoryIcon =
                cat.id === 'live_chat' ? (
                  <MessageCircle className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                ) : cat.id === 'wo_assignment' ? (
                  <ClipboardCheck className="w-3.5 h-3.5 text-[#5145A6] dark:text-[#D8B4FE]" />
                ) : cat.id === 'critical' ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400" />
                ) : cat.id === 'important' ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                ) : cat.id === 'success' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <BellRing className="w-3.5 h-3.5 text-[#6657C8] dark:text-[#8648F5]" />
                );

              return (
                <div
                  key={cat.id}
                  className="mj-tactile-well p-2.5 rounded-xl flex items-center justify-between gap-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${badgeClass}`} />
                      {categoryIcon}
                      <span className="font-bold text-xs text-[#26364A] dark:text-white truncate">
                        {cat.label}
                      </span>
                      <span className="text-[10px] font-mono text-[#8492A5] dark:text-[#A493C2] shrink-0">
                        · {cat.durationLabel}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-[#8492A5] dark:text-[#A493C2] truncate pl-3">
                      {cat.character}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isSoundSaving}
                      onClick={() =>
                        void updateSoundSettings({
                          categories: {
                            ...(soundSettings.categories || DEFAULT_SOUND_SETTINGS.categories!),
                            [cat.id]: !isEnabled
                          }
                        })
                      }
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer disabled:opacity-45 ${
                        isEnabled ? 'bg-[#6657C8] dark:bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                      }`}
                      title={`Aktif/Nonaktifkan suara kategori ${cat.label}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          isEnabled ? 'translate-x-4.5' : 'translate-x-1'
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => previewSound(cat.id, draftMasterVol)}
                      className="btn-3d-lilac px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      title={`Preview suara ${cat.label}`}
                    >
                      <Play className="w-3 h-3 fill-current text-[#5145A6] dark:text-[#DAB9FF]" />
                      <span>Preview</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Operational Event Channel Mapping (Compact) */}
          <details className="mj-tactile-well rounded-xl p-3">
            <summary className="text-[11px] font-extrabold text-[#5145A6] dark:text-[#D8B4FE] cursor-pointer select-none">
              Pengaturan Event Aplikasi ({soundList.filter(s => soundSettings[s.id]).length}/5 aktif)
            </summary>
            <div className="space-y-2 mt-2.5">
              {soundList.map(item => {
                const isItemEnabled = soundSettings[item.id] as boolean;
                return (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 text-xs py-1 border-t border-[#DDE6F0]/70 dark:border-[#3B1D78]/60 first:border-t-0"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dotColor}`} />
                        <span className="font-bold text-[11.5px] text-[#26364A] dark:text-white truncate">
                          {item.name}
                        </span>
                      </div>
                      <div className="text-[10px] font-mono text-[#8492A5] dark:text-[#A493C2] pl-3">
                        {item.freq}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={!soundSettings.enabled || isSoundSaving}
                        onClick={() => void updateSoundSettings({ [item.id]: !isItemEnabled })}
                        className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors cursor-pointer disabled:opacity-45 ${
                          isItemEnabled && soundSettings.enabled
                            ? 'bg-[#6657C8] dark:bg-[#58149C]'
                            : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                        }`}
                      >
                        <span
                          className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                            isItemEnabled && soundSettings.enabled ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <button
                        type="button"
                        onClick={item.action}
                        className="text-[10.5px] font-bold text-[#5145A6] dark:text-[#DAB9FF] hover:underline cursor-pointer"
                      >
                        Uji
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>

          <div className="p-3 bg-[#F4F7FB] dark:bg-[#160D29] border border-[#DDE6F0] dark:border-[#3B1D78] rounded-xl flex items-start gap-2.5 text-[11px] text-[#52647A] dark:text-[#CEC0E8]">
            <Smartphone className="w-4 h-4 text-[#5145A6] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
            <span>
              Web Audio API dengan Dynamics Compressor anti-clipping. Suara notifikasi dalam aplikasi menghormati volume sistem, mode senyap perangkat, dan aturan autoplay browser.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

