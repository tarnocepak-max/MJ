import crypto from 'crypto';
import type {
  GpsTrackingConfig,
  InstallerCurrentLocationRecord,
  InstallerLiveLocationView,
  InstallerLocationHistoryEntry,
  InstallerLocationStatus,
  InstallerOnlineStatus,
  InstallerSessionLifecycleStatus,
  InstallerSessionRecord
} from '../src/types/index.ts';
import { getSupabaseBackendClient } from './supabaseClient.ts';
import { getUsersFromSupabase } from './supabaseAdapter.ts';
import { isAreaMatch, isContractorMatch } from './appFlowHelpers.ts';
import {
  db,
  saveDatabaseToDisk,
  isLocalJsonModeAllowed,
  isSupabaseMode,
  broadcastSupabaseChange
} from '../server.ts';

// ==============================================================================
// MORAJAWS INSTALLER LIVE GPS TRACKING SERVICE
// Authoritative backend engine for Installer login sessions, live GPS updates,
// decoupled online/location statuses, heartbeat staleness, offline batch resync,
// location history retention cleanup, and strict RBAC + multi-device protection.
// ==============================================================================

export const DEFAULT_GPS_TRACKING_CONFIG: GpsTrackingConfig = {
  enabled: true,
  autoStartOnLogin: true,
  syncIntervalSeconds: 20,
  minDistanceMeters: 15,
  heartbeatIntervalSeconds: 20,
  heartbeatTimeoutSeconds: 60,
  locationStaleThresholdSeconds: 90,
  historyRetentionDays: 30,
  offlineQueueMaxEntries: 100,
  maxAcceptableAccuracyMeters: 500
};

const VALID_LOCATION_STATUSES: ReadonlySet<InstallerLocationStatus> = new Set([
  'Location Fresh',
  'Location Stale',
  'GPS Disabled',
  'Permission Denied',
  'No Signal',
  'Waiting for GPS'
]);

const EXPLICIT_FAULT_LOCATION_STATUSES: ReadonlySet<InstallerLocationStatus> = new Set([
  'GPS Disabled',
  'Permission Denied',
  'No Signal',
  'Waiting for GPS'
]);

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

export function normalizeGpsTrackingConfig(raw?: Partial<GpsTrackingConfig> | null): GpsTrackingConfig {
  const src = raw && typeof raw === 'object' ? raw : {};
  const heartbeatIntervalSeconds = clampInt(
    src.heartbeatIntervalSeconds,
    DEFAULT_GPS_TRACKING_CONFIG.heartbeatIntervalSeconds,
    5,
    120
  );
  const heartbeatTimeoutSeconds = Math.max(
    heartbeatIntervalSeconds + 5,
    clampInt(src.heartbeatTimeoutSeconds, DEFAULT_GPS_TRACKING_CONFIG.heartbeatTimeoutSeconds, 15, 600)
  );
  return {
    enabled: src.enabled !== undefined ? Boolean(src.enabled) : DEFAULT_GPS_TRACKING_CONFIG.enabled,
    autoStartOnLogin:
      src.autoStartOnLogin !== undefined
        ? Boolean(src.autoStartOnLogin)
        : DEFAULT_GPS_TRACKING_CONFIG.autoStartOnLogin,
    syncIntervalSeconds: clampInt(
      src.syncIntervalSeconds,
      DEFAULT_GPS_TRACKING_CONFIG.syncIntervalSeconds,
      5,
      300
    ),
    minDistanceMeters: clampInt(
      src.minDistanceMeters,
      DEFAULT_GPS_TRACKING_CONFIG.minDistanceMeters,
      0,
      500
    ),
    heartbeatIntervalSeconds,
    heartbeatTimeoutSeconds,
    locationStaleThresholdSeconds: clampInt(
      src.locationStaleThresholdSeconds,
      DEFAULT_GPS_TRACKING_CONFIG.locationStaleThresholdSeconds,
      15,
      900
    ),
    historyRetentionDays: clampInt(
      src.historyRetentionDays,
      DEFAULT_GPS_TRACKING_CONFIG.historyRetentionDays,
      1,
      365
    ),
    offlineQueueMaxEntries: clampInt(
      src.offlineQueueMaxEntries,
      DEFAULT_GPS_TRACKING_CONFIG.offlineQueueMaxEntries,
      10,
      500
    ),
    maxAcceptableAccuracyMeters: clampInt(
      src.maxAcceptableAccuracyMeters,
      DEFAULT_GPS_TRACKING_CONFIG.maxAcceptableAccuracyMeters,
      20,
      5000
    )
  };
}

export function isValidLiveGpsCoordinate(lat?: unknown, lng?: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  // Reject Null Island (0, 0) / spoofed placeholder coordinates
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;
  return true;
}

export function calculateHaversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (!isValidLiveGpsCoordinate(lat1, lng1) || !isValidLiveGpsCoordinate(lat2, lng2)) {
    return 0;
  }
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function ensureLocalTrackingStores() {
  if (!Array.isArray((db as any).installerSessions)) {
    (db as any).installerSessions = [];
  }
  if (!Array.isArray((db as any).installerCurrentLocations)) {
    (db as any).installerCurrentLocations = [];
  }
  if (!Array.isArray((db as any).installerLocationHistory)) {
    (db as any).installerLocationHistory = [];
  }
  return {
    sessions: (db as any).installerSessions as InstallerSessionRecord[],
    currentLocations: (db as any).installerCurrentLocations as InstallerCurrentLocationRecord[],
    history: (db as any).installerLocationHistory as InstallerLocationHistoryEntry[]
  };
}

