import { User, UserRole } from '../types/index.ts';

export type Permission =
  | 'login'
  | 'manage_users'
  | 'create_user'
  | 'create_installer'
  | 'update_user'
  | 'toggle_user_status'
  | 'delete_user'
  | 'import_data'
  | 'manage_field_mapping'
  | 'view_all_wo'
  | 'view_contractor_wo'
  | 'view_assigned_wo'
  | 'distribute_wo'
  | 'assign_technician'
  | 'manage_leader_schedule'
  | 'edit_technical_report'
  | 'access_live_chat'
  | 'manage_contractors'
  | 'view_audit_logs'
  | 'edit_wo_data'
  | 'delete_wo_data'
  | 'delete_customer_data'
  | 'database_management'
  | 'permanent_delete'
  | 'system_health'
  | 'application_configuration'
  | 'ui_configuration'
  | 'setting_droplist'
  | 'manage_whatsapp_templates';

/**
 * Central Permission Matrix (4 Roles):
 * - Superadmin holds full system, data management, deletion, audit logs, and configuration authority.
 * - Dispatch, Leader, and Installer retain their operational permissions intact.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    'login',
    'manage_users',
    'create_user',
    'create_installer',
    'update_user',
    'toggle_user_status',
    'delete_user',
    'import_data',
    'manage_field_mapping',
    'view_all_wo',
    'view_contractor_wo',
    'view_assigned_wo',
    'distribute_wo',
    'manage_leader_schedule',
    'edit_technical_report',
    'access_live_chat',
    'manage_contractors',
    'view_audit_logs',
    'database_management',
    'delete_wo_data',
    'delete_customer_data',
    'permanent_delete',
    'edit_wo_data',
    'system_health',
    'application_configuration',
    'ui_configuration',
    'setting_droplist',
    'manage_whatsapp_templates'
  ],
  dispatch: [
    'login',
    'view_all_wo',
    'view_contractor_wo',
    'manage_leader_schedule',
    'edit_technical_report',
    'access_live_chat',
    'edit_wo_data',
    'application_configuration',
    'setting_droplist',
    'manage_whatsapp_templates'
  ],
  leader: [
    'login',
    'view_contractor_wo',
    'access_live_chat',
    'assign_technician',
    'create_installer'
  ],
  installer: [
    'login',
    'view_assigned_wo',
    'edit_technical_report',
    'access_live_chat'
  ]
};

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [...DEFAULT_ROLE_PERMISSIONS.super_admin],
  dispatch: [...DEFAULT_ROLE_PERMISSIONS.dispatch],
  leader: [...DEFAULT_ROLE_PERMISSIONS.leader],
  installer: [...DEFAULT_ROLE_PERMISSIONS.installer]
};

export function setDynamicRolePermissions(matrix: Record<string, string[]>) {
  if (!matrix || typeof matrix !== 'object') return;
  const roles: UserRole[] = ['super_admin', 'dispatch', 'leader', 'installer'];
  for (const r of roles) {
    if (Array.isArray(matrix[r])) {
      ROLE_PERMISSIONS[r] = Array.from(new Set(matrix[r])) as Permission[];
    }
  }
}

export function getRolePermissionsSnapshot(): Record<UserRole, Permission[]> {
  return {
    super_admin: [...ROLE_PERMISSIONS.super_admin],
    dispatch: [...ROLE_PERMISSIONS.dispatch],
    leader: [...ROLE_PERMISSIONS.leader],
    installer: [...ROLE_PERMISSIONS.installer]
  };
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  return Array.isArray(permissions) ? permissions.includes(permission) : false;
}

// SHA-256 password hash generator with salt
export async function hashPassword(password: string, salt: string = 'morajaws_secure_salt_2026'): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(`${salt}:${password}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Synchronous fallback hash for initial setup & fast verification
export function quickHash(password: string, salt: string = 'morajaws_secure_salt_2026'): string {
  let h = 0x811c9dc5;
  const str = `${salt}:${password}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

// Default initial hashed passwords for default seed accounts
export const DEFAULT_PASSWORD_HASH = quickHash('12345678');

export interface AuthSession {
  token: string;
  user: User;
  issuedAt: string;
  expiresAt: string;
}

export function createSession(user: User): AuthSession {
  const now = new Date();
  const expires = new Date(now.getTime() + 8 * 60 * 60 * 1000); // 8 hours
  const token = `mora_${user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  return {
    token,
    user,
    issuedAt: now.toISOString(),
    expiresAt: expires.toISOString()
  };
}

export function getRoleDisplayName(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return 'Superadmin';
    case 'dispatch':
      return 'Dispatch';
    case 'leader':
      return 'Leader';
    case 'installer':
      return 'Installer';
    default:
      return role;
  }
}

/**
 * Returns authenticated HTTP headers including Authorization: Bearer <sessionToken>
 * sourced from official stored session in localStorage.
 * Custom spoofable headers (x-user-id, x-user-role, x-username) are strictly omitted.
 */
export function hasActiveClientSession(): boolean {
  try {
    if (localStorage.getItem('morajaws_logged_in') === 'true') {
      return true;
    }
    const sessionStr = localStorage.getItem('morajaws_auth_session');
    if (sessionStr) {
      const sess = JSON.parse(sessionStr);
      if (sess?.token || sess?.userId) return true;
    }
  } catch {}
  return false;
}

export function getClientSessionIdentityKey(): string {
  try {
    const sessionStr = localStorage.getItem('morajaws_auth_session');
    if (sessionStr) {
      const sess = JSON.parse(sessionStr);
      if (sess?.token) return `Bearer ${sess.token}`;
      if (sess?.sessionId) return `cookie:${sess.sessionId}`;
      if (sess?.userId) return `cookie_user:${sess.userId}`;
    }
    if (localStorage.getItem('morajaws_logged_in') === 'true') {
      return 'cookie:active';
    }
  } catch {}
  return '';
}

