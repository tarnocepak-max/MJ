import { getAuthHeaders } from './authService.ts';
import { queryLocationPermissionStatus } from './geolocationService.ts';
import { calculateHaversineDistanceMeters, isValidCoordinatePair } from './mapsService.ts';
import { subscribeToGlobalConfigUpdates } from './globalConfigService.ts';
import type { GpsTrackingConfig, InstallerLocationStatus, InstallerOnlineStatus } from '../types/index.ts';
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet } from '../utils/safeStorage';

// ==============================================================================
// MORAJAWS FRONTEND AUTOMATIC INSTALLER GPS TRACKING CONTROLLER
// - Strictly runs ONLY after authenticated Installer login (never pre-login).
// - Uses real device Geolocation API watchPosition (never fabricated coords).
// - Handles offline queue & automatic chronological batch resync on reconnect.
// - Decouples Online/Offline session heartbeat from Location Fresh/Stale/Error.
// ==============================================================================

export type GpsSyncUiStage =
  | 'IDLE'
  | 'GPS_INITIALIZATION'
  | 'LOCATION_SYNC'
  | 'LOCATION_CONNECTED'
  | 'LOCATION_ERROR';

export interface InstallerGpsUiSnapshot {
  active: boolean;
  isBusy: boolean;
  stage: GpsSyncUiStage;
  stageBadge: string;
  headline: string;
  detail: string;
  errorMessage: string | null;
  onlineStatus: InstallerOnlineStatus;
  locationStatus: InstallerLocationStatus;
  permissionState: 'granted' | 'prompt' | 'denied' | 'unsupported';
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  lastSyncedAt: string | null;
  queuedPointsCount: number;
  sessionId: string | null;
  config: GpsTrackingConfig;
}

export interface QueuedGpsPoint {
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: string;
}

export const DEFAULT_FRONTEND_GPS_CONFIG: GpsTrackingConfig = {
  enabled: true,
  autoStartOnLogin: true,
  syncIntervalSeconds: 60,
  minDistanceMeters: 15,
  heartbeatIntervalSeconds: 60,
  heartbeatTimeoutSeconds: 150,
  locationStaleThresholdSeconds: 180,
  historyRetentionDays: 30,
  offlineQueueMaxEntries: 100,
  maxAcceptableAccuracyMeters: 500
};

type StateListener = (snapshot: InstallerGpsUiSnapshot) => void;
type ToastEventListener = (event: {
  stage: GpsSyncUiStage;
  type: 'sync' | 'success' | 'warning' | 'error';
  badge: string;
  title: string;
  message: string;
}) => void;

class InstallerGpsTrackingController {
  private watchId: number | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private periodicSyncTimer: ReturnType<typeof setInterval> | null = null;
  private permissionStatusObj: PermissionStatus | null = null;
  private unsubConfigUpdate: (() => void) | null = null;
  private activeUserId: string | null = null;
  private activeSessionId: string | null = null;
  private lastSentCoords: { lat: number; lng: number; timestampMs: number } | null = null;
  private isFlushingQueue = false;
  private watchFallbackLowAccuracy = false;
  private activeConnectPromise: Promise<{ ok: boolean; message: string }> | null = null;
  private hasShownConnectedToastThisSession = false;
  private hasShownDeniedToastThisSession = false;
  private hasShownSyncToastThisSession = false;
  private config: GpsTrackingConfig = { ...DEFAULT_FRONTEND_GPS_CONFIG };
  private stateListeners = new Set<StateListener>();
  private toastListeners = new Set<ToastEventListener>();

  private snapshot: InstallerGpsUiSnapshot = {
    active: false,
    isBusy: false,
    stage: 'IDLE',
    stageBadge: 'IDLE',
    headline: 'Tracking Nonaktif',
    detail: 'Menunggu sesi Installer aktif.',
    errorMessage: null,
    onlineStatus: 'Offline',
    locationStatus: 'Waiting for GPS',
    permissionState: 'prompt',
    latitude: null,
    longitude: null,
    accuracyMeters: null,
    lastSyncedAt: null,
    queuedPointsCount: 0,
    sessionId: null,
    config: { ...DEFAULT_FRONTEND_GPS_CONFIG }
  };