export async function getEffectiveGpsTrackingConfig(): Promise<GpsTrackingConfig> {
  try {
    if (isSupabaseMode()) {
      const client = getSupabaseBackendClient();
      if (client) {
        const { data } = await client
          .from('app_settings')
          .select('value')
          .eq('key', 'gps_tracking_config')
          .maybeSingle();
        if (data?.value) {
          return normalizeGpsTrackingConfig(data.value);
        }
      }
    }
    const localVal = db.appSettings?.gps_tracking_config;
    if (localVal) {
      return normalizeGpsTrackingConfig(localVal);
    }
  } catch {
    // Fallback to clean defaults
  }
  return { ...DEFAULT_GPS_TRACKING_CONFIG };
}

function mapRowToInstallerSession(row: any): InstallerSessionRecord {
  return {
    id: String(row.id),
    installerId: String(row.installer_id ?? row.installerId),
    sessionId: String(row.session_id ?? row.sessionId),
    deviceId: row.device_id ?? row.deviceId ?? undefined,
    userAgent: row.user_agent ?? row.userAgent ?? undefined,
    loginAt: String(row.login_at ?? row.loginAt),
    lastHeartbeatAt: String(row.last_heartbeat_at ?? row.lastHeartbeatAt),
    lastLocationAt: row.last_location_at ?? row.lastLocationAt ?? null,
    logoutAt: row.logout_at ?? row.logoutAt ?? null,
    onlineStatus: (row.online_status ?? row.onlineStatus ?? 'Offline') as InstallerOnlineStatus,
    locationStatus: (row.location_status ?? row.locationStatus ?? 'Waiting for GPS') as InstallerLocationStatus,
    sessionStatus: (row.session_status ?? row.sessionStatus ?? 'active') as InstallerSessionLifecycleStatus,
    createdAt: row.created_at ?? row.createdAt,
    updatedAt: row.updated_at ?? row.updatedAt
  };
}

function mapRowToCurrentLocation(row: any): InstallerCurrentLocationRecord {
  return {
    id: String(row.id),
    installerId: String(row.installer_id ?? row.installerId),
    sessionId: String(row.session_id ?? row.sessionId),
    latitude: typeof row.latitude === 'number' ? row.latitude : null,
    longitude: typeof row.longitude === 'number' ? row.longitude : null,
    accuracy: typeof row.accuracy === 'number' ? row.accuracy : null,
    speed: typeof row.speed === 'number' ? row.speed : null,
    heading: typeof row.heading === 'number' ? row.heading : null,
    recordedAt: String(row.recorded_at ?? row.recordedAt),
    locationStatus: (row.location_status ?? row.locationStatus ?? 'Location Fresh') as InstallerLocationStatus,
    isActive: row.is_active !== undefined ? Boolean(row.is_active) : Boolean(row.isActive),
    updatedAt: String(row.updated_at ?? row.updatedAt ?? row.recorded_at ?? row.recordedAt)
  };
}

function mapRowToHistoryEntry(row: any): InstallerLocationHistoryEntry {
  return {
    id: String(row.id),
    installerId: String(row.installer_id ?? row.installerId),
    sessionId: String(row.session_id ?? row.sessionId),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: typeof row.accuracy === 'number' ? row.accuracy : null,
    speed: typeof row.speed === 'number' ? row.speed : null,
    heading: typeof row.heading === 'number' ? row.heading : null,
    recordedAt: String(row.recorded_at ?? row.recordedAt),
    createdAt: row.created_at ?? row.createdAt
  };
}

/**
 * Strictly decouples Online/Offline (session + heartbeat) from GPS Location Status
 * (Location Fresh / Location Stale / GPS Disabled / Permission Denied / No Signal / Waiting for GPS).
 */
export function computeEffectiveTrackingStatuses(
  session: InstallerSessionRecord | null | undefined,
  currentLoc: InstallerCurrentLocationRecord | null | undefined,
  config: GpsTrackingConfig,
  nowMs: number = Date.now()
): {
  onlineStatus: InstallerOnlineStatus;
  locationStatus: InstallerLocationStatus;
  secondsSinceHeartbeat: number | null;
  secondsSinceLocation: number | null;
} {
  const heartbeatMs = session?.lastHeartbeatAt ? new Date(session.lastHeartbeatAt).getTime() : NaN;
  const secondsSinceHeartbeat = Number.isFinite(heartbeatMs)
    ? Math.max(0, Math.round((nowMs - heartbeatMs) / 1000))
    : null;

  const isSessionActive = Boolean(session && session.sessionStatus === 'active' && !session.logoutAt);
  const onlineStatus: InstallerOnlineStatus =
    isSessionActive &&
    secondsSinceHeartbeat !== null &&
    secondsSinceHeartbeat <= config.heartbeatTimeoutSeconds
      ? 'Online'
      : 'Offline';

  const locTimeIso = currentLoc?.recordedAt || session?.lastLocationAt || null;
  const locTimeMs = locTimeIso ? new Date(locTimeMsSafe(locTimeIso)).getTime() : NaN;
  const secondsSinceLocation = Number.isFinite(locTimeMs)
    ? Math.max(0, Math.round((nowMs - locTimeMs) / 1000))
    : null;

  const hasValidCoords = Boolean(
    currentLoc && isValidLiveGpsCoordinate(currentLoc.latitude, currentLoc.longitude)
  );
  const rawLocStatus = session?.locationStatus || currentLoc?.locationStatus || 'Waiting for GPS';

  let locationStatus: InstallerLocationStatus;

  if (rawLocStatus === 'Permission Denied' || rawLocStatus === 'GPS Disabled') {
    // Explicit device state takes precedence even when user is Online
    locationStatus = rawLocStatus;
  } else if (!hasValidCoords) {
    if (
      rawLocStatus === 'Location Fresh' &&
      (onlineStatus === 'Offline' ||
        (secondsSinceLocation !== null && secondsSinceLocation > config.locationStaleThresholdSeconds))
    ) {
      locationStatus = 'Location Stale';
    } else if (rawLocStatus === 'Location Fresh') {
      locationStatus = 'Waiting for GPS';
    } else {
      locationStatus = VALID_LOCATION_STATUSES.has(rawLocStatus) ? rawLocStatus : 'Waiting for GPS';
    }
  } else if (
    secondsSinceLocation !== null &&
    secondsSinceLocation > config.locationStaleThresholdSeconds
  ) {
    locationStatus = 'Location Stale';
  } else if (onlineStatus === 'Offline' || session?.sessionStatus !== 'active') {
    // Historical last coordinates must never masquerade as live fresh tracking after logout/offline
    locationStatus = 'Location Stale';
  } else if (rawLocStatus === 'No Signal') {
    locationStatus = 'No Signal';
  } else {
    locationStatus = 'Location Fresh';
  }

  return {
    onlineStatus,
    locationStatus,
    secondsSinceHeartbeat,
    secondsSinceLocation
  };
}