function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    credentials: init.credentials || 'include'
  });
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  try {
    const sessionStr = localStorage.getItem('morajaws_auth_session');
    if (sessionStr) {
      const sess = JSON.parse(sessionStr);
      if (sess?.token) {
        headers['Authorization'] = `Bearer ${sess.token}`;
      }
    }
  } catch (err) {
    console.warn('[authService] Failed to read auth session headers:', err);
  }
  return headers;
}

/**
 * Official MoraJaws Custom Authentication client methods communicating through Express backend
 */
export async function loginWithMoraJaws(identifier: string, password: string) {
  const res = await authFetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: identifier.trim(), password })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Backwards-compatible alias
export const loginWithSupabase = loginWithMoraJaws;

export async function refreshMoraJawsSession(refreshToken?: string) {
  const res = await authFetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(refreshToken ? { refreshToken } : {})
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Backwards-compatible alias
export const refreshSupabaseSession = refreshMoraJawsSession;

export async function logoutMoraJaws() {
  const headers = getAuthHeaders();
  const res = await authFetch('/api/auth/logout', {
    method: 'POST',
    headers
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Backwards-compatible alias
export const logoutSupabase = logoutMoraJaws;

/**
 * Superadmin-exclusive User Management API calls
 */
export async function adminCreateUser(userData: {
  name: string;
  username: string;
  email: string;
  altEmail?: string;
  phone?: string;
  role: UserRole;
  contractor?: string;
  contractorId?: string;
  area?: string;
  password: string;
}) {
  const headers = getAuthHeaders();
  const res = await authFetch('/api/admin/users', {
    method: 'POST',
    headers,
    body: JSON.stringify(userData)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminResetPassword(targetUserId: string, newPassword: string, confirmPassword: string) {
  const headers = getAuthHeaders();
  const res = await authFetch('/api/auth/admin/reset-password', {
    method: 'POST',
    headers,
    body: JSON.stringify({ targetUserId, newPassword, confirmPassword })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminUpdateUserStatus(targetUserId: string, status: 'active' | 'inactive' | 'locked' | 'unlocked', reason?: string) {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/users/${targetUserId}/status`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status, reason })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminRevokeSessions(targetUserId: string) {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/users/${targetUserId}/revoke-sessions`, {
    method: 'POST',
    headers
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminUpdateUser(targetUserId: string, userData: Partial<User>) {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/users/${targetUserId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(userData)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function changePasswordWithRotation(payload: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const headers = getAuthHeaders();
  const res = await authFetch('/api/auth/change-password', {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function resetPasswordWithToken(payload: {
  identifier: string;
  token: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const res = await authFetch('/api/auth/reset-password-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminIssueSingleUseResetToken(targetUserId: string, ttlHours: number = 24) {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/users/${targetUserId}/issue-reset-token`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ttlHours })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export type MassResetMode = 'force_change_with_token' | 'rotate_credential_and_force';
export type MassResetJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'cancelled'
  | 'rolled_back';
export type MassResetItemStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolled_back';

export interface MassResetJobItem {
  id: string;
  jobId: string;
  userId: string;
  username: string;
  userName: string;
  userRole: string;
  status: MassResetItemStatus;
  mustChangePassword: boolean;
  sessionsRevoked: boolean;
  resetTokenExpiresAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  processedAt: string | null;
}

export interface MassResetJob {
  id: string;
  idempotencyKey: string | null;
  createdById: string;
  createdByName: string;
  createdByRole: string;
  resetMode: MassResetMode;
  targetScope: 'all_active' | 'by_role' | 'selected_users';
  roleFilter: string | null;
  excludeSelf: boolean;
  invalidateSessions: boolean;
  tokenTtlHours: number;
  batchSize: number;
  reason: string | null;
  status: MassResetJobStatus;
  cancelRequested: boolean;
  totalTargets: number;
  pendingCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  mustChangePasswordCount: number;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
  items?: MassResetJobItem[];
}

export async function adminCreateMassResetJob(payload: {
  resetMode: MassResetMode;
  targetScope: 'all_active' | 'by_role' | 'selected_users';
  roleFilter?: string;
  userIds?: string[];
  excludeSelf?: boolean;
  invalidateSessions?: boolean;
  tokenTtlHours?: number;
  batchSize?: number;
  idempotencyKey?: string;
  reason?: string;
}) {
  const headers = getAuthHeaders();
  const res = await authFetch('/api/admin/password-reset/jobs', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminListMassResetJobs() {
  const headers = getAuthHeaders();
  const res = await authFetch('/api/admin/password-reset/jobs', { headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminGetMassResetJob(jobId: string) {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/password-reset/jobs/${jobId}`, { headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminRetryMassResetJob(jobId: string) {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/password-reset/jobs/${jobId}/retry`, {
    method: 'POST',
    headers
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminCancelMassResetJob(jobId: string) {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/password-reset/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminRollbackMassResetJob(jobId: string) {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/password-reset/jobs/${jobId}/rollback`, {
    method: 'POST',
    headers
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function adminDownloadMassResetReport(jobId: string, format: 'json' | 'csv' = 'csv') {
  const headers = getAuthHeaders();
  const res = await authFetch(`/api/admin/password-reset/jobs/${jobId}/report?format=${format}`, {
    headers
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || 'Gagal mengunduh laporan reset sandi.');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `morajaws-password-reset-${jobId}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}




