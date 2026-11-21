import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { NotificationSoundCategory, SoundSettings } from '../types';
import {
  getGlobalConfig,
  saveGlobalConfig,
  subscribeToGlobalConfigUpdates,
  ConfigConflictError,
  GlobalConfigConflictDetails
} from '../services/globalConfigService';
import {
  DEFAULT_SOUND_SETTINGS,
  normalizeSoundSettings,
  notificationAudioService,
  resolveToastCategory
} from '../services/notificationAudioService';

export interface SoundUpdateResult {
  success: boolean;
  error?: string;
  conflict?: GlobalConfigConflictDetails;
}

export type LegacyPreviewType = 'loading' | 'ready' | 'report_saved' | 'error' | 'sync';

export interface SoundContextType {
  soundSettings: SoundSettings;
  soundVersion: number;
  isSoundSaving: boolean;
  soundError: string | null;
  soundConflict: GlobalConfigConflictDetails | null;
  soundScope: 'global' | 'personal';
  hasPersonalOverride: boolean;
  audioEngineState: 'running' | 'suspended' | 'idle' | 'unavailable';
  clearSoundConflict: () => void;
  resolveSoundConflict: (strategy: 'reload' | 'overwrite') => Promise<void>;
  updateSoundSettings: (
    updates: Partial<SoundSettings>,
    options?: { forceOverwrite?: boolean }
  ) => Promise<SoundUpdateResult>;
  restoreDefaultSoundSettings: () => Promise<SoundUpdateResult>;
  playLoadingSound: () => void;
  playReadySound: () => void;
  playReportSavedSound: () => void;
  playErrorSound: () => void;
  playSyncSound: () => void;
  playLiveChatSound: () => void;
  unlockAudio: () => Promise<'running' | 'suspended' | 'idle' | 'unavailable'>;
  playCategorySound: (
    category: NotificationSoundCategory,
    options?: { force?: boolean; dedupKey?: string; previewVolume?: number }
  ) => boolean;
  previewSound: (
    type: LegacyPreviewType | NotificationSoundCategory,
    previewVolume?: number
  ) => void;
}

function getSessionAuth(): { token: string; role: string; userId: string } {
  try {
    const raw = localStorage.getItem('morajaws_auth_session');
    if (!raw) return { token: '', role: '', userId: 'guest' };
    const parsed = JSON.parse(raw);
    return {
      token: String(parsed?.token || ''),
      role: String(parsed?.role || ''),
      userId: String(parsed?.userId || parsed?.id || parsed?.username || 'guest')
    };
  } catch {
    return { token: '', role: '', userId: 'guest' };
  }
}

function getPersonalPrefsKey(userId: string): string {
  return `morajaws_personal_sound_prefs_${userId || 'guest'}`;
}

function readPersonalOverrides(userId: string): Partial<SoundSettings> | null {
  try {
    const raw = localStorage.getItem(getPersonalPrefsKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Partial<SoundSettings>) : null;
  } catch {
    return null;
  }
}

function writePersonalOverrides(userId: string, overrides: Partial<SoundSettings> | null): void {
  try {
    const key = getPersonalPrefsKey(userId);
    if (!overrides) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(overrides));
    }
  } catch {
    // Ignore storage quota errors safely
  }
}

function mergeSettings(
  globalBase: SoundSettings,
  personalOverride: Partial<SoundSettings> | null
): SoundSettings {
  if (!personalOverride) return normalizeSoundSettings(globalBase);
  return normalizeSoundSettings({
    ...globalBase,
    ...personalOverride,
    categoryVolumes: {
      ...(globalBase.categoryVolumes || DEFAULT_SOUND_SETTINGS.categoryVolumes!),
      ...(personalOverride.categoryVolumes || {})
    },
    categories: {
      ...(globalBase.categories || DEFAULT_SOUND_SETTINGS.categories!),
      ...(personalOverride.categories || {})
    }
  });
}

const SoundContext = createContext<SoundContextType | undefined>(undefined);