function locTimeMsSafe(iso: string): string {
  return iso;
}

export function buildInstallerLiveLocationView(
  installer: any,
  session: InstallerSessionRecord | null | undefined,
  currentLoc: InstallerCurrentLocationRecord | null | undefined,
  config: GpsTrackingConfig,
  nowMs: number = Date.now()
): InstallerLiveLocationView | null {
  if (!installer || !session) return null;

  const statusInfo = computeEffectiveTrackingStatuses(session, currentLoc, config, nowMs);
  const hasValidCoords = Boolean(
    currentLoc && isValidLiveGpsCoordinate(currentLoc.latitude, currentLoc.longitude)
  );

  return {
    installerId: String(installer.id),
    installerName: String(installer.name || installer.username || 'Installer'),
    username: String(installer.username || ''),
    phone: installer.phone || undefined,
    contractor: installer.contractor || undefined,
    contractorId: installer.contractorId || installer.contractor_id || undefined,
    area: installer.area || undefined,
    sessionId: session.sessionId,
    sessionStatus: session.sessionStatus,
    loginAt: session.loginAt,
    lastHeartbeatAt: session.lastHeartbeatAt,
    lastLocationAt: currentLoc?.recordedAt || session.lastLocationAt || null,
    logoutAt: session.logoutAt || null,
    onlineStatus: statusInfo.onlineStatus,
    locationStatus: statusInfo.locationStatus,
    latitude: hasValidCoords ? currentLoc!.latitude : null,
    longitude: hasValidCoords ? currentLoc!.longitude : null,
    accuracy: hasValidCoords ? (currentLoc!.accuracy ?? null) : null,
    speed: hasValidCoords ? (currentLoc!.speed ?? null) : null,
    heading: hasValidCoords ? (currentLoc!.heading ?? null) : null,
    recordedAt: currentLoc?.recordedAt || null,
    hasValidCoordinates: hasValidCoords,
    isActiveLocation: Boolean(
      hasValidCoords &&
      session.sessionStatus === 'active' &&
      statusInfo.onlineStatus === 'Online' &&
      currentLoc?.isActive !== false
    ),
    secondsSinceHeartbeat: statusInfo.secondsSinceHeartbeat,
    secondsSinceLocation: statusInfo.secondsSinceLocation
  };
}

export function checkInstallerTrackingReadAccess(
  record: { installerId?: string; contractor?: string; contractorId?: string; area?: string },
  viewer: { id: string; role: string; contractor?: string; contractorId?: string; area?: string }
): boolean {
  if (!viewer || !record) return false;
  if (viewer.role === 'super_admin' || viewer.role === 'dispatch') {
    return true;
  }
  if (viewer.role === 'installer') {
    return Boolean(record.installerId && record.installerId === viewer.id);
  }
  if (viewer.role === 'leader') {
    const contrMatch =
      (viewer.contractorId && record.contractorId && viewer.contractorId === record.contractorId) ||
      (viewer.contractor && record.contractor && isContractorMatch(viewer.contractor, record.contractor));
    if (!contrMatch) return false;
    if (viewer.area && viewer.area.trim() !== '') {
      if (!record.area || record.area.trim() === '') return false;
      return isAreaMatch(record.area, viewer.area);
    }
    return true;
  }
  return false;
}

async function resolveTrackingViewForInstaller(
  installerId: string,
  preferredSessionId?: string
): Promise<InstallerLiveLocationView | null> {
  const config = await getEffectiveGpsTrackingConfig();
  let installerUser: any = null;
  let session: InstallerSessionRecord | null = null;
  let currentLoc: InstallerCurrentLocationRecord | null = null;

  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const [{ data: uRow }, { data: sRows }, { data: cRow }] = await Promise.all([
        client.from('users').select('*').eq('id', installerId).maybeSingle(),
        client
          .from('installer_sessions')
          .select('*')
          .eq('installer_id', installerId)
          .order('login_at', { ascending: false })
          .limit(5),
        client
          .from('installer_current_locations')
          .select('*')
          .eq('installer_id', installerId)
          .maybeSingle()
      ]);
      if (uRow) {
        const p = uRow.payload && typeof uRow.payload === 'object' ? uRow.payload : {};
        installerUser = {
          id: uRow.id,
          name: uRow.name || p.name,
          username: uRow.username || p.username,
          phone: uRow.phone || p.phone,
          contractor: uRow.contractor || p.contractor,
          contractorId: uRow.contractor_id || p.contractorId,
          area: uRow.area || p.area
        };
      }
      if (Array.isArray(sRows) && sRows.length > 0) {
        const picked =
          (preferredSessionId ? sRows.find(r => r.session_id === preferredSessionId) : null) ||
          sRows.find(r => r.session_status === 'active') ||
          sRows[0];
        if (picked) session = mapRowToInstallerSession(picked);
      }
      if (cRow) {
        currentLoc = mapRowToCurrentLocation(cRow);
      }
    }
  }

  if (!installerUser && isLocalJsonModeAllowed()) {
    installerUser = db.users.find(u => u.id === installerId) || null;
  }
  if (!session && isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    const candidates = stores.sessions
      .filter(s => s.installerId === installerId)
      .sort((a, b) => new Date(b.loginAt).getTime() - new Date(a.loginAt).getTime());
    session =
      (preferredSessionId ? candidates.find(s => s.sessionId === preferredSessionId) : null) ||
      candidates.find(s => s.sessionStatus === 'active') ||
      candidates[0] ||
      null;
    currentLoc = stores.currentLocations.find(c => c.installerId === installerId) || null;
  }

  if (!installerUser || !session) return null;
  return buildInstallerLiveLocationView(installerUser, session, currentLoc, config);
}

