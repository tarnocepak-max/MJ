import type {
  NotificationSoundCategory,
  SoundCategoryPreferences,
  SoundCategoryVolumes,
  SoundSettings
} from '../types';

export const DEFAULT_CATEGORY_VOLUMES: SoundCategoryVolumes = {
  normal: 65,
  important: 85,
  critical: 90
};

export const DEFAULT_CATEGORY_PREFERENCES: SoundCategoryPreferences = {
  normal: true,
  success: true,
  live_chat: true,
  wo_assignment: true,
  important: true,
  critical: true
};

export const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  enabled: true,
  volume: 80,
  soundLoading: true,
  soundReady: true,
  soundReportSaved: true,
  soundError: true,
  soundSync: true,
  muteNormal: false,
  criticalSeparate: true,
  categoryVolumes: { ...DEFAULT_CATEGORY_VOLUMES },
  categories: { ...DEFAULT_CATEGORY_PREFERENCES }
};

export interface SoundCategoryMeta {
  id: NotificationSoundCategory;
  label: string;
  tier: 'normal' | 'important' | 'critical';
  character: string;
  durationLabel: string;
  description: string;
}

export const SOUND_CATEGORY_CATALOG: SoundCategoryMeta[] = [
  {
    id: 'normal',
    label: 'Normal',
    tier: 'normal',
    character: 'Single elegant digital chime',
    durationLabel: '340 ms',
    description: 'Chime digital tunggal yang jernih dan lembut untuk informasi harian.'
  },
  {
    id: 'success',
    label: 'Success',
    tier: 'normal',
    character: 'Bright short confirmation tone',
    durationLabel: '400 ms',
    description: 'Nada konfirmasi naik yang cerah dan tegas saat aksi berhasil disimpan.'
  },
  {
    id: 'live_chat',
    label: 'Live Chat',
    tier: 'normal',
    character: 'Crisp double notification chime',
    durationLabel: '360 ms',
    description: 'Ketukan ganda kristal yang cepat dikenali untuk pesan masuk Live Chat.'
  },
  {
    id: 'wo_assignment',
    label: 'WO Assignment',
    tier: 'important',
    character: 'Distinctive professional alert',
    durationLabel: '520 ms',
    description: 'Motif triad profesional untuk penugasan atau pengalihan Work Order.'
  },
  {
    id: 'important',
    label: 'Important',
    tier: 'important',
    character: 'Stronger two-tone alert',
    durationLabel: '560 ms',
    description: 'Peringatan dua nada bertenaga untuk verifikasi QC, revisi, atau antrean penting.'
  },
  {
    id: 'critical',
    label: 'Critical',
    tier: 'critical',
    character: 'Distinctive urgent multi-tone alert',
    durationLabel: '780 ms',
    description: 'Peringatan multi-nada tegas berprioritas tinggi tanpa efek sirene kasar.'
  }
];

/**
 * Normalizes volume to 0..100 integer scale.
 * Safely migrates legacy fractional 0..1 values (e.g. 0.75 -> 75) produced by older range inputs.
 */
export function normalizeVolumePercent(raw: unknown, fallback = 80): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  if (raw > 0 && raw <= 1) {
    return Math.round(raw * 100);
  }
  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function normalizeSoundSettings(raw?: Partial<SoundSettings> | null): SoundSettings {
  const input = raw || {};
  const rawCats = input.categories || ({} as Partial<SoundCategoryPreferences>);
  const rawVols = input.categoryVolumes || ({} as Partial<SoundCategoryVolumes>);

  return {
    enabled: input.enabled ?? DEFAULT_SOUND_SETTINGS.enabled,
    volume: normalizeVolumePercent(input.volume, DEFAULT_SOUND_SETTINGS.volume),
    soundLoading: input.soundLoading ?? DEFAULT_SOUND_SETTINGS.soundLoading,
    soundReady: input.soundReady ?? DEFAULT_SOUND_SETTINGS.soundReady,
    soundReportSaved: input.soundReportSaved ?? DEFAULT_SOUND_SETTINGS.soundReportSaved,
    soundError: input.soundError ?? DEFAULT_SOUND_SETTINGS.soundError,
    soundSync: input.soundSync ?? DEFAULT_SOUND_SETTINGS.soundSync,
    muteNormal: Boolean(input.muteNormal ?? DEFAULT_SOUND_SETTINGS.muteNormal),
    criticalSeparate: input.criticalSeparate ?? DEFAULT_SOUND_SETTINGS.criticalSeparate,
    categoryVolumes: {
      normal: normalizeVolumePercent(rawVols.normal, DEFAULT_CATEGORY_VOLUMES.normal),
      important: normalizeVolumePercent(rawVols.important, DEFAULT_CATEGORY_VOLUMES.important),
      critical: normalizeVolumePercent(rawVols.critical, DEFAULT_CATEGORY_VOLUMES.critical)
    },
    categories: {
      normal: rawCats.normal ?? DEFAULT_CATEGORY_PREFERENCES.normal,
      success: rawCats.success ?? DEFAULT_CATEGORY_PREFERENCES.success,
      live_chat: rawCats.live_chat ?? DEFAULT_CATEGORY_PREFERENCES.live_chat,
      wo_assignment: rawCats.wo_assignment ?? DEFAULT_CATEGORY_PREFERENCES.wo_assignment,
      important: rawCats.important ?? DEFAULT_CATEGORY_PREFERENCES.important,
      critical: rawCats.critical ?? DEFAULT_CATEGORY_PREFERENCES.critical
    }
  };
}