export const MoraJawsSoundProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [globalSoundSettings, setGlobalSoundSettings] = useState<SoundSettings>(() => {
    try {
      const stored = localStorage.getItem('morajaws_sound_preferences');
      if (stored) {
        return normalizeSoundSettings(JSON.parse(stored));
      }
    } catch {
      // Fallback
    }
    return DEFAULT_SOUND_SETTINGS;
  });

  const [personalOverride, setPersonalOverride] = useState<Partial<SoundSettings> | null>(() => {
    const { userId } = getSessionAuth();
    return readPersonalOverrides(userId);
  });

  const [authSnapshot, setAuthSnapshot] = useState(() => getSessionAuth());
  const [soundVersion, setSoundVersion] = useState<number>(1);
  const soundVersionRef = useRef<number>(1);
  const [isSoundSaving, setIsSoundSaving] = useState<boolean>(false);
  const [soundError, setSoundError] = useState<string | null>(null);
  const [soundConflict, setSoundConflict] = useState<GlobalConfigConflictDetails | null>(null);
  const pendingSoundDraftRef = useRef<SoundSettings | null>(null);

  const isSuperAdmin = authSnapshot.role === 'super_admin';
  const soundScope: 'global' | 'personal' = isSuperAdmin ? 'global' : 'personal';
  const hasPersonalOverride = Boolean(!isSuperAdmin && personalOverride);

  const soundSettings = useMemo(
    () => (isSuperAdmin ? normalizeSoundSettings(globalSoundSettings) : mergeSettings(globalSoundSettings, personalOverride)),
    [isSuperAdmin, globalSoundSettings, personalOverride]
  );

  const soundSettingsRef = useRef<SoundSettings>(soundSettings);
  soundSettingsRef.current = soundSettings;

  const [audioEngineState, setAudioEngineState] = useState<'running' | 'suspended' | 'idle' | 'unavailable'>(
    () => notificationAudioService.getEngineState()
  );

  // Bind autoplay unlock once for browser & Android gesture compliance
  useEffect(() => {
    const unsubState = notificationAudioService.subscribeEngineState(setAudioEngineState);
    const unbind = notificationAudioService.bindAutoplayUnlock();
    return () => {
      unsubState();
      unbind();
      notificationAudioService.dispose();
    };
  }, []);

  // Hydrate & subscribe to global sound_settings via Express SSE whenever authenticated
  useEffect(() => {
    let activeUnsub: (() => void) | null = null;
    let cancelled = false;

    const attachSoundSync = async () => {
      if (activeUnsub) {
        activeUnsub();
        activeUnsub = null;
      }
      const auth = getSessionAuth();
      setAuthSnapshot(auth);
      setPersonalOverride(auth.role === 'super_admin' ? null : readPersonalOverrides(auth.userId));

      if (!auth.token) return;

      try {
        const res = await getGlobalConfig<SoundSettings>('sound_settings');
        if (!cancelled && res.value && typeof res.value === 'object') {
          const merged = normalizeSoundSettings(res.value);
          setGlobalSoundSettings(merged);
          soundVersionRef.current = res.version || 1;
          setSoundVersion(res.version || 1);
          try {
            localStorage.setItem('morajaws_sound_preferences', JSON.stringify(merged));
          } catch {}
        }
      } catch {
        // Keep cached defaults if setting not yet seeded or transient offline
      }

      if (cancelled) return;
      activeUnsub = subscribeToGlobalConfigUpdates(ev => {
        if (ev.key !== 'sound_settings' || !ev.value || typeof ev.value !== 'object') return;
        const merged = normalizeSoundSettings(ev.value);
        setGlobalSoundSettings(merged);
        if (typeof ev.version === 'number') {
          soundVersionRef.current = ev.version;
          setSoundVersion(ev.version);
        }
        try {
          localStorage.setItem('morajaws_sound_preferences', JSON.stringify(merged));
        } catch {}
      });
    };

    void attachSoundSync();

    const handleAuthChanged = () => {
      void attachSoundSync();
    };
    window.addEventListener('morajaws:auth-changed', handleAuthChanged);

    return () => {
      cancelled = true;
      window.removeEventListener('morajaws:auth-changed', handleAuthChanged);
      if (activeUnsub) activeUnsub();
    };
  }, []);

  const updateSoundSettings = useCallback(
    async (
      updates: Partial<SoundSettings>,
      options?: { forceOverwrite?: boolean }
    ): Promise<SoundUpdateResult> => {
      const { token, role, userId } = getSessionAuth();
      const currentMerged = mergeSettings(
        globalSoundSettings,
        role === 'super_admin' ? null : personalOverride
      );

      const next = normalizeSoundSettings({
        ...currentMerged,
        ...updates,
        categoryVolumes: {
          ...(currentMerged.categoryVolumes || DEFAULT_SOUND_SETTINGS.categoryVolumes!),
          ...(updates.categoryVolumes || {})
        },
        categories: {
          ...(currentMerged.categories || DEFAULT_SOUND_SETTINGS.categories!),
          ...(updates.categories || {})
        }
      });

      // Non-super-admin or offline guest stores personal device audio preferences cleanly
      if (!token || role !== 'super_admin') {
        setPersonalOverride(next);
        writePersonalOverrides(userId, next);
        setSoundError(null);
        return { success: true };
      }

      pendingSoundDraftRef.current = next;
      setIsSoundSaving(true);
      setSoundError(null);

      try {
        const res = await saveGlobalConfig<SoundSettings>('sound_settings', next, {
          module: 'sound_settings',
          expectedVersion: soundVersionRef.current,
          forceOverwrite: Boolean(options?.forceOverwrite),
          description: 'Global notification sound configuration'
        });

        const confirmed = normalizeSoundSettings(res.value || next);
        soundVersionRef.current = res.version;
        setSoundVersion(res.version);
        setGlobalSoundSettings(confirmed);
        pendingSoundDraftRef.current = null;
        setSoundConflict(null);
        try {
          localStorage.setItem('morajaws_sound_preferences', JSON.stringify(confirmed));
        } catch {}
        return { success: true };
      } catch (err: any) {
        if (err instanceof ConfigConflictError) {
          setSoundConflict(err.conflict);
          setSoundError(err.message);
          return { success: false, error: err.message, conflict: err.conflict };
        }
        const errMsg = err?.message || 'Gagal menyimpan pengaturan notifikasi ke database.';
        setSoundError(errMsg);
        return { success: false, error: errMsg };
      } finally {
        setIsSoundSaving(false);
      }
    },
    [globalSoundSettings, personalOverride]
  );

  const restoreDefaultSoundSettings = useCallback(async (): Promise<SoundUpdateResult> => {
    const { token, role, userId } = getSessionAuth();
    if (!token || role !== 'super_admin') {
      writePersonalOverrides(userId, null);
      setPersonalOverride(null);
      setSoundError(null);
      return { success: true };
    }
    return updateSoundSettings(DEFAULT_SOUND_SETTINGS);
  }, [updateSoundSettings]);

  const clearSoundConflict = useCallback(() => {
    setSoundConflict(null);
  }, []);

  const resolveSoundConflict = useCallback(
    async (strategy: 'reload' | 'overwrite') => {
      if (strategy === 'reload') {
        try {
          const res = await getGlobalConfig<SoundSettings>('sound_settings');
          if (res.value) {
            const merged = normalizeSoundSettings(res.value);
            setGlobalSoundSettings(merged);
            soundVersionRef.current = res.version || 1;
            setSoundVersion(res.version || 1);
            try {
              localStorage.setItem('morajaws_sound_preferences', JSON.stringify(merged));
            } catch {}
          }
          pendingSoundDraftRef.current = null;
          setSoundConflict(null);
          setSoundError(null);
        } catch (err: any) {
          setSoundError(err?.message || 'Gagal memuat ulang versi terbaru dari database.');
        }
        return;
      }

      if (pendingSoundDraftRef.current) {
        await updateSoundSettings(pendingSoundDraftRef.current, { forceOverwrite: true });
      } else {
        setSoundConflict(null);
      }
    },
    [updateSoundSettings]
  );

  const playCategorySound = useCallback(
    (
      category: NotificationSoundCategory,
      options?: { force?: boolean; dedupKey?: string; previewVolume?: number }
    ): boolean => {
      const played = notificationAudioService.playCategory(category, soundSettingsRef.current, {
        force: options?.force,
        dedupKey: options?.dedupKey,
        overrideMasterVolume: options?.previewVolume
      });
      setAudioEngineState(notificationAudioService.getEngineState());
      return played;
    },
    []
  );

  // Backwards-compatible semantic event sound triggers
  const playLoadingSound = useCallback(() => {
    const cfg = soundSettingsRef.current;
    if (!cfg.soundLoading) return;
    playCategorySound('normal', { dedupKey: 'legacy-loading' });
  }, [playCategorySound]);

  const playReadySound = useCallback(() => {
    const cfg = soundSettingsRef.current;
    if (!cfg.soundReady) return;
    playCategorySound('normal', { dedupKey: 'legacy-ready' });
  }, [playCategorySound]);

  const playReportSavedSound = useCallback(() => {
    const cfg = soundSettingsRef.current;
    if (!cfg.soundReportSaved) return;
    playCategorySound('success', { dedupKey: 'legacy-report-saved' });
  }, [playCategorySound]);

  const playErrorSound = useCallback(() => {
    const cfg = soundSettingsRef.current;
    if (!cfg.soundError) return;
    playCategorySound('critical', { dedupKey: 'legacy-error' });
  }, [playCategorySound]);

  const playSyncSound = useCallback(() => {
    const cfg = soundSettingsRef.current;
    if (!cfg.soundSync) return;
    playCategorySound('normal', { dedupKey: 'legacy-sync' });
  }, [playCategorySound]);

  const playLiveChatSound = useCallback(() => {
    playCategorySound('live_chat', { dedupKey: 'live-chat-incoming' });
  }, [playCategorySound]);

  const unlockAudio = useCallback(async () => {
    const nextState = await notificationAudioService.unlock();
    setAudioEngineState(nextState);
    return nextState;
  }, []);

  // Listen to explicit toast, LiveChat, and lifecycle sound events (avoids circular context dependency)
  useEffect(() => {
    const handleToastSound = (e: Event) => {
      const detail =
        (e as CustomEvent<{
          type?: string;
          title?: string;
          message?: string;
          badge?: string;
          soundCategory?: NotificationSoundCategory;
        }>).detail || {};

      const cfg = soundSettingsRef.current;
      const category = resolveToastCategory(detail);

      // Honor legacy toggles as well as new category toggles
      if (detail.type === 'error' && !cfg.soundError) return;
      if (detail.type === 'success' && !cfg.soundReportSaved) return;
      if (detail.type === 'sync' && !cfg.soundSync) return;
      if (detail.type === 'loading' && !cfg.soundLoading) return;
      if ((detail.type === 'info' || !detail.type) && category === 'normal' && !cfg.soundReady) return;

      playCategorySound(category, {
        dedupKey: `toast-${category}-${(detail.message || '').slice(0, 32)}`
      });
    };

    const handleLiveChatSound = (e: Event) => {
      const detail =
        (e as CustomEvent<{
          messageId?: string;
          ticketId?: string;
          senderRole?: string;
          recipientRole?: string;
        }>).detail || {};
      const dedupKey = detail.messageId
        ? `live-chat-${detail.messageId}`
        : detail.ticketId
        ? `live-chat-ticket-${detail.ticketId}`
        : 'live-chat-incoming';
      playCategorySound('live_chat', { dedupKey });
    };

    const handleEventSound = (e: Event) => {
      const detail =
        (e as CustomEvent<{
          event?:
            | 'loading'
            | 'ready'
            | 'report_saved'
            | 'error'
            | 'sync'
            | 'wo_assignment'
            | 'important'
            | 'critical';
          dedupKey?: string;
        }>).detail || {};
      switch (detail.event) {
        case 'loading':
          playLoadingSound();
          break;
        case 'ready':
          playReadySound();
          break;
        case 'report_saved':
          playReportSavedSound();
          break;
        case 'error':
          playErrorSound();
          break;
        case 'sync':
          playSyncSound();
          break;
        case 'wo_assignment':
        case 'important':
        case 'critical':
          playCategorySound(detail.event, {
            dedupKey: detail.dedupKey || `event-${detail.event}`
          });
          break;
        default:
          break;
      }
    };

    window.addEventListener('morajaws:toast-sound', handleToastSound);
    window.addEventListener('morajaws:livechat-sound', handleLiveChatSound);
    window.addEventListener('morajaws:event-sound', handleEventSound);
    return () => {
      window.removeEventListener('morajaws:toast-sound', handleToastSound);
      window.removeEventListener('morajaws:livechat-sound', handleLiveChatSound);
      window.removeEventListener('morajaws:event-sound', handleEventSound);
    };
  }, [
    playCategorySound,
    playLoadingSound,
    playReadySound,
    playReportSavedSound,
    playErrorSound,
    playSyncSound
  ]);

  const previewSound = useCallback(
    (type: LegacyPreviewType | NotificationSoundCategory, previewVolume?: number) => {
      const mapLegacy: Record<LegacyPreviewType, NotificationSoundCategory> = {
        loading: 'normal',
        ready: 'normal',
        report_saved: 'success',
        error: 'critical',
        sync: 'normal'
      };
      const resolvedCategory: NotificationSoundCategory =
        type in mapLegacy ? mapLegacy[type as LegacyPreviewType] : (type as NotificationSoundCategory);

      const effectiveVol =
        previewVolume !== undefined
          ? previewVolume
          : soundSettingsRef.current.volume > 0
          ? soundSettingsRef.current.volume
          : 55;

      void notificationAudioService.unlock().then(() => {
        playCategorySound(resolvedCategory, {
          force: true,
          dedupKey: `preview-${resolvedCategory}`,
          previewVolume: effectiveVol
        });
      });
    },
    [playCategorySound]
  );

  return (
    <SoundContext.Provider
      value={{
        soundSettings,
        soundVersion,
        isSoundSaving,
        soundError,
        soundConflict,
        soundScope,
        hasPersonalOverride,
        audioEngineState,
        clearSoundConflict,
        resolveSoundConflict,
        updateSoundSettings,
        restoreDefaultSoundSettings,
        playLoadingSound,
        playReadySound,
        playReportSavedSound,
        playErrorSound,
        playSyncSound,
        playLiveChatSound,
        unlockAudio,
        playCategorySound,
        previewSound
      }}
    >
      {children}
    </SoundContext.Provider>
  );
};

export const useMoraJawsSound = (): SoundContextType => {
  const context = useContext(SoundContext);
  if (!context) {
    throw new Error('useMoraJawsSound must be used within a MoraJawsSoundProvider');
  }
  return context;
};
