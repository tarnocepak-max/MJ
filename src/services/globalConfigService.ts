import { authenticatedFetch, setDynamicRolePermissions } from './authService';
import { isAuthExpiredResponse } from '../utils/authSessionHelper';
import { supabaseDb } from './supabaseDb';
import type { UserRole } from '../types';

function createConfigRequestError(status: number, json: any, fallbackMessage: string): Error {
  const rawMsg =
    typeof json?.error === 'string'
      ? json.error
      : json?.error?.message || fallbackMessage;
  const err = new Error(rawMsg);
  (err as any).status = status;
  (err as any).code = json?.code || json?.error?.code;
  (err as any).isAuthError = isAuthExpiredResponse(status, json);
  return err;
}

export interface GlobalConfigConflictDetails {
  key: string;
  expectedVersion: number;
  currentVersion: number;
  currentValue: any;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export class ConfigConflictError extends Error {
  status = 409;
  code = 'VERSION_CONFLICT';
  conflict: GlobalConfigConflictDetails;

  constructor(message: string, conflict: GlobalConfigConflictDetails) {
    super(message);
    this.name = 'ConfigConflictError';
    this.conflict = conflict;
  }
}

export interface GlobalConfigVersionItem {
  id: string;
  config_key: string;
  version: number;
  previous_value: any;
  new_value: any;
  changed_by_id?: string | null;
  changed_by_name?: string | null;
  changed_by_role?: string | null;
  action: string;
  module: string;
  tx_status: string;
  notes?: string | null;
  created_at: string;
}

export interface BootstrapGlobalConfigResult {
  configs: Record<string, any>;
  versions: Record<string, number>;
  metadata: Record<string, { updatedAt: string | null; updatedBy: string | null }>;
  rolePermissions: Record<UserRole, string[]>;
  rolePermissionsVersion: number;
  operationalDate?: { date: string; isAuto: boolean; timezone: string };
}

export interface SaveGlobalConfigOptions {
  expectedVersion?: number | null;
  forceOverwrite?: boolean;
  module?: string;
  description?: string;
  notes?: string;
}

export interface SaveGlobalConfigResult<T = any> {
  success: true;
  key: string;
  value: T;
  version: number;
  updatedAt: string;
  updatedBy: string;
  versionRecordId?: string;
}

const clientVersionRegistry = new Map<string, number>();

export function getTrackedConfigVersion(key: string): number | undefined {
  return clientVersionRegistry.get(key);
}

export function setTrackedConfigVersion(key: string, version: number | undefined | null) {
  if (typeof version === 'number' && Number.isFinite(version) && version >= 0) {
    clientVersionRegistry.set(key, version);
  }
}

export async function bootstrapGlobalConfigs(): Promise<BootstrapGlobalConfigResult> {
  const res = await authenticatedFetch('/api/global-config/bootstrap');
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    throw createConfigRequestError(
      res.status,
      json,
      `Gagal memuat konfigurasi global dari database (HTTP ${res.status}).`
    );
  }

  if (json.versions && typeof json.versions === 'object') {
    for (const [k, v] of Object.entries(json.versions)) {
      if (typeof v === 'number') {
        clientVersionRegistry.set(k, v);
      }
    }
  }
  if (json.rolePermissions && typeof json.rolePermissions === 'object') {
    setDynamicRolePermissions(json.rolePermissions);
  }

  return {
    configs: json.configs || {},
    versions: json.versions || {},
    metadata: json.metadata || {},
    rolePermissions: json.rolePermissions || {},
    rolePermissionsVersion: json.rolePermissionsVersion || 1,
    operationalDate: json.operationalDate
  };
}

export async function getGlobalConfig<T = any>(
  key: string
): Promise<{ key: string; value: T | null; version: number; updatedAt: string | null; updatedBy: string | null }> {
  const res = await authenticatedFetch(`/api/global-config/${encodeURIComponent(key)}`);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    throw createConfigRequestError(
      res.status,
      json,
      `Gagal membaca konfigurasi "${key}" dari database (HTTP ${res.status}).`
    );
  }
  if (typeof json.version === 'number') {
    clientVersionRegistry.set(key, json.version);
  }
  return {
    key: json.key || key,
    value: json.value ?? null,
    version: typeof json.version === 'number' ? json.version : 0,
    updatedAt: json.updatedAt || null,
    updatedBy: json.updatedBy || null
  };
}