/**
 * Called automatically when an Installer logs in successfully.
 * Supersedes previous active sessions for this Installer (multi-device isolation)
 * so only the active login session's coordinates are tracked without device mixing.
 */
export async function createInstallerTrackingSession(params: {
  installer: {
    id: string;
    name: string;
    username: string;
    phone?: string;
    contractor?: string;
    contractorId?: string;
    area?: string;
  };
  sessionId: string;
  deviceId?: string;
  userAgent?: string;
}): Promise<InstallerSessionRecord | null> {
  if (!isSupabaseMode() && !isLocalJsonModeAllowed()) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const recordId = `inst_sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const newSession: InstallerSessionRecord = {
    id: recordId,
    installerId: params.installer.id,
    sessionId: params.sessionId,
    deviceId: params.deviceId,
    userAgent: params.userAgent,
    loginAt: nowIso,
    lastHeartbeatAt: nowIso,
    lastLocationAt: null,
    logoutAt: null,
    onlineStatus: 'Online',
    locationStatus: 'Waiting for GPS',
    sessionStatus: 'active',
    createdAt: nowIso,
    updatedAt: nowIso
  };

  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        // Supersede older active sessions for same installer so multi-device never mixes coords
        await client
          .from('installer_sessions')
          .update({
            session_status: 'superseded',
            online_status: 'Offline',
            logout_at: nowIso,
            updated_at: nowIso
          })
          .eq('installer_id', params.installer.id)
          .eq('session_status', 'active');

        await client.from('installer_sessions').insert([
          {
            id: newSession.id,
            installer_id: newSession.installerId,
            session_id: newSession.sessionId,
            device_id: newSession.deviceId || null,
            user_agent: newSession.userAgent || null,
            login_at: newSession.loginAt,
            last_heartbeat_at: newSession.lastHeartbeatAt,
            last_location_at: null,
            logout_at: null,
            online_status: 'Online',
            location_status: 'Waiting for GPS',
            session_status: 'active',
            created_at: nowIso,
            updated_at: nowIso
          }
        ]);

        // Keep historical last coordinates inactive until fresh GPS coordinates from this session arrive
        await client
          .from('installer_current_locations')
          .update({
            is_active: false,
            location_status: 'Location Stale',
            updated_at: nowIso
          })
          .eq('installer_id', params.installer.id);
      } catch (err: any) {
        console.warn('[InstallerGPS] Supabase createInstallerTrackingSession warning:', err?.message || err);
      }
    }
  }

  if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    stores.sessions.forEach(s => {
      if (s.installerId === params.installer.id && s.sessionStatus === 'active') {
        s.sessionStatus = 'superseded';
        s.onlineStatus = 'Offline';
        s.logoutAt = nowIso;
        s.updatedAt = nowIso;
      }
    });
    stores.sessions.unshift(newSession);
    if (stores.sessions.length > 1000) {
      stores.sessions.length = 1000;
    }
    const existingLoc = stores.currentLocations.find(c => c.installerId === params.installer.id);
    if (existingLoc) {
      existingLoc.isActive = false;
      existingLoc.locationStatus = 'Location Stale';
      existingLoc.updatedAt = nowIso;
    }
    saveDatabaseToDisk();
  }

  const view = await resolveTrackingViewForInstaller(params.installer.id, params.sessionId);
  if (view) {
    broadcastSupabaseChange('installer_tracking', 'UPSERT', view);
  }

  return newSession;
}

/**
 * Ends Installer GPS tracking session upon logout or session revocation.
 * Historical last coordinates are preserved with is_active = false and never served as live.
 */
export async function endInstallerTrackingSession(params: {
  installerId?: string;
  sessionId?: string;
  reason?: 'ended' | 'expired' | 'superseded';
}): Promise<boolean> {
  const { installerId, sessionId, reason = 'ended' } = params;
  if (!installerId && !sessionId) return false;
  if (!isSupabaseMode() && !isLocalJsonModeAllowed()) return false;

  const nowIso = new Date().toISOString();
  let resolvedInstallerId = installerId;

  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      try {
        let query = client
          .from('installer_sessions')
          .update({
            session_status: reason,
            online_status: 'Offline',
            logout_at: nowIso,
            updated_at: nowIso
          })
          .eq('session_status', 'active');

        if (sessionId) {
          query = query.eq('session_id', sessionId);
        } else if (installerId) {
          query = query.eq('installer_id', installerId);
        }

        const { data } = await query.select('installer_id');
        if (!resolvedInstallerId && Array.isArray(data) && data[0]?.installer_id) {
          resolvedInstallerId = data[0].installer_id;
        }

        if (resolvedInstallerId) {
          await client
            .from('installer_current_locations')
            .update({
              is_active: false,
              location_status: 'Location Stale',
              updated_at: nowIso
            })
            .eq('installer_id', resolvedInstallerId);
        }
      } catch (err: any) {
        console.warn('[InstallerGPS] Supabase endInstallerTrackingSession warning:', err?.message || err);
      }
    }
  }

  if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    stores.sessions.forEach(s => {
      const matchSession = sessionId ? s.sessionId === sessionId : false;
      const matchInstaller = installerId ? s.installerId === installerId : false;
      if ((matchSession || (!sessionId && matchInstaller)) && s.sessionStatus === 'active') {
        s.sessionStatus = reason;
        s.onlineStatus = 'Offline';
        s.logoutAt = nowIso;
        s.updatedAt = nowIso;
        if (!resolvedInstallerId) resolvedInstallerId = s.installerId;
      }
    });
    if (resolvedInstallerId) {
      const existingLoc = stores.currentLocations.find(c => c.installerId === resolvedInstallerId);
      if (existingLoc) {
        existingLoc.isActive = false;
        existingLoc.locationStatus = 'Location Stale';
        existingLoc.updatedAt = nowIso;
      }
    }
    saveDatabaseToDisk();
  }

  if (resolvedInstallerId) {
    const view = await resolveTrackingViewForInstaller(resolvedInstallerId, sessionId);
    if (view) {
      broadcastSupabaseChange('installer_tracking', 'UPSERT', view);
    }
  }

  return true;
}

async function loadAuthoritativeInstallerSession(
  sessionId: string
): Promise<InstallerSessionRecord | null> {
  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { data, error } = await client
        .from('installer_sessions')
        .select('*')
        .eq('session_id', sessionId)
        .maybeSingle();
      if (!error && data) {
        return mapRowToInstallerSession(data);
      }
    }
  }
  if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    return stores.sessions.find(s => s.sessionId === sessionId) || null;
  }
  return null;
}

function validateSessionOwnershipAndActive(
  session: InstallerSessionRecord | null,
  installerId: string
): { valid: true; session: InstallerSessionRecord } | { valid: false; status: number; code: string; message: string } {
  if (!session) {
    return {
      valid: false,
      status: 404,
      code: 'TRACKING_SESSION_NOT_FOUND',
      message: 'Sesi tracking Installer tidak ditemukan atau telah berakhir.'
    };
  }
  if (session.installerId !== installerId) {
    return {
      valid: false,
      status: 403,
      code: 'SESSION_OWNER_MISMATCH',
      message: 'Akses Ditolak: Session ID bukan milik akun Installer yang sedang terautentikasi.'
    };
  }
  if (session.sessionStatus !== 'active') {
    return {
      valid: false,
      status: 409,
      code: `SESSION_${session.sessionStatus.toUpperCase()}`,
      message: `Sesi tracking sudah tidak aktif (${session.sessionStatus}). Pembaruan lokasi ditolak.`
    };
  }
  return { valid: true, session };
}

export async function recordInstallerLocationStatusUpdate(params: {
  installer: { id: string; role: string; name?: string };
  sessionId: string;
  locationStatus: InstallerLocationStatus;
}): Promise<{
  success: boolean;
  status?: number;
  code?: string;
  message?: string;
  view?: InstallerLiveLocationView | null;
}> {
  if (!VALID_LOCATION_STATUSES.has(params.locationStatus)) {
    return {
      success: false,
      status: 400,
      code: 'INVALID_LOCATION_STATUS',
      message: 'Status lokasi GPS tidak valid.'
    };
  }

  const existing = await loadAuthoritativeInstallerSession(params.sessionId);
  const check = validateSessionOwnershipAndActive(existing, params.installer.id);
  if (check.valid === false) {
    return { success: false, status: check.status, code: check.code, message: check.message };
  }

  const nowIso = new Date().toISOString();

  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      await client
        .from('installer_sessions')
        .update({
          last_heartbeat_at: nowIso,
          online_status: 'Online',
          location_status: params.locationStatus,
          updated_at: nowIso
        })
        .eq('session_id', params.sessionId)
        .eq('installer_id', params.installer.id);

      if (EXPLICIT_FAULT_LOCATION_STATUSES.has(params.locationStatus)) {
        await client
          .from('installer_current_locations')
          .update({
            location_status: params.locationStatus,
            is_active: false,
            updated_at: nowIso
          })
          .eq('installer_id', params.installer.id);
      }
    }
  }

  if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    const s = stores.sessions.find(
      row => row.sessionId === params.sessionId && row.installerId === params.installer.id
    );
    if (s) {
      s.lastHeartbeatAt = nowIso;
      s.onlineStatus = 'Online';
      s.locationStatus = params.locationStatus;
      s.updatedAt = nowIso;
    }
    if (EXPLICIT_FAULT_LOCATION_STATUSES.has(params.locationStatus)) {
      const c = stores.currentLocations.find(row => row.installerId === params.installer.id);
      if (c) {
        c.locationStatus = params.locationStatus;
        c.isActive = false;
        c.updatedAt = nowIso;
      }
    }
    saveDatabaseToDisk();
  }

  const view = await resolveTrackingViewForInstaller(params.installer.id, params.sessionId);
  if (view) {
    broadcastSupabaseChange('installer_tracking', 'UPSERT', view);
  }
  return { success: true, view };
}

export async function recordInstallerHeartbeat(params: {
  installer: { id: string; role: string };
  sessionId: string;
  locationStatusHint?: InstallerLocationStatus;
}): Promise<{
  success: boolean;
  status?: number;
  code?: string;
  message?: string;
  view?: InstallerLiveLocationView | null;
}> {
  const existing = await loadAuthoritativeInstallerSession(params.sessionId);
  const check = validateSessionOwnershipAndActive(existing, params.installer.id);
  if (check.valid === false) {
    return { success: false, status: check.status, code: check.code, message: check.message };
  }

  const config = await getEffectiveGpsTrackingConfig();
  const nowIso = new Date().toISOString();
  let currentLoc: InstallerCurrentLocationRecord | null = null;

  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { data } = await client
        .from('installer_current_locations')
        .select('*')
        .eq('installer_id', params.installer.id)
        .maybeSingle();
      if (data) currentLoc = mapRowToCurrentLocation(data);
    }
  } else if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    currentLoc = stores.currentLocations.find(c => c.installerId === params.installer.id) || null;
  }

  const nextSession: InstallerSessionRecord = {
    ...check.session,
    lastHeartbeatAt: nowIso,
    onlineStatus: 'Online',
    locationStatus:
      params.locationStatusHint && VALID_LOCATION_STATUSES.has(params.locationStatusHint)
        ? params.locationStatusHint
        : check.session.locationStatus
  };

  const evaluated = computeEffectiveTrackingStatuses(nextSession, currentLoc, config, Date.now());

  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      await client
        .from('installer_sessions')
        .update({
          last_heartbeat_at: nowIso,
          online_status: 'Online',
          location_status: evaluated.locationStatus,
          updated_at: nowIso
        })
        .eq('session_id', params.sessionId)
        .eq('installer_id', params.installer.id);
    }
  }

  if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    const s = stores.sessions.find(
      row => row.sessionId === params.sessionId && row.installerId === params.installer.id
    );
    if (s) {
      s.lastHeartbeatAt = nowIso;
      s.onlineStatus = 'Online';
      s.locationStatus = evaluated.locationStatus;
      s.updatedAt = nowIso;
      saveDatabaseToDisk();
    }
  }

  const view = await resolveTrackingViewForInstaller(params.installer.id, params.sessionId);
  if (view) {
    broadcastSupabaseChange('installer_tracking', 'UPSERT', view);
  }
  return { success: true, view };
}

export interface LiveLocationPointInput {
  sessionId: string;
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  timestamp?: string | number;
}

export async function recordInstallerLocationUpdate(params: {
  installer: { id: string; role: string };
  point: LiveLocationPointInput;
  suppressBroadcast?: boolean;
}): Promise<{
  success: boolean;
  deduplicated?: boolean;
  status?: number;
  code?: string;
  message?: string;
  view?: InstallerLiveLocationView | null;
}> {
  const { installer, point, suppressBroadcast } = params;

  if (!isValidLiveGpsCoordinate(point.latitude, point.longitude)) {
    return {
      success: false,
      status: 400,
      code: 'INVALID_GPS_COORDINATES',
      message: 'Koordinat GPS tidak valid (di luar rentang atau Null Island 0,0 ditolak).'
    };
  }

  const config = await getEffectiveGpsTrackingConfig();
  if (!config.enabled) {
    return {
      success: false,
      status: 403,
      code: 'GPS_TRACKING_DISABLED',
      message: 'Fitur Live GPS Tracking sedang dinonaktifkan oleh Superadmin.'
    };
  }

  const existingSession = await loadAuthoritativeInstallerSession(point.sessionId);
  const check = validateSessionOwnershipAndActive(existingSession, installer.id);
  if (check.valid === false) {
    return { success: false, status: check.status, code: check.code, message: check.message };
  }

  const lat = Number(point.latitude.toFixed(7));
  const lng = Number(point.longitude.toFixed(7));
  const acc =
    typeof point.accuracy === 'number' && Number.isFinite(point.accuracy) && point.accuracy >= 0
      ? Math.round(point.accuracy)
      : null;
  const speed =
    typeof point.speed === 'number' && Number.isFinite(point.speed) && point.speed >= 0
      ? Number(point.speed.toFixed(2))
      : null;
  const heading =
    typeof point.heading === 'number' && Number.isFinite(point.heading) && point.heading >= 0
      ? Number(point.heading.toFixed(1))
      : null;

  const recordedDate = point.timestamp ? new Date(point.timestamp) : new Date();
  const recordedIso = Number.isNaN(recordedDate.getTime())
    ? new Date().toISOString()
    : recordedDate.toISOString();
  const nowIso = new Date().toISOString();

  // Check current location for deduplication & distance delta for history insertion
  let prevCurrent: InstallerCurrentLocationRecord | null = null;
  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { data } = await client
        .from('installer_current_locations')
        .select('*')
        .eq('installer_id', installer.id)
        .maybeSingle();
      if (data) prevCurrent = mapRowToCurrentLocation(data);
    }
  } else if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    prevCurrent = stores.currentLocations.find(c => c.installerId === installer.id) || null;
  }

  // Exact replay deduplication check (same coords + same timestamp + active)
  if (
    prevCurrent &&
    prevCurrent.isActive &&
    prevCurrent.sessionId === point.sessionId &&
    prevCurrent.latitude !== null &&
    prevCurrent.longitude !== null &&
    Math.abs(prevCurrent.latitude - lat) < 0.000001 &&
    Math.abs(prevCurrent.longitude - lng) < 0.000001 &&
    prevCurrent.recordedAt === recordedIso
  ) {
    // Still refresh heartbeat cleanly
    const view = await resolveTrackingViewForInstaller(installer.id, point.sessionId);
    return { success: true, deduplicated: true, view };
  }

  const movedMeters =
    prevCurrent && prevCurrent.latitude !== null && prevCurrent.longitude !== null
      ? calculateHaversineMeters(prevCurrent.latitude, prevCurrent.longitude, lat, lng)
      : Infinity;
  const shouldInsertHistory =
    !prevCurrent ||
    !prevCurrent.isActive ||
    prevCurrent.sessionId !== point.sessionId ||
    movedMeters >= Math.max(1, config.minDistanceMeters);

  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { error: rpcErr } = await client.rpc('upsert_installer_live_location', {
        p_installer_id: installer.id,
        p_session_id: point.sessionId,
        p_latitude: lat,
        p_longitude: lng,
        p_accuracy: acc,
        p_speed: speed,
        p_heading: heading,
        p_recorded_at: recordedIso,
        p_record_history: shouldInsertHistory
      });

      if (rpcErr) {
        // Fallback explicit atomic sequence if RPC isn't migrated yet
        await client
          .from('installer_sessions')
          .update({
            last_heartbeat_at: nowIso,
            last_location_at: recordedIso,
            online_status: 'Online',
            location_status: 'Location Fresh',
            updated_at: nowIso
          })
          .eq('session_id', point.sessionId)
          .eq('installer_id', installer.id);

        await client.from('installer_current_locations').upsert(
          [
            {
              id: `icl_${installer.id}`,
              installer_id: installer.id,
              session_id: point.sessionId,
              latitude: lat,
              longitude: lng,
              accuracy: acc,
              speed,
              heading,
              recorded_at: recordedIso,
              location_status: 'Location Fresh',
              is_active: true,
              updated_at: nowIso
            }
          ],
          { onConflict: 'installer_id' }
        );

        if (shouldInsertHistory) {
          await client.from('installer_location_history').insert([
            {
              id: `ilh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
              installer_id: installer.id,
              session_id: point.sessionId,
              latitude: lat,
              longitude: lng,
              accuracy: acc,
              speed,
              heading,
              recorded_at: recordedIso,
              created_at: nowIso
            }
          ]);
        }
      }

      // Opportunistic retention cleanup
      Promise.resolve(
        client.rpc('cleanup_expired_installer_location_history', {
          p_retention_days: config.historyRetentionDays
        })
      ).catch(() => {});
    }
  }

  if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    const s = stores.sessions.find(
      row => row.sessionId === point.sessionId && row.installerId === installer.id
    );
    if (s) {
      s.lastHeartbeatAt = nowIso;
      if (!s.lastLocationAt || new Date(recordedIso).getTime() >= new Date(s.lastLocationAt).getTime()) {
        s.lastLocationAt = recordedIso;
      }
      s.onlineStatus = 'Online';
      s.locationStatus = 'Location Fresh';
      s.updatedAt = nowIso;
    }

    const existingCurrentIdx = stores.currentLocations.findIndex(
      c => c.installerId === installer.id
    );
    const shouldReplaceCurrent =
      existingCurrentIdx < 0 ||
      !stores.currentLocations[existingCurrentIdx].isActive ||
      new Date(recordedIso).getTime() >=
        new Date(stores.currentLocations[existingCurrentIdx].recordedAt).getTime();

    if (shouldReplaceCurrent) {
      const nextCurrent: InstallerCurrentLocationRecord = {
        id: `icl_${installer.id}`,
        installerId: installer.id,
        sessionId: point.sessionId,
        latitude: lat,
        longitude: lng,
        accuracy: acc,
        speed,
        heading,
        recordedAt: recordedIso,
        locationStatus: 'Location Fresh',
        isActive: true,
        updatedAt: nowIso
      };
      if (existingCurrentIdx >= 0) {
        stores.currentLocations[existingCurrentIdx] = nextCurrent;
      } else {
        stores.currentLocations.push(nextCurrent);
      }
    }

    if (shouldInsertHistory) {
      stores.history.unshift({
        id: `ilh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        installerId: installer.id,
        sessionId: point.sessionId,
        latitude: lat,
        longitude: lng,
        accuracy: acc,
        speed,
        heading,
        recordedAt: recordedIso,
        createdAt: nowIso
      });
      const cutoffMs = Date.now() - config.historyRetentionDays * 24 * 60 * 60 * 1000;
      (db as any).installerLocationHistory = stores.history
        .filter(h => new Date(h.recordedAt).getTime() >= cutoffMs)
        .slice(0, 5000);
    }

    saveDatabaseToDisk();
  }

  const view = await resolveTrackingViewForInstaller(installer.id, point.sessionId);
  if (view && !suppressBroadcast) {
    broadcastSupabaseChange('installer_tracking', 'UPSERT', view);
  }

  return { success: true, deduplicated: false, view };
}

export async function recordInstallerLocationBatch(params: {
  installer: { id: string; role: string };
  sessionId: string;
  points: Array<Omit<LiveLocationPointInput, 'sessionId'> & { sessionId?: string }>;
}): Promise<{
  success: boolean;
  status?: number;
  code?: string;
  message?: string;
  syncedCount: number;
  skippedCount: number;
  view?: InstallerLiveLocationView | null;
}> {
  const sortedPoints = [...(params.points || [])].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  if (sortedPoints.length === 0) {
    return { success: true, syncedCount: 0, skippedCount: 0, view: null };
  }

  // Validate active session ownership before processing batch
  const existingSession = await loadAuthoritativeInstallerSession(params.sessionId);
  const check = validateSessionOwnershipAndActive(existingSession, params.installer.id);
  if (check.valid === false) {
    return {
      success: false,
      status: check.status,
      code: check.code,
      message: check.message,
      syncedCount: 0,
      skippedCount: sortedPoints.length
    };
  }

  let syncedCount = 0;
  let skippedCount = 0;
  let lastView: InstallerLiveLocationView | null = null;

  for (let i = 0; i < sortedPoints.length; i++) {
    const pt = sortedPoints[i];
    const isLast = i === sortedPoints.length - 1;
    const res = await recordInstallerLocationUpdate({
      installer: params.installer,
      point: {
        sessionId: params.sessionId,
        latitude: pt.latitude,
        longitude: pt.longitude,
        accuracy: pt.accuracy,
        speed: pt.speed,
        heading: pt.heading,
        timestamp: pt.timestamp
      },
      suppressBroadcast: !isLast
    });
    if (res.success) {
      syncedCount++;
      if (res.view) lastView = res.view;
    } else {
      skippedCount++;
    }
  }

  return {
    success: true,
    syncedCount,
    skippedCount,
    view: lastView || (await resolveTrackingViewForInstaller(params.installer.id, params.sessionId))
  };
}

export async function getScopedInstallerLiveLocations(
  viewer: { id: string; role: string; contractor?: string; contractorId?: string; area?: string },
  nowMs: number = Date.now()
): Promise<{
  success: boolean;
  status?: number;
  code?: string;
  message?: string;
  config: GpsTrackingConfig;
  installers: InstallerLiveLocationView[];
}> {
  const config = await getEffectiveGpsTrackingConfig();

  if (!isSupabaseMode() && !isLocalJsonModeAllowed()) {
    return {
      success: false,
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database authoritative Supabase tidak tersedia.',
      config,
      installers: []
    };
  }

  let allUsers: any[] = [];
  let sessions: InstallerSessionRecord[] = [];
  let currentLocations: InstallerCurrentLocationRecord[] = [];

  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const [usersRes, sessRes, locRes] = await Promise.all([
        getUsersFromSupabase(),
        client
          .from('installer_sessions')
          .select('*')
          .order('login_at', { ascending: false })
          .limit(500),
        client.from('installer_current_locations').select('*').limit(500)
      ]);
      if (usersRes.success && Array.isArray(usersRes.data)) {
        allUsers = usersRes.data;
      }
      if (Array.isArray(sessRes.data)) {
        sessions = sessRes.data.map(mapRowToInstallerSession);
      }
      if (Array.isArray(locRes.data)) {
        currentLocations = locRes.data.map(mapRowToCurrentLocation);
      }
    }
  } else if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    allUsers = db.users || [];
    sessions = stores.sessions;
    currentLocations = stores.currentLocations;
  }

  const installersById = new Map<string, any>();
  for (const u of allUsers) {
    if (u && u.role === 'installer' && !u.isDeleted && u.active !== false) {
      installersById.set(String(u.id), u);
    }
  }

  // Pick most relevant session per installer (active preferred, otherwise most recent)
  const sessionByInstaller = new Map<string, InstallerSessionRecord>();
  for (const s of sessions) {
    const prev = sessionByInstaller.get(s.installerId);
    if (!prev) {
      sessionByInstaller.set(s.installerId, s);
    } else if (prev.sessionStatus !== 'active' && s.sessionStatus === 'active') {
      sessionByInstaller.set(s.installerId, s);
    } else if (
      prev.sessionStatus === s.sessionStatus &&
      new Date(s.loginAt).getTime() > new Date(prev.loginAt).getTime()
    ) {
      sessionByInstaller.set(s.installerId, s);
    }
  }

  const locByInstaller = new Map<string, InstallerCurrentLocationRecord>();
  for (const c of currentLocations) {
    locByInstaller.set(c.installerId, c);
  }

  const result: InstallerLiveLocationView[] = [];
  for (const [installerId, installerUser] of installersById.entries()) {
    const session = sessionByInstaller.get(installerId);
    if (!session) continue; // Only include installers who have an active/recorded tracking session

    const currentLoc = locByInstaller.get(installerId) || null;
    const view = buildInstallerLiveLocationView(installerUser, session, currentLoc, config, nowMs);
    if (!view) continue;

    if (!checkInstallerTrackingReadAccess(view, viewer)) {
      continue;
    }
    result.push(view);
  }

  result.sort((a, b) => {
    if (a.onlineStatus !== b.onlineStatus) {
      return a.onlineStatus === 'Online' ? -1 : 1;
    }
    return new Date(b.lastHeartbeatAt).getTime() - new Date(a.lastHeartbeatAt).getTime();
  });

  return { success: true, config, installers: result };
}

export async function getScopedInstallerLocationHistory(
  viewer: { id: string; role: string; contractor?: string; contractorId?: string; area?: string },
  targetInstallerId: string,
  limit: number = 100
): Promise<{
  success: boolean;
  status?: number;
  code?: string;
  message?: string;
  history: InstallerLocationHistoryEntry[];
}> {
  if (!isSupabaseMode() && !isLocalJsonModeAllowed()) {
    return {
      success: false,
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database authoritative Supabase tidak tersedia.',
      history: []
    };
  }

  let targetInstaller: any = null;
  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { data } = await client.from('users').select('*').eq('id', targetInstallerId).maybeSingle();
      if (data) {
        const p = data.payload && typeof data.payload === 'object' ? data.payload : {};
        targetInstaller = {
          id: data.id,
          role: data.role || p.role,
          contractor: data.contractor || p.contractor,
          contractorId: data.contractor_id || p.contractorId,
          area: data.area || p.area
        };
      }
    }
  } else if (isLocalJsonModeAllowed()) {
    targetInstaller = db.users.find(u => u.id === targetInstallerId) || null;
  }

  if (!targetInstaller || targetInstaller.role !== 'installer') {
    return {
      success: false,
      status: 404,
      code: 'INSTALLER_NOT_FOUND',
      message: 'Akun Installer tidak ditemukan.',
      history: []
    };
  }

  if (
    !checkInstallerTrackingReadAccess(
      {
        installerId: targetInstaller.id,
        contractor: targetInstaller.contractor,
        contractorId: targetInstaller.contractorId,
        area: targetInstaller.area
      },
      viewer
    )
  ) {
    return {
      success: false,
      status: 403,
      code: 'RBAC_FORBIDDEN',
      message: 'Akses Ditolak: Anda tidak memiliki izin melihat riwayat lokasi Installer ini.',
      history: []
    };
  }

  const config = await getEffectiveGpsTrackingConfig();
  const safeLimit = Math.max(1, Math.min(500, limit));
  const cutoffMs = Date.now() - config.historyRetentionDays * 24 * 60 * 60 * 1000;

  let history: InstallerLocationHistoryEntry[] = [];
  if (isSupabaseMode()) {
    const client = getSupabaseBackendClient();
    if (client) {
      const { data } = await client
        .from('installer_location_history')
        .select('*')
        .eq('installer_id', targetInstallerId)
        .gte('recorded_at', new Date(cutoffMs).toISOString())
        .order('recorded_at', { ascending: false })
        .limit(safeLimit);
      if (Array.isArray(data)) {
        history = data.map(mapRowToHistoryEntry);
      }
    }
  } else if (isLocalJsonModeAllowed()) {
    const stores = ensureLocalTrackingStores();
    history = stores.history
      .filter(h => h.installerId === targetInstallerId && new Date(h.recordedAt).getTime() >= cutoffMs)
      .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime())
      .slice(0, safeLimit);
  }

  return { success: true, history };
}