  public getSnapshot(): InstallerGpsUiSnapshot {
    return { ...this.snapshot, config: { ...this.config } };
  }

  public subscribe(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public subscribeToasts(listener: ToastEventListener): () => void {
    this.toastListeners.add(listener);
    return () => {
      this.toastListeners.delete(listener);
    };
  }

  private emitState(partial: Partial<InstallerGpsUiSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      config: { ...this.config }
    };
    const snap = this.getSnapshot();
    this.stateListeners.forEach(cb => {
      try {
        cb(snap);
      } catch {}
    });
  }

  private emitToast(evt: {
    stage: GpsSyncUiStage;
    type: 'sync' | 'success' | 'warning' | 'error';
    badge: string;
    title: string;
    message: string;
  }) {
    this.toastListeners.forEach(cb => {
      try {
        cb(evt);
      } catch {}
    });
  }

  private getQueueStorageKey(): string | null {
    if (!this.activeUserId || !this.activeSessionId) return null;
    return `morajaws_gps_offline_queue_${this.activeUserId}_${this.activeSessionId}`;
  }

  private loadOfflineQueue(): QueuedGpsPoint[] {
    const key = this.getQueueStorageKey();
    if (!key) return [];
    try {
      const raw = safeLocalStorageGet(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveOfflineQueue(points: QueuedGpsPoint[]) {
    const key = this.getQueueStorageKey();
    if (!key) return;
    try {
      const capped = points.slice(-Math.max(10, this.config.offlineQueueMaxEntries));
      if (capped.length === 0) {
        safeLocalStorageRemove(key);
      } else {
        safeLocalStorageSet(key, JSON.stringify(capped));
      }
      this.emitState({ queuedPointsCount: capped.length });
    } catch {}
  }

  private enqueueOfflinePoint(pt: QueuedGpsPoint) {
    const queue = this.loadOfflineQueue();
    const last = queue[queue.length - 1];
    if (
      last &&
      Math.abs(last.latitude - pt.latitude) < 0.000001 &&
      Math.abs(last.longitude - pt.longitude) < 0.000001 &&
      last.timestamp === pt.timestamp
    ) {
      return;
    }
    queue.push(pt);
    this.saveOfflineQueue(queue);
  }

  private readSessionFromStorage(): { userId: string; role: string; sessionId: string; token: string } | null {
    try {
      const loggedIn = safeLocalStorageGet('morajaws_logged_in');
      const raw = safeLocalStorageGet('morajaws_auth_session');
      if (loggedIn !== 'true' || !raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.userId || !parsed?.token || parsed?.role !== 'installer') return null;
      const sessionId = String(parsed.sessionId || '').trim();
      return {
        userId: String(parsed.userId),
        role: String(parsed.role),
        sessionId,
        token: String(parsed.token)
      };
    } catch {
      return null;
    }
  }

  private persistSessionIdToStorage(sessionId: string) {
    try {
      const raw = safeLocalStorageGet('morajaws_auth_session');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.sessionId !== sessionId) {
        safeLocalStorageSet('morajaws_auth_session', JSON.stringify({ ...parsed, sessionId }));
      }
    } catch {}
  }

  private async ensureBackendTrackingSession(): Promise<string | null> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return this.activeSessionId;
    }
    const stored = this.readSessionFromStorage();
    const candidateSessionId = String(this.activeSessionId || stored?.sessionId || '').trim();
    try {
      const res = await fetch('/api/installer-tracking/session/ensure', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          sessionId: candidateSessionId || undefined
        })
      });
      if (!res.ok) return this.activeSessionId;
      const json = await res.json().catch(() => null);
      if (json?.success && json.sessionId) {
        const confirmedSessionId = String(json.sessionId).trim();
        if (confirmedSessionId) {
          this.activeSessionId = confirmedSessionId;
          this.persistSessionIdToStorage(confirmedSessionId);
          this.emitState({ sessionId: confirmedSessionId });
          return confirmedSessionId;
        }
      }
    } catch {}
    return this.activeSessionId;
  }

  private handleOnlineRecovery = () => {
    if (!this.activeSessionId) return;
    this.flushOfflineQueue().catch(() => {});
    this.sendHeartbeat().catch(() => {});
  };

  private handleVisibilityChange = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
    if (!this.activeSessionId) return;
    this.sendHeartbeat().catch(() => {});
  };

  public async startForAuthenticatedInstaller(params: {
    userId: string;
    role: string;
    sessionId?: string | null;
  }): Promise<void> {
    if (params.role !== 'installer') {
      this.stopTracking();
      return;
    }

    const stored = this.readSessionFromStorage();
    let resolvedSessionId = String(params.sessionId || stored?.sessionId || '').trim();

    if (!resolvedSessionId) {
      resolvedSessionId = (await this.ensureBackendTrackingSession()) || '';
    }
    if (!resolvedSessionId) {
      return;
    }

    // Already tracking exact same session
    if (this.snapshot.active && this.activeUserId === params.userId && this.activeSessionId === resolvedSessionId) {
      return;
    }

    this.stopTracking({ silent: true });

    this.activeUserId = params.userId;
    this.activeSessionId = resolvedSessionId;
    this.lastSentCoords = null;
    this.watchFallbackLowAccuracy = false;
    this.hasShownConnectedToastThisSession = false;
    this.hasShownDeniedToastThisSession = false;
    this.hasShownSyncToastThisSession = false;

    const existingQueue = this.loadOfflineQueue();

    this.emitState({
      active: true,
      isBusy: false,
      errorMessage: null,
      stage: 'GPS_INITIALIZATION',
      stageBadge: 'GPS INITIALIZATION',
      headline: 'Inisialisasi GPS Installer',
      detail: 'Memeriksa izin lokasi perangkat dan memuat konfigurasi tracking...',
      onlineStatus: navigator.onLine ? 'Online' : 'Offline',
      locationStatus: 'Waiting for GPS',
      queuedPointsCount: existingQueue.length,
      sessionId: resolvedSessionId
    });

    await Promise.all([
      this.ensureBackendTrackingSession(),
      this.loadServerTrackingConfig()
    ]);
    this.setupLiveConfigSubscription();

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnlineRecovery);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    if (!this.config.enabled || !this.config.autoStartOnLogin) {
      this.emitState({
        stage: 'IDLE',
        stageBadge: 'STANDBY',
        headline: this.config.enabled ? 'Tracking Siaga' : 'Tracking Dinonaktifkan Admin',
        detail: this.config.enabled
          ? 'Sinkronisasi otomatis saat login dinonaktifkan oleh Superadmin.'
          : 'Fitur Live GPS Tracking saat ini dinonaktifkan oleh Superadmin.',
        onlineStatus: navigator.onLine ? 'Online' : 'Offline',
        locationStatus: 'Waiting for GPS'
      });
      this.startHeartbeatLoop();
      return;
    }

    this.startHeartbeatLoop();
    this.startPeriodicAutoSyncLoop();
    await this.beginPermissionAndWatch();
  }

  private async loadServerTrackingConfig(): Promise<void> {
    try {
      const res = await fetch('/api/installer-tracking/config', {
        headers: getAuthHeaders()
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.success && json.config) {
          this.config = { ...DEFAULT_FRONTEND_GPS_CONFIG, ...json.config };
        }
      }
    } catch {}
  }

  private setupLiveConfigSubscription() {
    if (this.unsubConfigUpdate) {
      this.unsubConfigUpdate();
      this.unsubConfigUpdate = null;
    }
    this.unsubConfigUpdate = subscribeToGlobalConfigUpdates(evt => {
      if (evt?.key === 'gps_tracking_config' && evt.value && typeof evt.value === 'object') {
        const prevHeartbeat = this.config.heartbeatIntervalSeconds;
        const prevSyncInterval = this.config.syncIntervalSeconds;
        this.config = { ...DEFAULT_FRONTEND_GPS_CONFIG, ...evt.value };
        this.emitState({ config: { ...this.config } });
        if (prevHeartbeat !== this.config.heartbeatIntervalSeconds) {
          this.startHeartbeatLoop();
        }
        if (prevSyncInterval !== this.config.syncIntervalSeconds) {
          this.startPeriodicAutoSyncLoop();
        }
        if (!this.config.enabled) {
          this.stopGeolocationWatch();
          this.stopPeriodicAutoSyncLoop();
          this.emitState({
            stage: 'IDLE',
            stageBadge: 'DISABLED BY ADMIN',
            headline: 'Tracking Dinonaktifkan Admin',
            detail: 'Superadmin menonaktifkan sementara Live GPS Tracking.',
            locationStatus: 'GPS Disabled'
          });
        } else if (this.snapshot.active && this.watchId === null) {
          this.startPeriodicAutoSyncLoop();
          this.beginPermissionAndWatch().catch(() => {});
        }
      }
    });
  }

  private async beginPermissionAndWatch(): Promise<void> {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      this.emitState({
        stage: 'LOCATION_ERROR',
        stageBadge: 'LOCATION ERROR',
        headline: 'Perangkat Tidak Mendukung GPS',
        detail: 'Browser atau perangkat ini tidak menyediakan Geolocation API.',
        permissionState: 'unsupported',
        locationStatus: 'GPS Disabled'
      });
      await this.reportLocationStatus('GPS Disabled');
      return;
    }

    const perm = await queryLocationPermissionStatus();
    this.emitState({ permissionState: perm });

    try {
      if (!this.permissionStatusObj && navigator.permissions?.query) {
        this.permissionStatusObj = await navigator.permissions.query({
          name: 'geolocation' as PermissionName
        });
        this.permissionStatusObj.onchange = () => {
          const nextPerm = this.permissionStatusObj?.state || 'prompt';
          this.emitState({ permissionState: nextPerm });
          if (nextPerm === 'denied') {
            this.handlePermissionDenied();
          } else if (nextPerm === 'granted' && this.snapshot.active && this.watchId === null) {
            this.startGeolocationWatch();
          }
        };
      }
    } catch {}

    // Never repeatedly trigger OS prompt if already denied
    if (perm === 'denied') {
      await this.handlePermissionDenied();
      return;
    }

    if (!this.hasShownSyncToastThisSession) {
      this.hasShownSyncToastThisSession = true;
      this.emitToast({
        stage: 'GPS_INITIALIZATION',
        type: 'sync',
        badge: 'GPS INITIALIZATION',
        title: 'Sinkronisasi Lokasi Installer',
        message:
          perm === 'granted'
            ? 'Mengambil koordinat GPS perangkat Anda secara otomatis...'
            : 'Mohon izinkan akses lokasi perangkat agar posisi Anda terpantau di Monitoring Maps.'
      });
    }

    this.emitState({
      stage: 'LOCATION_SYNC',
      stageBadge: 'LOCATION SYNC',
      headline: 'Mengambil Koordinat GPS...',
      detail: 'Menunggu kunci sinyal satelit GPS perangkat.',
      locationStatus: 'Waiting for GPS'
    });

    this.startGeolocationWatch();
  }

  private startGeolocationWatch(useHighAccuracy = !this.watchFallbackLowAccuracy) {
    this.stopGeolocationWatch();
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    try {
      this.watchId = navigator.geolocation.watchPosition(
        pos => {
          this.handlePositionUpdate(pos).catch(() => {});
        },
        err => {
          if (useHighAccuracy && err.code !== err.PERMISSION_DENIED) {
            this.watchFallbackLowAccuracy = true;
            this.startGeolocationWatch(false);
            return;
          }
          this.handlePositionError(err).catch(() => {});
        },
        {
          enableHighAccuracy: useHighAccuracy,
          maximumAge: useHighAccuracy ? 5000 : 20000,
          timeout: 15000
        }
      );
    } catch {
      this.reportLocationStatus('GPS Disabled').catch(() => {});
    }
  }

  private stopGeolocationWatch() {
    if (this.watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        navigator.geolocation.clearWatch(this.watchId);
      } catch {}
      this.watchId = null;
    }
  }

  private getCurrentPositionAsync(options: PositionOptions): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        reject(new Error('GEOLOCATION_UNSUPPORTED'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
  }

  public connectAndSyncNow(): Promise<{ ok: boolean; message: string }> {
    if (this.activeConnectPromise) {
      return this.activeConnectPromise;
    }

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      const msg = 'Browser atau perangkat Anda tidak mendukung fitur Geolocation GPS.';
      this.emitState({
        isBusy: false,
        stage: 'LOCATION_ERROR',
        stageBadge: 'LOCATION ERROR',
        headline: 'Perangkat Tidak Mendukung GPS',
        detail: msg,
        errorMessage: msg,
        permissionState: 'unsupported',
        locationStatus: 'GPS Disabled'
      });
      this.reportLocationStatus('GPS Disabled').catch(() => {});
      return Promise.resolve({ ok: false, message: msg });
    }

    // CRITICAL: Invoke navigator.geolocation synchronously inside the button-click call stack
    // so browsers preserve user-gesture activation for permission prompts.
    const highAccuracyPromise = this.getCurrentPositionAsync({
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 12000
    });

    this.emitState({
      active: true,
      isBusy: true,
      errorMessage: null,
      stage: 'LOCATION_SYNC',
      stageBadge: 'LOCATION SYNC',
      headline: 'Mengambil Koordinat GPS...',
      detail: 'Meminta izin & mengunci koordinat perangkat untuk disinkronkan ke Monitoring Maps...'
    });

    this.activeConnectPromise = (async () => {
      try {
        const stored = this.readSessionFromStorage();
        if (!this.activeUserId && stored?.userId) {
          this.activeUserId = stored.userId;
        }
        if (!this.activeSessionId) {
          await this.ensureBackendTrackingSession();
        }
        if (!this.activeSessionId) {
          const msg = 'Sesi Installer belum siap. Silakan login ulang.';
          this.emitState({
            isBusy: false,
            stage: 'LOCATION_ERROR',
            stageBadge: 'SESSION REQUIRED',
            headline: 'Sesi Installer Tidak Ditemukan',
            detail: msg,
            errorMessage: msg
          });
          return { ok: false, message: msg };
        }

        let position: GeolocationPosition;
        let usedFallbackAccuracy = false;
        try {
          position = await highAccuracyPromise;
        } catch (firstErr: any) {
          if (firstErr?.code === 1) {
            throw firstErr;
          }
          usedFallbackAccuracy = true;
          position = await this.getCurrentPositionAsync({
            enableHighAccuracy: false,
            maximumAge: 30000,
            timeout: 12000
          });
        }

        this.watchFallbackLowAccuracy = usedFallbackAccuracy;

        if (this.loadOfflineQueue().length > 0 && navigator.onLine) {
          await this.flushOfflineQueue();
        }

        const synced = await this.handlePositionUpdate(position, { forceSend: true });
        this.startGeolocationWatch(!usedFallbackAccuracy);

        if (synced) {
          const acc = Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : '?';
          const msg = `GPS terhubung (${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)} · ±${acc}m) & tersinkron ke Monitoring Maps.`;
          this.emitState({ isBusy: false, errorMessage: null });
          return { ok: true, message: msg };
        }

        const pendingMsg = navigator.onLine
          ? 'Koordinat diperoleh, menunggu respons sinkronisasi server...'
          : 'Koordinat tersimpan lokal, akan disinkronkan otomatis saat internet aktif.';
        this.emitState({ isBusy: false, errorMessage: pendingMsg });
        return { ok: false, message: pendingMsg };
      } catch (err: any) {
        if (err?.code === 1) {
          await this.handlePermissionDenied(true);
          return {
            ok: false,
            message: 'Izin lokasi ditolak di browser. Aktifkan izin Lokasi pada pengaturan situs browser Anda lalu coba lagi.'
          };
        }
        if (err && typeof err.code === 'number') {
          await this.handlePositionError(err as GeolocationPositionError);
        }
        const errMsg =
          err?.code === 3
            ? 'Waktu pencarian sinyal GPS habis (Timeout). Pastikan GPS/Lokasi perangkat menyala lalu tekan coba lagi.'
            : 'Layanan lokasi perangkat tidak aktif atau sinyal lokasi tidak tersedia.';
        this.emitState({
          isBusy: false,
          errorMessage: errMsg
        });
        return { ok: false, message: errMsg };
      } finally {
        this.activeConnectPromise = null;
      }
    })();

    return this.activeConnectPromise;
  }

  public requestOrRetryGps(): Promise<{ ok: boolean; message: string }> {
    return this.connectAndSyncNow();
  }

  public syncNow(): Promise<{ ok: boolean; message: string }> {
    return this.connectAndSyncNow();
  }

  private async handlePermissionDenied(forceToast = false) {
    this.stopGeolocationWatch();
    const deniedMsg = 'Izin lokasi ditolak. Aktifkan izin GPS browser untuk mengakses portal & mengirim posisi ke Monitoring Maps.';
    this.emitState({
      isBusy: false,
      stage: 'LOCATION_ERROR',
      stageBadge: 'LOCATION ERROR',
      headline: 'Location Permission Required',
      detail: deniedMsg,
      errorMessage: deniedMsg,
      permissionState: 'denied',
      locationStatus: 'Permission Denied'
    });
    await this.reportLocationStatus('Permission Denied');

    if (!this.hasShownDeniedToastThisSession || forceToast) {
      this.hasShownDeniedToastThisSession = true;
      this.emitToast({
        stage: 'LOCATION_ERROR',
        type: 'warning',
        badge: 'Location Permission Required',
        title: 'Izin Lokasi Diperlukan',
        message: deniedMsg
      });
    }
  }

  private async handlePositionError(err: GeolocationPositionError) {
    if (err.code === err.PERMISSION_DENIED) {
      await this.handlePermissionDenied();
      return;
    }

    const nextLocStatus: InstallerLocationStatus =
      err.code === err.TIMEOUT ? 'No Signal' : 'GPS Disabled';
    const headline =
      err.code === err.TIMEOUT ? 'Sinyal GPS Tidak Stabil' : 'GPS Perangkat Tidak Aktif';
    const detail =
      err.code === err.TIMEOUT
        ? 'Timeout mendapatkan koordinat lokasi (No Signal). Pastikan layanan lokasi perangkat aktif lalu coba ulang.'
        : 'Layanan lokasi perangkat nonaktif (GPS Disabled). Aktifkan GPS perangkat Anda.';

    this.emitState({
      isBusy: false,
      stage: 'LOCATION_ERROR',
      stageBadge: 'LOCATION ERROR',
      headline,
      detail,
      errorMessage: detail,
      locationStatus: nextLocStatus
    });
    await this.reportLocationStatus(nextLocStatus);
  }

  private async handlePositionUpdate(
    position: GeolocationPosition,
    options?: { forceSend?: boolean }
  ): Promise<boolean> {
    if (!this.activeSessionId || !this.snapshot.active) return false;

    const coords = position.coords;
    if (!isValidCoordinatePair(coords.latitude, coords.longitude)) {
      return false;
    }

    const lat = Number(coords.latitude.toFixed(7));
    const lng = Number(coords.longitude.toFixed(7));
    const acc = Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null;
    const speed =
      typeof coords.speed === 'number' && Number.isFinite(coords.speed) && coords.speed >= 0
        ? Number(coords.speed.toFixed(2))
        : null;
    const heading =
      typeof coords.heading === 'number' && Number.isFinite(coords.heading) && coords.heading >= 0
        ? Number(coords.heading.toFixed(1))
        : null;
    const nowMs = Date.now();
    const recordedIso = new Date(position.timestamp || nowMs).toISOString();

    this.emitState({
      permissionState: 'granted',
      latitude: lat,
      longitude: lng,
      accuracyMeters: acc,
      errorMessage: null
    });

    // Deduplication & configurable threshold check
    if (!options?.forceSend && this.lastSentCoords) {
      const elapsedSec = (nowMs - this.lastSentCoords.timestampMs) / 1000;
      const movedMeters = calculateHaversineDistanceMeters(
        this.lastSentCoords.lat,
        this.lastSentCoords.lng,
        lat,
        lng
      );

      if (
        Math.abs(this.lastSentCoords.lat - lat) < 0.000001 &&
        Math.abs(this.lastSentCoords.lng - lng) < 0.000001 &&
        elapsedSec < this.config.syncIntervalSeconds
      ) {
        return true;
      }

      if (
        movedMeters < this.config.minDistanceMeters &&
        elapsedSec < this.config.syncIntervalSeconds
      ) {
        return true;
      }
    }

    const point: QueuedGpsPoint = {
      sessionId: this.activeSessionId,
      latitude: lat,
      longitude: lng,
      accuracy: acc,
      speed,
      heading,
      timestamp: recordedIso
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.enqueueOfflinePoint(point);
      this.lastSentCoords = { lat, lng, timestampMs: nowMs };
      this.emitState({
        stage: 'LOCATION_SYNC',
        stageBadge: 'OFFLINE QUEUE',
        onlineStatus: 'Offline',
        locationStatus: 'Location Stale',
        headline: 'Internet Terputus — Antre Offline',
        detail: `${this.loadOfflineQueue().length} titik koordinat disimpan lokal dan akan disinkronkan saat online.`
      });
      return false;
    }

    try {
      const postLocation = async (sessionIdToSend: string) => {
        return fetch('/api/installer-tracking/location', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ ...point, sessionId: sessionIdToSend })
        });
      };

      let res = await postLocation(this.activeSessionId);
      if (res.status === 404) {
        const recoveredSessionId = await this.ensureBackendTrackingSession();
        if (recoveredSessionId) {
          point.sessionId = recoveredSessionId;
          res = await postLocation(recoveredSessionId);
        }
      }

      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 409) {
          const errJson = await res.json().catch(() => null);
          if (res.status === 409 || errJson?.code === 'SESSION_SUPERSEDED' || errJson?.code === 'SESSION_ENDED') {
            this.stopTracking({ silent: true });
            return false;
          }
        }
        throw new Error(`HTTP ${res.status}`);
      }

      this.lastSentCoords = { lat, lng, timestampMs: nowMs };
      const syncedIso = new Date().toISOString();

      this.emitState({
        isBusy: false,
        errorMessage: null,
        stage: 'LOCATION_CONNECTED',
        stageBadge: 'LOCATION CONNECTED',
        onlineStatus: 'Online',
        locationStatus: 'Location Fresh',
        headline: 'Lokasi Live Tersinkron',
        detail: `Akurasi ±${acc ?? '?'}m • Terakhir sync ${new Date(syncedIso).toLocaleTimeString('id-ID', {
          timeZone: 'Asia/Jakarta',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        })} WIB`,
        lastSyncedAt: syncedIso
      });

      if (!this.hasShownConnectedToastThisSession) {
        this.hasShownConnectedToastThisSession = true;
        this.emitToast({
          stage: 'LOCATION_CONNECTED',
          type: 'success',
          badge: 'LOCATION CONNECTED',
          title: 'GPS Terhubung ke Monitoring Maps',
          message: `GPS perangkat aktif (${lat.toFixed(5)}, ${lng.toFixed(5)} · akurasi ±${acc ?? '?'}m).`
        });
      }

      if (this.loadOfflineQueue().length > 0) {
        this.flushOfflineQueue().catch(() => {});
      }
      return true;
    } catch {
      this.enqueueOfflinePoint(point);
      this.lastSentCoords = { lat, lng, timestampMs: nowMs };
      this.emitState({
        stage: 'LOCATION_SYNC',
        stageBadge: 'RETRY QUEUED',
        headline: 'Sinkronisasi Tertunda',
        detail: `Koneksi lambat/offline — ${this.loadOfflineQueue().length} koordinat menunggu pengiriman ulang.`,
        errorMessage: 'Sinkronisasi ke server tertunda. Coba tekan Sinkronkan ulang.'
      });
      return false;
    }
  }

  private async flushOfflineQueue(): Promise<void> {
    if (this.isFlushingQueue || !this.activeSessionId) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const queue = this.loadOfflineQueue();
    if (queue.length === 0) return;

    this.isFlushingQueue = true;
    try {
      const res = await fetch('/api/installer-tracking/location/batch', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          sessionId: this.activeSessionId,
          points: queue
        })
      });
      if (res.ok) {
        this.saveOfflineQueue([]);
        const nowIso = new Date().toISOString();
        this.emitState({
          stage: 'LOCATION_CONNECTED',
          stageBadge: 'LOCATION CONNECTED',
          onlineStatus: 'Online',
          locationStatus: 'Location Fresh',
          lastSyncedAt: nowIso,
          headline: 'Antrean GPS Tersinkron',
          detail: `${queue.length} titik offline berhasil dikirim berurutan.`
        });
      }
    } catch {
    } finally {
      this.isFlushingQueue = false;
    }
  }

  private async reportLocationStatus(locationStatus: InstallerLocationStatus): Promise<void> {
    if (!this.activeSessionId) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      await fetch('/api/installer-tracking/session/status', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          sessionId: this.activeSessionId,
          locationStatus
        })
      });
    } catch {}
  }

  private startHeartbeatLoop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    const intervalMs = Math.max(15000, (this.config.heartbeatIntervalSeconds || 60) * 1000);
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch(() => {});
    }, intervalMs);
  }

  private stopPeriodicAutoSyncLoop() {
    if (this.periodicSyncTimer) {
      clearInterval(this.periodicSyncTimer);
      this.periodicSyncTimer = null;
    }
  }

  private startPeriodicAutoSyncLoop() {
    this.stopPeriodicAutoSyncLoop();
    const intervalMs = Math.max(15000, (this.config.syncIntervalSeconds || 60) * 1000);
    this.periodicSyncTimer = setInterval(() => {
      if (!this.snapshot.active || !this.activeSessionId || !this.config.enabled) return;
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;
      if (this.snapshot.permissionState === 'denied') return;

      this.getCurrentPositionAsync({
        enableHighAccuracy: !this.watchFallbackLowAccuracy,
        maximumAge: Math.min(30000, intervalMs),
        timeout: 12000
      })
        .then(pos => this.handlePositionUpdate(pos))
        .catch(err => {
          if (err && typeof err.code === 'number') {
            this.handlePositionError(err as GeolocationPositionError).catch(() => {});
          }
        });
    }, intervalMs);
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.activeSessionId || !this.snapshot.active) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.emitState({ onlineStatus: 'Offline' });
      return;
    }
    try {
      const res = await fetch('/api/installer-tracking/heartbeat', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          sessionId: this.activeSessionId,
          locationStatus: this.snapshot.locationStatus
        })
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.location) {
          this.emitState({
            onlineStatus: json.location.onlineStatus || 'Online',
            locationStatus: json.location.locationStatus || this.snapshot.locationStatus
          });
        } else {
          this.emitState({ onlineStatus: 'Online' });
        }
      } else if (res.status === 401 || res.status === 409) {
        this.stopTracking({ silent: true });
      }
    } catch {}
  }

  public stopTracking(options?: { silent?: boolean }) {
    this.stopGeolocationWatch();
    this.stopPeriodicAutoSyncLoop();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.unsubConfigUpdate) {
      this.unsubConfigUpdate();
      this.unsubConfigUpdate = null;
    }
    if (this.permissionStatusObj) {
      this.permissionStatusObj.onchange = null;
      this.permissionStatusObj = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnlineRecovery);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.activeUserId = null;
    this.activeSessionId = null;
    this.lastSentCoords = null;

    if (!options?.silent) {
      this.emitState({
        active: false,
        isBusy: false,
        errorMessage: null,
        stage: 'IDLE',
        stageBadge: 'OFFLINE',
        headline: 'Sesi GPS Dihentikan',
        detail: 'Pemantauan lokasi berhenti saat logout.',
        onlineStatus: 'Offline',
        locationStatus: 'Location Stale',
        latitude: null,
        longitude: null,
        accuracyMeters: null,
        lastSyncedAt: null,
        queuedPointsCount: 0,
        sessionId: null
      });
    }
  }
}

export const installerGpsTracker = new InstallerGpsTrackingController();