export async function saveGlobalConfig<T = any>(
  key: string,
  value: T,
  options: SaveGlobalConfigOptions = {}
): Promise<SaveGlobalConfigResult<T>> {
  const trackedVer = options.expectedVersion !== undefined ? options.expectedVersion : clientVersionRegistry.get(key);
  const res = await authenticatedFetch(`/api/global-config/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({
      value,
      expectedVersion: trackedVer,
      forceOverwrite: Boolean(options.forceOverwrite),
      module: options.module || key,
      description: options.description,
      notes: options.notes
    })
  });

  const json = await res.json().catch(() => null);
  if (res.status === 409) {
    const conflict: GlobalConfigConflictDetails = {
      key,
      expectedVersion: json?.conflict?.expectedVersion ?? (typeof trackedVer === 'number' ? trackedVer : 0),
      currentVersion: json?.conflict?.currentVersion ?? 0,
      currentValue: json?.conflict?.currentValue ?? null,
      updatedBy: json?.conflict?.updatedBy || null,
      updatedAt: json?.conflict?.updatedAt || null
    };
    throw new ConfigConflictError(
      json?.error || `Konflik versi terdeteksi pada "${key}". Silakan pilih muat versi terbaru atau timpa perubahan.`,
      conflict
    );
  }

  if (!res.ok || !json || json.success !== true) {
    throw createConfigRequestError(
      res.status,
      json,
      `Gagal menyimpan konfigurasi "${key}" ke database (HTTP ${res.status}).`
    );
  }

  if (typeof json.version === 'number') {
    clientVersionRegistry.set(key, json.version);
  }

  return {
    success: true,
    key: json.key || key,
    value: json.value,
    version: json.version,
    updatedAt: json.updatedAt,
    updatedBy: json.updatedBy,
    versionRecordId: json.versionRecordId
  };
}

export async function getConfigVersions(key?: string, limit: number = 100): Promise<GlobalConfigVersionItem[]> {
  const url =
    key && key !== 'ALL'
      ? `/api/global-config/${encodeURIComponent(key)}/versions?limit=${limit}`
      : `/api/global-config/versions/all?limit=${limit}`;
  const res = await authenticatedFetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    throw createConfigRequestError(
      res.status,
      json,
      `Gagal memuat riwayat versi konfigurasi (HTTP ${res.status}).`
    );
  }
  return Array.isArray(json.data) ? json.data : [];
}

export async function rollbackGlobalConfig(
  key: string,
  target: { targetVersionId?: string; targetVersion?: number; notes?: string }
): Promise<{
  success: true;
  key: string;
  value: any;
  version: number;
  restoredFromVersion: number;
  updatedAt: string;
  updatedBy: string;
}> {
  const res = await authenticatedFetch(`/api/global-config/${encodeURIComponent(key)}/rollback`, {
    method: 'POST',
    body: JSON.stringify(target)
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    throw createConfigRequestError(
      res.status,
      json,
      `Gagal melakukan rollback "${key}" (HTTP ${res.status}).`
    );
  }
  if (typeof json.version === 'number') {
    clientVersionRegistry.set(key, json.version);
  }
  if (key === 'role_permissions' && json.value) {
    setDynamicRolePermissions(json.value);
  }
  return json;
}

export async function getRolePermissionsFromServer(): Promise<{
  rolePermissions: Record<string, string[]>;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
}> {
  const res = await authenticatedFetch('/api/roles/permissions');
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success !== true) {
    throw createConfigRequestError(
      res.status,
      json,
      `Gagal memuat matriks hak akses role (HTTP ${res.status}).`
    );
  }
  if (typeof json.version === 'number') {
    clientVersionRegistry.set('role_permissions', json.version);
  }
  if (json.rolePermissions) {
    setDynamicRolePermissions(json.rolePermissions);
  }
  return {
    rolePermissions: json.rolePermissions || {},
    version: json.version || 1,
    updatedAt: json.updatedAt || null,
    updatedBy: json.updatedBy || null
  };
}

export async function saveRolePermissionsToServer(
  rolePermissions: Record<string, string[]>,
  options: { expectedVersion?: number | null; forceOverwrite?: boolean; notes?: string } = {}
): Promise<{ rolePermissions: Record<string, string[]>; version: number; updatedAt: string; updatedBy: string }> {
  const trackedVer = options.expectedVersion !== undefined ? options.expectedVersion : clientVersionRegistry.get('role_permissions');
  const res = await authenticatedFetch('/api/roles/permissions', {
    method: 'PUT',
    body: JSON.stringify({
      rolePermissions,
      expectedVersion: trackedVer,
      forceOverwrite: Boolean(options.forceOverwrite),
      notes: options.notes
    })
  });
  const json = await res.json().catch(() => null);
  if (res.status === 409) {
    throw new ConfigConflictError(
      json?.error || 'Konflik versi matriks Role & Permission terdeteksi.',
      {
        key: 'role_permissions',
        expectedVersion: json?.conflict?.expectedVersion ?? (typeof trackedVer === 'number' ? trackedVer : 0),
        currentVersion: json?.conflict?.currentVersion ?? 0,
        currentValue: json?.conflict?.currentValue ?? null,
        updatedBy: json?.conflict?.updatedBy || null,
        updatedAt: json?.conflict?.updatedAt || null
      }
    );
  }
  if (!res.ok || !json || json.success !== true) {
    throw createConfigRequestError(
      res.status,
      json,
      `Gagal menyimpan hak akses role ke database (HTTP ${res.status}).`
    );
  }
  if (typeof json.version === 'number') {
    clientVersionRegistry.set('role_permissions', json.version);
  }
  if (json.rolePermissions) {
    setDynamicRolePermissions(json.rolePermissions);
  }
  return {
    rolePermissions: json.rolePermissions,
    version: json.version,
    updatedAt: json.updatedAt,
    updatedBy: json.updatedBy
  };
}

export interface GlobalConfigChangeEvent {
  key: string;
  value?: any;
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
  action?: string;
}

export function subscribeToGlobalConfigUpdates(
  onChange: (event: GlobalConfigChangeEvent) => void,
  onError?: (err: Error) => void
): () => void {
  return supabaseDb.subscribeToChanges({
    table: 'app_settings',
    event: '*',
    onPayload: (payload) => {
      try {
        const key = payload?.record?.key ?? payload?.key;
        if (!key) return;
        const version = payload?.record?.version;
        if (typeof version === 'number') {
          clientVersionRegistry.set(key, version);
        }
        onChange({
          key,
          value: payload?.record?.value ?? payload?.value,
          version,
          updatedAt: payload?.record?.updatedAt ?? payload?.timestamp,
          updatedBy: payload?.record?.updatedBy,
          action: payload?.record?.action ?? payload?.eventType
        });
      } catch (err: any) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    onError
  });
}