export function resolveToastCategory(params: {
  type?: string;
  title?: string;
  message?: string;
  badge?: string;
  soundCategory?: NotificationSoundCategory;
}): NotificationSoundCategory {
  if (params.soundCategory) return params.soundCategory;

  const type = (params.type || 'info').toLowerCase();
  const text = `${params.badge || ''} ${params.title || ''} ${params.message || ''}`.toLowerCase();

  if (
    type === 'error' ||
    /\b(critical|kritis|darurat|overdue|terkunci|locked|error|gagal)\b/.test(text)
  ) {
    return 'critical';
  }
  if (
    type === 'warning' ||
    /\b(important|penting|approval|verifikasi|revisi|warn|peringatan)\b/.test(text)
  ) {
    return 'important';
  }
  if (/\b(live chat|chat|pesan baru|balasan)\b/.test(text)) {
    return 'live_chat';
  }
  if (/\b(assign|reassign|penugasan|ditugaskan|work order)\b/.test(text)) {
    return 'wo_assignment';
  }
  if (type === 'success') {
    return 'success';
  }
  return 'normal';
}

const PRIORITY_RANK: Record<NotificationSoundCategory, number> = {
  normal: 1,
  success: 1,
  live_chat: 2,
  wo_assignment: 3,
  important: 4,
  critical: 5
};

const CATEGORY_COOLDOWN_MS: Record<NotificationSoundCategory, number> = {
  normal: 650,
  success: 550,
  live_chat: 600,
  wo_assignment: 550,
  important: 500,
  critical: 450
};

interface NoteSpec {
  freq: number;
  startOffsetSec: number;
  durationSec: number;
  gain: number;
  waveform?: OscillatorType;
  harmonicRatio?: number;
  harmonicGain?: number;
  sparkleGain?: number;
}

/**
 * Isolated Web Audio API Notification Synthesizer for MoraJaws.
 * Uses gentle high-pass filtering, controlled envelopes, and a DynamicsCompressorNode
 * to deliver crisp enterprise chime clarity without clipping, distortion, or harsh buzz.
 */
class MoraJawsNotificationAudioService {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sparkleFilter: BiquadFilterNode | null = null;
  private lowCutFilter: BiquadFilterNode | null = null;
  private unlocked = false;
  private lastPlayedAtByKey: Record<string, number> = {};
  private lastGlobalPlayAt = 0;
  private lastGlobalPriority = 0;
  private pendingQueuedCategory: {
    category: NotificationSoundCategory;
    settings: SoundSettings;
  } | null = null;
  private queueTimer: ReturnType<typeof setTimeout> | null = null;
  private unlockListenersBound = false;

