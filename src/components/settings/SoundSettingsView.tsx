import React, { useMemo, useState } from 'react';
import { useMoraJawsSound } from '../../context/SoundContext';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { useOfflineSync } from '../../context/OfflineSyncContext';
import { getTicketAppointmentDate } from '../../services/appointmentDateParser';
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
  ShieldAlert,
  Sparkles,
  Layers,
  Trash2,
  ArrowRight,
  Clock,
  Activity,
  MousePointerClick,
  PauseCircle
} from 'lucide-react';

interface SoundSettingsViewProps {
  onNavigateTab?: (tab: string) => void;
}

export const SoundSettingsView: React.FC<SoundSettingsViewProps> = ({ onNavigateTab }) => {
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
      name: '1. Loading Chirp',
      freq: 'Sine Sweep · Modul Muat',
      dotColor: 'bg-[#7135B5]',
      desc: 'Nada sintetis pembuka saat aplikasi atau modul memuat data.',
      action: playLoadingSound
    },
    {
      id: 'soundReady' as const,
      name: '2. Ready Chime',
      freq: '587Hz -> 880Hz · Kesiapan',
      dotColor: 'bg-emerald-500',
      desc: 'Chime kesiapan sistem saat inisialisasi atau login selesai.',
      action: playReadySound
    },
    {
      id: 'soundReportSaved' as const,
      name: '3. Report Saved Success',
      freq: 'Dual Harmonic · Sukses WO',
      dotColor: 'bg-emerald-600',
      desc: 'Nada selebrasi sukses saat teknisi menyimpan laporan WO.',
      action: playReportSavedSound
    },
    {
      id: 'soundError' as const,
      name: '4. Critical / Error Alert',
      freq: '880Hz Sawtooth · Peringatan',
      dotColor: 'bg-[#BA1A1A]',
      desc: 'Peringatan nada ganda saat terjadi kesalahan atau validasi gagal.',
      action: playErrorSound
    },
    {
      id: 'soundSync' as const,
      name: '5. Auto-Sync Relay',
      freq: 'Telemetry Pulse · PostgreSQL',
      dotColor: 'bg-amber-500',
      desc: 'Efek akustik saat sinkronisasi database PostgreSQL atau refresh ditekan.',
      action: playSyncSound
    }
  ];

  const handleTriggerInteractiveToast = (preset: 'success' | 'warning' | 'error' | 'sync') => {
    if (preset === 'success') {
      toast.success(
        `Operasional sinkron: ${liveTelemetry.completedToday} WO hari ini selesai (${liveTelemetry.completionPct}%).`,
        'Success Dispatch · Verified Ops',
        { withSound: true, badge: 'HTTP 200 OK' }
      );
    } else if (preset === 'warning') {
      toast.warning(
        `Antrean verifikasi foto QC saat ini: ${liveTelemetry.pendingApprovalCount} WO menunggu review.`,
        'Capacity & QA Queue Warn',
        {
          withSound: true,
          badge: 'TELEMETRY WARN',
          actionLabel: 'Buka QA Desk',
          onAction: () => onNavigateTab?.('verification_desk')
        }
      );
    } else if (preset === 'error') {
      toast.error(
        `Terdeteksi ${liveTelemetry.totalOverdue} WO Overdue & ${liveTelemetry.unassignedToday} WO belum di-assign hari ini.`,
        'Peringatan Overdue / Critical P1',
        {
          withSound: true,
          badge: 'CRITICAL P1',
          actionLabel: 'Triage Overdue',
          onAction: () => onNavigateTab?.('overdue_wo')
        }
      );
    } else {
      toast.sync(
        `Status PostgreSQL: ${databaseStatus.toUpperCase()} · ${pendingCount} mutasi pending offline queue.`,
        'Auto-Sync Telemetry Relay',
        { withSound: true, badge: 'DATA RELAY' }
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
        <div className="absolute -right-12 -top-12 w-44 h-44 rounded-full bg-[#7135B5]/10 dark:bg-[#7135B5]/20 blur-2xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 relative z-10">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#58149C] via-[#431599] to-[#480123] text-white flex items-center justify-center shrink-0 shadow-[0_3px_0_#240644]">
              <BellRing className="w-6 h-6 text-[#F3EAFF]" />
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-lg sm:text-xl font-extrabold text-[#1F1638] dark:text-white tracking-tight">
                  Tactile 3D Alerts &amp; Notification Engine
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-extrabold bg-[#58149C] text-white shadow-2xs">
                  V4.14 SPEC
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#F3EAFF] text-[#58149C] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#D8CCF3] dark:border-[#5B35B1]">
                  Audio v{soundVersion} · DB-First
                </span>
              </div>
              <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] max-w-2xl leading-relaxed">
                Sistem notifikasi taktil 3D MoraJaws dengan specular highlights, animasi spring physics, integrasi telemetry live PostgreSQL, dan mesin audio Web Audio API.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                    soundSettings.enabled
                      ? 'bg-[#F3EAFF] text-[#58149C] border-[#D8CCF3] dark:bg-[#2E1459] dark:text-[#DAB9FF] dark:border-[#5B35B1]'
                      : 'bg-rose-50 text-[#BA1A1A] border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
                  }`}
                >
                  {soundSettings.enabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  <span>Operational Chirps: {soundSettings.enabled ? 'ON' : 'OFF'}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white dark:bg-[#160D29] text-[#431599] dark:text-[#D8B4FE] border border-[#E8DDFF] dark:border-[#3B1D78] font-mono tabular-nums">
                  <Activity className="w-3.5 h-3.5 text-[#7135B5] dark:text-[#D8B4FE]" />
                  <span>Active Toasts: {toasts.length}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white dark:bg-[#160D29] text-[#4B4452] dark:text-[#CEC0E8] border border-[#E8DDFF] dark:border-[#3B1D78]">
                  <span className={`w-2 h-2 rounded-full ${databaseStatus === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span>Relay: {databaseStatus.toUpperCase()}</span>
                </span>
              </div>
            </div>
          </div>

          {/* Master Audio Toggle */}
          <div className="flex items-center gap-3 mj-tactile-well px-4 py-3 rounded-xl shrink-0">
            {isSoundSaving && <Loader2 className="w-4 h-4 text-[#7135B5] dark:text-[#D8B4FE] animate-spin" />}
            <div>
              <div className="text-xs font-extrabold text-[#1F1638] dark:text-white">Master Audio Notifikasi</div>
              <div className="text-[11px] font-semibold text-[#58149C] dark:text-[#D8B4FE]">
                {soundSettings.enabled ? 'Aktif (Global DB)' : 'Nonaktif (Senyap)'}
              </div>
            </div>
            <button
              type="button"
              disabled={!isSuperAdmin || isSoundSaving}
              onClick={() => updateSoundSettings({ enabled: !soundSettings.enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                soundSettings.enabled ? 'bg-[#58149C]' : 'bg-[#CBD5E1] dark:bg-[#35105E]'
              }`}
              title={isSuperAdmin ? 'Aktif/Nonaktifkan Master Audio' : 'Hanya Superadmin yang dapat mengubah'}
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

      {/* Role & Error Status Banners */}
      {!isSuperAdmin && (
        <div className="p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 rounded-xl flex items-center gap-3 text-xs text-amber-800 dark:text-amber-300">
          <Lock className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            Mode Lihat Saja: Konfigurasi master audio &amp; pengumuman suara dikunci untuk peran Super Admin, namun Anda dapat menguji trigger notifikasi &amp; chirp secara langsung.
          </span>
        </div>
      )}

      {soundError && (
        <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl flex items-center gap-2 text-xs text-[#BA1A1A] dark:text-rose-300 font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{soundError}</span>
        </div>
      )}

      {/* 4 PHYSICS & ARCHITECTURE SPEC TILES */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card-3d-lavender rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A493C2]">
              DEFAULT DWELL
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#1F1638] dark:text-white mt-0.5 tabular-nums">
              3,600–6,800 ms
            </div>
            <div className="text-[10.5px] font-semibold text-[#58149C] dark:text-[#D8B4FE]">Adaptive Drain</div>
          </div>
        </div>

        <div className="card-3d-lavender rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A493C2]">
              PHYSICS CURVE
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#1F1638] dark:text-white mt-0.5">
              Spring Overshoot
            </div>
            <div className="text-[10.5px] font-mono font-semibold text-[#7135B5] dark:text-[#D8B4FE]">c(0.34, 1.56)</div>
          </div>
        </div>

        <div className="card-3d-lavender rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A493C2]">
              Z-EXTRUSION
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#1F1638] dark:text-white mt-0.5">
              3.5px Dual-Bevel
            </div>
            <div className="text-[10.5px] font-semibold text-[#58149C] dark:text-[#D8B4FE]">Layered Tactile</div>
          </div>
        </div>

        <div className="card-3d-lavender rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
            <PauseCircle className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#7D7484] dark:text-[#A493C2]">
              HOVER INTERRUPT
            </div>
            <div className="font-display font-extrabold text-sm sm:text-base text-[#1F1638] dark:text-white mt-0.5">
              Tactile Freeze
            </div>
            <div className="text-[10.5px] font-semibold text-[#58149C] dark:text-[#D8B4FE]">Pointer Latch</div>
          </div>
        </div>
      </div>

      {/* INTERACTIVE DISPATCH PLAYGROUND */}
      <div className="card-3d-lavender rounded-2xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[#58149C] dark:text-[#D8B4FE] flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#7135B5] animate-pulse" />
              <span>INTERACTIVE DISPATCH PLAYGROUND</span>
            </div>
            <h3 className="font-display text-base sm:text-lg font-extrabold text-[#1F1638] dark:text-white mt-0.5">
              Trigger Live 3D Extruded Notifications
            </h3>
            <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] mt-0.5">
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
            <Trash2 className="w-3.5 h-3.5 text-[#58149C] dark:text-[#DAB9FF]" />
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
              <div className="font-display font-bold text-sm text-[#1F1638] dark:text-white">
                Success Dispatch
              </div>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] line-clamp-2">
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
              <div className="font-display font-bold text-sm text-[#1F1638] dark:text-white">
                Pending QC Alert
              </div>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] line-clamp-2">
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
              <div className="font-display font-bold text-sm text-[#1F1638] dark:text-white">
                Overdue &amp; Unassigned
              </div>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] line-clamp-2">
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
            className="mj-tactile-well p-4 rounded-2xl text-left flex flex-col justify-between gap-3 hover:border-[#7135B5] dark:hover:border-[#9B6BE8] hover:-translate-y-0.5 transition-all cursor-pointer group"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="w-8 h-8 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center">
                  <RefreshCw className="w-4 h-4" />
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#F3EAFF] text-[#58149C] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#D8CCF3] dark:border-[#5B35B1]">
                  DATA RELAY
                </span>
              </div>
              <div className="font-display font-bold text-sm text-[#1F1638] dark:text-white">
                Auto-Sync Telemetry
              </div>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] line-clamp-2">
                Status sync: {syncStatus.toUpperCase()} · Antrean offline {pendingCount} mutasi siap disinkronkan.
              </p>
            </div>
            <div className="flex items-center justify-between text-[11px] font-extrabold text-[#58149C] dark:text-[#D8B4FE] pt-1">
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
            <div className="text-[10.5px] font-extrabold uppercase tracking-[0.08em] text-[#58149C] dark:text-[#D8B4FE]">
              ENTERPRISE BANNER SYSTEM
            </div>
            <h3 className="font-display text-base sm:text-lg font-extrabold text-[#1F1638] dark:text-white">
              Standard Operations Alert Banners (Live Data)
            </h3>
          </div>
          <span className="text-[11px] text-[#7D7484] dark:text-[#A493C2]">
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
                <span className="text-[#7D7484] dark:text-[#A493C2] font-mono">
                  Tanggal Operasional: {todayWIB} WIB
                </span>
              </div>
              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#1F1638] dark:text-white">
                {liveTelemetry.totalOverdue} Tiket Overdue &amp; {liveTelemetry.unassignedToday} WO Belum Ter-Assign Hari Ini
              </h4>
              <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
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
                <span className="text-[#7D7484] dark:text-[#A493C2] font-mono">
                  BUTUH APPROVAL · QC DESK
                </span>
              </div>
              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#1F1638] dark:text-white">
                {liveTelemetry.pendingApprovalCount} Laporan Teknisi Menunggu Persetujuan Dispatch / QA
              </h4>
              <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
                Laporan yang telah diunggah installer beserta bukti foto ODP/FAT dan redaman OPM menunggu validasi akhir sebelum status ditutup.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <div className="mj-tactile-well px-3 py-2 rounded-xl min-w-[140px]">
              <div className="flex items-center justify-between text-[10px] font-bold text-[#4B4452] dark:text-[#CEC0E8] mb-1">
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
                <span className="text-[#7D7484] dark:text-[#A493C2] font-mono">
                  {liveTelemetry.completedToday}/{liveTelemetry.totalToday} WO SELESAI
                </span>
              </div>
              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#1F1638] dark:text-white">
                {liveTelemetry.completedToday} dari {liveTelemetry.totalToday} Work Order Hari Ini Telah Selesai ({liveTelemetry.completionPct}%)
              </h4>
              <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
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
        <div className="card-3d-lavender rounded-2xl p-4 sm:p-5 border-l-4 border-l-[#7135B5] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
              <RefreshCw className={`w-5 h-5 ${isRefreshingTelemetry ? 'animate-spin' : ''}`} />
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider">
                <span className="px-2 py-0.5 rounded bg-[#F3EAFF] text-[#58149C] dark:bg-[#2E1459] dark:text-[#DAB9FF]">
                  SYNC TELEMETRY ENGINE
                </span>
                <span className="text-[#7D7484] dark:text-[#A493C2] font-mono">
                  DB: {databaseStatus.toUpperCase()} · QUEUE: {pendingCount} PENDING
                </span>
              </div>
              <h4 className="font-display font-extrabold text-sm sm:text-base text-[#1F1638] dark:text-white">
                Sinkronisasi Cloud PostgreSQL ({syncStatus.toUpperCase()})
              </h4>
              <p className="text-xs text-[#4B4452] dark:text-[#CEC0E8] leading-relaxed">
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
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E8DDFF] dark:border-[#3B1D78]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#F3EAFF] dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-display font-extrabold text-sm text-[#1F1638] dark:text-white">
                  3D Tactile Rendering &amp; Animation Physics Specs
                </h3>
                <p className="text-[11px] text-[#7D7484] dark:text-[#A493C2]">
                  Hardware-accelerated keyframe matrices &amp; dual-plane bevel shading
                </p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-[#F3EAFF] text-[#58149C] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#D8CCF3] dark:border-[#5B35B1] shrink-0">
              60fps GPU
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="mj-tactile-well p-3.5 rounded-xl space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#58149C] dark:text-[#D8B4FE]">
                ENTRANCE VECTOR
              </div>
              <div className="font-bold text-xs text-[#1F1638] dark:text-white">Spring Overshoot</div>
              <code className="block p-2 rounded-lg bg-[#160D29] text-[#E9D5FF] text-[10px] font-mono leading-relaxed">
                cubic-bezier(0.34, 1.56, 0.64, 1)
              </code>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] leading-snug">
                Efek pegas 8px cepat yang langsung terkunci presisi saat alert masuk.
              </p>
            </div>

            <div className="mj-tactile-well p-3.5 rounded-xl space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#58149C] dark:text-[#D8B4FE]">
                SURFACE SPECULAR
              </div>
              <div className="font-bold text-xs text-[#1F1638] dark:text-white">Dual-Plane Extrusion</div>
              <code className="block p-2 rounded-lg bg-[#160D29] text-[#E9D5FF] text-[10px] font-mono leading-relaxed">
                inset 0 1px rgba(255,255,255,0.6)
              </code>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] leading-snug">
                Top edge specular highlight dengan kedalaman bottom bezel 3.5px.
              </p>
            </div>

            <div className="mj-tactile-well p-3.5 rounded-xl space-y-2">
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#58149C] dark:text-[#D8B4FE]">
                DECAY DYNAMICS
              </div>
              <div className="font-bold text-xs text-[#1F1638] dark:text-white">Progressive Draining</div>
              <code className="block p-2 rounded-lg bg-[#160D29] text-[#E9D5FF] text-[10px] font-mono leading-relaxed">
                transition: width linear
              </code>
              <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8] leading-snug">
                Timer bar berkurang halus dan langsung jeda saat pointer menyentuh toast.
              </p>
            </div>
          </div>

          {/* Interactive Tactile Pressing Sandbox */}
          <div className="p-4 rounded-xl bg-[#F3EAFF]/80 dark:bg-[#160D29]/80 border border-[#DFC7FF] dark:border-[#3B1D78] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#2E1459] text-[#58149C] dark:text-[#DAB9FF] flex items-center justify-center shrink-0">
                <MousePointerClick className="w-4 h-4" />
              </div>
              <div>
                <div className="text-xs font-extrabold text-[#1F1638] dark:text-white">
                  Try Interactive Tactile Pressing
                </div>
                <p className="text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
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

        {/* RIGHT (5 Cols): TELECOMMUNICATIONS AUDIO & MASTER VOLUME */}
        <div className="xl:col-span-5 card-3d-lavender rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E8DDFF] dark:border-[#3B1D78]">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-wider text-[#58149C] dark:text-[#D8B4FE]">
                  TELECOMMUNICATIONS AUDIO
                </div>
                <h3 className="font-display font-extrabold text-sm text-[#1F1638] dark:text-white">
                  Synthesized Feedback Chirps
                </h3>
              </div>
            </div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#F3EAFF] text-[#58149C] dark:bg-[#2E1459] dark:text-[#DAB9FF] border border-[#D8CCF3] dark:border-[#5B35B1]">
              Web Audio API
            </span>
          </div>

          {/* Master Volume Slider */}
          <div className="mj-tactile-well p-3.5 rounded-xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-bold text-[#1F1638] dark:text-white">
                <Sliders className="w-3.5 h-3.5 text-[#58149C] dark:text-[#D8B4FE]" />
                <span>Volume Audio Utama</span>
              </div>
              <span className="font-mono font-extrabold text-[#58149C] dark:text-[#DAB9FF]">
                {Math.round(soundSettings.volume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              disabled={!isSuperAdmin || !soundSettings.enabled}
              value={soundSettings.volume}
              onChange={e => updateSoundSettings({ volume: parseFloat(e.target.value) })}
              className="w-full h-2 bg-[#E8DDFF] dark:bg-[#2E1459] rounded-lg appearance-none cursor-pointer accent-[#58149C] disabled:opacity-50"
            />
          </div>

          {/* 5 Individual Sound Channels */}
          <div className="space-y-2.5">
            {soundList.map(item => {
              const isItemEnabled = soundSettings[item.id] as boolean;
              return (
                <div
                  key={item.id}
                  className="mj-tactile-well p-3 rounded-xl flex items-center justify-between gap-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${item.dotColor}`} />
                      <span className="font-bold text-xs text-[#1F1638] dark:text-white truncate">
                        {item.name}
                      </span>
                    </div>
                    <div className="text-[10.5px] font-mono text-[#7D7484] dark:text-[#A493C2] truncate pl-4">
                      {item.freq}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!isSuperAdmin || !soundSettings.enabled || isSoundSaving}
                      onClick={() => updateSoundSettings({ [item.id]: !isItemEnabled })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer disabled:opacity-45 ${
                        isItemEnabled && soundSettings.enabled
                          ? 'bg-[#58149C]'
                          : 'bg-[#CBD5E1] dark:bg-[#35105E]'
                      }`}
                      title={`Aktif/Nonaktifkan ${item.name}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                          isItemEnabled && soundSettings.enabled ? 'translate-x-4.5' : 'translate-x-1'
                        }`}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={item.action}
                      className="btn-3d-lilac px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer"
                      title={`Uji suara ${item.name}`}
                    >
                      <Play className="w-3 h-3 fill-current text-[#58149C] dark:text-[#DAB9FF]" />
                      <span>Uji</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="p-3 bg-[#F3EAFF]/70 dark:bg-[#160D29] border border-[#E8DDFF] dark:border-[#3B1D78] rounded-xl flex items-start gap-2.5 text-[11px] text-[#4B4452] dark:text-[#CEC0E8]">
            <Smartphone className="w-4 h-4 text-[#58149C] dark:text-[#DAB9FF] shrink-0 mt-0.5" />
            <span>
              Kompatibilitas Android &amp; Desktop: Audio disintesis 100% di sisi client via Web Audio API tanpa file MP3 eksternal.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