  public bindAutoplayUnlock(): () => void {
    if (typeof window === 'undefined' || this.unlockListenersBound) {
      return () => {};
    }
    this.unlockListenersBound = true;

    const unlock = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.unlocked = true;
        }).catch(() => {});
      } else if (this.ctx && this.ctx.state === 'running') {
        this.unlocked = true;
      }
      if (this.unlocked) {
        cleanup();
      }
    };

    const cleanup = () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      this.unlockListenersBound = false;
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('click', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });

    return cleanup;
  }

  public getEngineState(): 'running' | 'suspended' | 'idle' | 'unavailable' {
    if (typeof window === 'undefined') return 'unavailable';
    const AudioCtxClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxClass) return 'unavailable';
    if (!this.ctx) return 'idle';
    if (this.ctx.state === 'running') return 'running';
    return 'suspended';
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    try {
      if (!this.ctx) {
        const AudioCtxClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtxClass) return null;
        this.ctx = new AudioCtxClass();
      }

      if (this.ctx.state === 'suspended') {
        this.ctx.resume().then(() => {
          this.unlocked = true;
        }).catch(() => {});
      } else if (this.ctx.state === 'running') {
        this.unlocked = true;
      }

      if (!this.compressor || !this.sparkleFilter || !this.lowCutFilter) {
        // Trim low-end rumble (<140Hz) for clean mobile speakers
        this.lowCutFilter = this.ctx.createBiquadFilter();
        this.lowCutFilter.type = 'highpass';
        this.lowCutFilter.frequency.value = 140;

        // Subtle high-frequency sparkle (+2.5dB shelf at 2.4kHz)
        this.sparkleFilter = this.ctx.createBiquadFilter();
        this.sparkleFilter.type = 'highshelf';
        this.sparkleFilter.frequency.value = 2400;
        this.sparkleFilter.gain.value = 2.5;

        // Brickwall safety limiter / compressor to guarantee zero clipping
        this.compressor = this.ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -14;
        this.compressor.knee.value = 10;
        this.compressor.ratio.value = 6;
        this.compressor.attack.value = 0.002;
        this.compressor.release.value = 0.12;

        this.lowCutFilter.connect(this.sparkleFilter);
        this.sparkleFilter.connect(this.compressor);
        this.compressor.connect(this.ctx.destination);
      }

      return this.ctx;
    } catch {
      return null;
    }
  }

  public isCategoryAudible(
    category: NotificationSoundCategory,
    settings: SoundSettings
  ): boolean {
    const normalized = normalizeSoundSettings(settings);
    const cats = normalized.categories!;

    if (category === 'critical') {
      // If Separate Critical Notification is active, critical alerts remain audible
      // unless user explicitly turned off critical or master audio is disabled AND criticalSeparate is off.
      if (!cats.critical) return false;
      if (!normalized.enabled && !normalized.criticalSeparate) return false;
      return normalized.enabled || Boolean(normalized.criticalSeparate);
    }

    if (!normalized.enabled) return false;
    if (!cats[category]) return false;

    const isNormalTier = category === 'normal' || category === 'success' || category === 'live_chat';
    if (normalized.muteNormal && isNormalTier) {
      return false;
    }

    return true;
  }

  private computeEffectiveGain(
    category: NotificationSoundCategory,
    settings: SoundSettings,
    overrideMasterPercent?: number
  ): number {
    const normalized = normalizeSoundSettings(settings);
    const masterPct =
      overrideMasterPercent !== undefined
        ? normalizeVolumePercent(overrideMasterPercent, normalized.volume)
        : normalized.volume;

    const vols = normalized.categoryVolumes!;
    const tierPct =
      category === 'critical'
        ? vols.critical
        : category === 'important' || category === 'wo_assignment'
        ? vols.important
        : vols.normal;

    const combined = (masterPct / 100) * (tierPct / 100);
    if (combined <= 0) return 0;

    // Perceptual volume curve capped safely below 0.62 pre-compressor headroom
    return Math.min(0.62, Math.pow(combined, 1.35) * 0.58);
  }

  private getNotesForCategory(category: NotificationSoundCategory): NoteSpec[] {
    switch (category) {
      // 1. Normal: Single elegant digital chime (~340ms)
      case 'normal':
        return [
          {
            freq: 659.25, // E5
            startOffsetSec: 0,
            durationSec: 0.34,
            gain: 0.62,
            waveform: 'sine',
            harmonicRatio: 2, // E6 crisp octave overtone
            harmonicGain: 0.18,
            sparkleGain: 0.06
          }
        ];

      // 2. Success: Bright short confirmation tone (~400ms)
      case 'success':
        return [
          {
            freq: 783.99, // G5
            startOffsetSec: 0,
            durationSec: 0.19,
            gain: 0.54,
            waveform: 'sine',
            harmonicRatio: 2,
            harmonicGain: 0.16
          },
          {
            freq: 1174.66, // D6
            startOffsetSec: 0.085,
            durationSec: 0.31,
            gain: 0.64,
            waveform: 'sine',
            harmonicRatio: 1.5,
            harmonicGain: 0.15,
            sparkleGain: 0.08
          }
        ];

      // 3. Live Chat: Crisp double notification chime (~360ms)
      case 'live_chat':
        return [
          {
            freq: 880.0, // A5
            startOffsetSec: 0,
            durationSec: 0.13,
            gain: 0.52,
            waveform: 'sine',
            harmonicRatio: 2,
            harmonicGain: 0.15
          },
          {
            freq: 1318.51, // E6
            startOffsetSec: 0.105,
            durationSec: 0.25,
            gain: 0.62,
            waveform: 'sine',
            harmonicRatio: 2,
            harmonicGain: 0.14,
            sparkleGain: 0.07
          }
        ];

      // 4. WO Assignment: Distinctive professional alert (~520ms)
      case 'wo_assignment':
        return [
          {
            freq: 587.33, // D5
            startOffsetSec: 0,
            durationSec: 0.18,
            gain: 0.56,
            waveform: 'sine',
            harmonicRatio: 2,
            harmonicGain: 0.18
          },
          {
            freq: 739.99, // F#5
            startOffsetSec: 0.10,
            durationSec: 0.20,
            gain: 0.60,
            waveform: 'sine',
            harmonicRatio: 2,
            harmonicGain: 0.18
          },
          {
            freq: 880.0, // A5
            startOffsetSec: 0.205,
            durationSec: 0.31,
            gain: 0.68,
            waveform: 'sine',
            harmonicRatio: 2,
            harmonicGain: 0.20,
            sparkleGain: 0.08
          }
        ];

      // 5. Important: Stronger two-tone alert (~560ms)
      case 'important':
        return [
          {
            freq: 698.46, // F5
            startOffsetSec: 0,
            durationSec: 0.22,
            gain: 0.66,
            waveform: 'triangle',
            harmonicRatio: 2,
            harmonicGain: 0.20
          },
          {
            freq: 1046.5, // C6
            startOffsetSec: 0.16,
            durationSec: 0.38,
            gain: 0.74,
            waveform: 'sine',
            harmonicRatio: 1.5,
            harmonicGain: 0.22,
            sparkleGain: 0.09
          }
        ];

      // 6. Critical: Distinctive urgent multi-tone alert (~780ms), non-siren
      case 'critical':
        return [
          {
            freq: 932.33, // Bb5
            startOffsetSec: 0,
            durationSec: 0.18,
            gain: 0.72,
            waveform: 'triangle',
            harmonicRatio: 2,
            harmonicGain: 0.20,
            sparkleGain: 0.08
          },
          {
            freq: 698.46, // F5
            startOffsetSec: 0.165,
            durationSec: 0.18,
            gain: 0.66,
            waveform: 'sine',
            harmonicRatio: 2,
            harmonicGain: 0.18
          },
          {
            freq: 932.33, // Bb5
            startOffsetSec: 0.33,
            durationSec: 0.20,
            gain: 0.76,
            waveform: 'triangle',
            harmonicRatio: 2,
            harmonicGain: 0.22,
            sparkleGain: 0.09
          },
          {
            freq: 1396.91, // F6 resolution accent
            startOffsetSec: 0.46,
            durationSec: 0.32,
            gain: 0.68,
            waveform: 'sine',
            harmonicRatio: 1.5,
            harmonicGain: 0.16,
            sparkleGain: 0.08
          }
        ];
    }
  }

  private renderNoteSequence(category: NotificationSoundCategory, masterLinearGain: number): void {
    if (masterLinearGain <= 0.001) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.lowCutFilter) return;

    try {
      const baseTime = ctx.currentTime + 0.008;
      const busGain = ctx.createGain();
      busGain.gain.setValueAtTime(masterLinearGain, baseTime);
      busGain.connect(this.lowCutFilter);

      const notes = this.getNotesForCategory(category);
      let maxEndOffset = 0;

      for (const note of notes) {
        const start = baseTime + note.startOffsetSec;
        const end = start + note.durationSec;
        maxEndOffset = Math.max(maxEndOffset, note.startOffsetSec + note.durationSec);

        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = note.waveform || 'sine';
        osc.frequency.setValueAtTime(note.freq, start);

        // Fast crisp attack (5ms) + smooth exponential release to silence
        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(note.gain, start + 0.006);
        env.gain.exponentialRampToValueAtTime(Math.max(0.02, note.gain * 0.36), start + note.durationSec * 0.32);
        env.gain.exponentialRampToValueAtTime(0.0001, end);

        osc.connect(env);
        env.connect(busGain);
        osc.start(start);
        osc.stop(end + 0.02);

        if (note.harmonicRatio && note.harmonicGain) {
          const harmOsc = ctx.createOscillator();
          const harmEnv = ctx.createGain();
          harmOsc.type = 'sine';
          harmOsc.frequency.setValueAtTime(note.freq * note.harmonicRatio, start);

          harmEnv.gain.setValueAtTime(0.0001, start);
          harmEnv.gain.linearRampToValueAtTime(note.harmonicGain, start + 0.005);
          harmEnv.gain.exponentialRampToValueAtTime(0.0001, start + note.durationSec * 0.7);

          harmOsc.connect(harmEnv);
          harmEnv.connect(busGain);
          harmOsc.start(start);
          harmOsc.stop(start + note.durationSec * 0.75);
        }

        if (note.sparkleGain) {
          const spkOsc = ctx.createOscillator();
          const spkEnv = ctx.createGain();
          spkOsc.type = 'sine';
          spkOsc.frequency.setValueAtTime(Math.min(4200, note.freq * 3), start);

          spkEnv.gain.setValueAtTime(0.0001, start);
          spkEnv.gain.linearRampToValueAtTime(note.sparkleGain, start + 0.003);
          spkEnv.gain.exponentialRampToValueAtTime(0.0001, start + 0.075);

          spkOsc.connect(spkEnv);
          spkEnv.connect(busGain);
          spkOsc.start(start);
          spkOsc.stop(start + 0.09);
        }
      }

      setTimeout(() => {
        try {
          busGain.disconnect();
        } catch {}
      }, Math.ceil((maxEndOffset + 0.15) * 1000));
    } catch {
      // Never allow audio failure to crash the application
    }
  }

  public playCategory(
    category: NotificationSoundCategory,
    settings: SoundSettings,
    options?: {
      force?: boolean;
      dedupKey?: string;
      overrideMasterVolume?: number;
    }
  ): boolean {
    const force = Boolean(options?.force);

    if (!force && !this.isCategoryAudible(category, settings)) {
      return false;
    }

    const nowMs = Date.now();
    const dedupKey = options?.dedupKey || category;
    const minCooldown = CATEGORY_COOLDOWN_MS[category];

    if (!force) {
      const lastForKey = this.lastPlayedAtByKey[dedupKey] || 0;
      if (nowMs - lastForKey < minCooldown) {
        return false;
      }

      const incomingPriority = PRIORITY_RANK[category];
      const sinceLastGlobal = nowMs - this.lastGlobalPlayAt;

      // Prevent uncontrolled audio overlap when multiple notifications arrive together
      if (sinceLastGlobal < 240) {
        if (incomingPriority > this.lastGlobalPriority && category === 'critical') {
          // Critical alert plays immediately without being blocked by low-priority chatter
        } else {
          // Coalesce into at most 1 queued highest-priority sound
          if (
            !this.pendingQueuedCategory ||
            incomingPriority >= PRIORITY_RANK[this.pendingQueuedCategory.category]
          ) {
            this.pendingQueuedCategory = { category, settings };
          }
          if (!this.queueTimer) {
            this.queueTimer = setTimeout(() => {
              this.queueTimer = null;
              const pending = this.pendingQueuedCategory;
              this.pendingQueuedCategory = null;
              if (pending) {
                this.playCategory(pending.category, pending.settings, {
                  dedupKey: `queued-${pending.category}`
                });
              }
            }, 250);
          }
          return false;
        }
      }
    }

    const masterGain = this.computeEffectiveGain(
      category,
      settings,
      options?.overrideMasterVolume
    );

    if (masterGain <= 0.001) {
      return false;
    }

    this.lastPlayedAtByKey[dedupKey] = nowMs;
    this.lastGlobalPlayAt = nowMs;
    this.lastGlobalPriority = PRIORITY_RANK[category];

    this.renderNoteSequence(category, masterGain);
    return true;
  }

  public dispose(): void {
    if (this.queueTimer) {
      clearTimeout(this.queueTimer);
      this.queueTimer = null;
    }
    this.pendingQueuedCategory = null;
  }
}

export const notificationAudioService = new MoraJawsNotificationAudioService();
