import type { Ticket, User, WOAssignmentHistory } from '../types/index';

export interface AssignmentActionResult {
  success: boolean;
  count: number;
  failedCount?: number;
  error?: string;
  requestId?: string;
  workOrders?: Ticket[];
  failed?: Array<{
    id: string;
    woNumber?: string;
    error: string;
    code?: string;
    stage?: string;
  }>;
}

export interface ReassignActionResult {
  success: boolean;
  error?: string;
  code?: string;
  httpStatus?: number;
  requestId?: string;
  workOrder?: Ticket;
  historyEntry?: WOAssignmentHistory;
}

export interface ReassignValidationResult {
  valid: boolean;
  error?: string;
  code?: string;
  httpStatus?: number;
  installer?: User;
  cleanReason?: string;
}

function norm(val?: string | null): string {
  return String(val || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function isScopeStringMatch(a?: string | null, b?: string | null): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Matches contractor scope on the frontend using BOTH contractorId and free-text contractor name.
 */
export function isContractorScopeMatchClient(
  userContractorId?: string | null,
  userContractorName?: string | null,
  targetContractorId?: string | null,
  targetContractorName?: string | null
): boolean {
  const uId = norm(userContractorId);
  const uName = norm(userContractorName);
  const tId = norm(targetContractorId);
  const tName = norm(targetContractorName);

  if (!uId && !uName) return false;
  if (!tId && !tName) return false;

  if (uId && tId && uId === tId) return true;
  if (uName && tName && isScopeStringMatch(uName, tName)) return true;
  if (uId && tName && isScopeStringMatch(uId, tName)) return true;
  if (uName && tId && isScopeStringMatch(uName, tId)) return true;
  return false;
}

export function isTicketInLeaderScope(
  ticket: Pick<Ticket, 'contractorId' | 'contractorName' | 'contactorName' | 'area' | 'isArchived' | 'isDeleted'>,
  leader: Pick<User, 'role' | 'contractorId' | 'contractor' | 'area'>
): boolean {
  if (!ticket || !leader) return false;
  if (ticket.isDeleted || ticket.isArchived) return false;
  if (String(leader.role || '').toLowerCase() === 'super_admin') return true;
  if (String(leader.role || '').toLowerCase() !== 'leader') return false;

  const contrMatch = isContractorScopeMatchClient(
    leader.contractorId,
    leader.contractor,
    ticket.contractorId,
    ticket.contactorName || ticket.contractorName
  );
  if (!contrMatch) return false;

  const leaderArea = norm(leader.area);
  if (!leaderArea) return true;
  const ticketArea = norm(ticket.area);
  if (!ticketArea) return false;
  return isScopeStringMatch(ticketArea, leaderArea);
}

/**
 * Deterministically resolves the target installer account for a Leader assignment.
 * Prefers active, non-deleted installers within the Leader's contractor scope.
 */
export function resolveTargetInstallerClient(
  users: User[],
  installerNameOrId?: string | null,
  leaderContractorId?: string | null,
  leaderContractorName?: string | null,
  explicitInstallerId?: string | null
): User | undefined {
  const needleId = String(explicitInstallerId || '').trim();
  const needle = norm(installerNameOrId);
  if (!needleId && !needle) return undefined;

  const installers = (users || []).filter(
    u => String(u?.role || '').trim().toLowerCase() === 'installer' && !u.isDeleted
  );

  if (needleId) {
    const byId = installers.find(u => String(u.id || '').trim() === needleId);
    if (byId) return byId;
  }

  const activeInstallers = installers.filter(u => u.active !== false && !u.isArchived);
  const inScopeActive = (leaderContractorId || leaderContractorName)
    ? activeInstallers.filter(u =>
        isContractorScopeMatchClient(leaderContractorId, leaderContractorName, u.contractorId, u.contractor)
      )
    : activeInstallers;

  const exactInScope = inScopeActive.find(
    u => norm(u.name) === needle || norm(u.username) === needle || String(u.id || '').trim() === String(installerNameOrId || '').trim()
  );
  if (exactInScope) return exactInScope;

  const exactActive = activeInstallers.find(
    u => norm(u.name) === needle || norm(u.username) === needle || String(u.id || '').trim() === String(installerNameOrId || '').trim()
  );
  if (exactActive) return exactActive;

  // Fallback to matching inactive user so caller can emit clear "Teknisi tidak aktif" error instead of wrong match
  return installers.find(
    u => norm(u.name) === needle || norm(u.username) === needle || String(u.id || '').trim() === String(installerNameOrId || '').trim()
  );
}

export interface AssignmentPatchPlan {
  updatedTicketsList: Ticket[];
  prevSnapshots: Map<string, Ticket>;
  outOfScopeIds: string[];
  patchedAllTickets: Ticket[];
}

/**
 * Pure, side-effect-free builder for optimistic ticket updates & rollback snapshots.
 * Avoids mutating arrays or scheduling state updates inside React's setTickets updater.
 */
export function buildAssignmentPatchPlan(params: {
  allTickets: Ticket[];
  targetIds: string[];
  installer?: User;
  installerNameInput: string;
  leader: Pick<User, 'id' | 'name' | 'role' | 'contractorId' | 'contractor' | 'area'>;
  slotTime?: string;
  remarks?: string;
  nowIso?: string;
}): AssignmentPatchPlan {
  const { allTickets, targetIds, installer, installerNameInput, leader, slotTime, remarks, nowIso } = params;
  const targetSet = new Set(targetIds.map(id => String(id || '').trim()).filter(Boolean));
  const now = nowIso || new Date().toISOString();
  const cleanInstName = String(installer?.name || installerNameInput || '').trim();
  const prevSnapshots = new Map<string, Ticket>();
  const updatedTicketsList: Ticket[] = [];
  const outOfScopeIds: string[] = [];

  const patchedAllTickets = allTickets.map(t => {
    if (!targetSet.has(t.id)) return t;
    if (!isTicketInLeaderScope(t, leader)) {
      outOfScopeIds.push(t.id);
      return t;
    }

    prevSnapshots.set(t.id, t);
    const updated: Ticket = {
      ...t,
      installerName: cleanInstName !== '' ? cleanInstName : t.installerName,
      installerId: installer?.id || t.installerId,
      installerUid: installer?.id || (t as any).installerUid,
      assignedTo: cleanInstName !== '' ? cleanInstName : t.assignedTo,
      assignedToUid: installer?.id || t.assignedToUid,
      installerContact: installer?.phone || t.installerContact,
      leaderName: t.leaderName || leader.name,
      leaderId: t.leaderId || leader.id,
      slotTime: slotTime !== undefined && slotTime !== '' ? slotTime : t.slotTime,
      statusWOInstaller: cleanInstName ? (t.checkInAt ? t.statusWOInstaller : 'Assigned') : t.statusWOInstaller,
      remarksWOInstaller: remarks
        ? t.remarksWOInstaller
          ? `${t.remarksWOInstaller}; ${remarks}`
          : remarks
        : t.remarksWOInstaller,
      assignedAt: now,
      assignedBy: leader.name,
      updatedAt: now,
      updatedBy: leader.name
    };
    updatedTicketsList.push(updated);
    return updated;
  });

  return {
    updatedTicketsList,
    prevSnapshots,
    outOfScopeIds,
    patchedAllTickets
  };
}

export function formatAssignmentFailureMessage(params: {
  failed?: Array<{ id?: string; woNumber?: string; error?: string; code?: string; stage?: string }>;
  topLevelError?: string;
  topLevelMessage?: string;
  topLevelCode?: string;
  requestId?: string;
  totalCount: number;
  successCount?: number;
  httpStatus?: number;
}): string {
  const failedList = Array.isArray(params.failed) ? params.failed : [];
  const okCount = params.successCount ?? 0;

  if (failedList.length > 0) {
    const first = failedList[0];
    const reason = String(first?.error || params.topLevelError || params.topLevelMessage || 'Gagal menyimpan ke server').trim();
    const codeTag = first?.code || params.topLevelCode ? `[${first?.code || params.topLevelCode}] ` : '';
    const woTag = first?.woNumber || first?.id ? `WO ${first.woNumber || first.id}: ` : '';
    const reqTag = params.requestId ? ` (Ref: ${params.requestId})` : '';
    if (failedList.length === 1) {
      return `${codeTag}${woTag}${reason}${reqTag}`;
    }
    return `${failedList.length} dari ${params.totalCount} penugasan gagal${okCount > 0 ? ` (${okCount} berhasil)` : ''}. Penyebab utama: ${codeTag}${woTag}${reason}${reqTag}`;
  }

  const directReason = String(params.topLevelError || params.topLevelMessage || '').trim();
  const codePrefix = params.topLevelCode ? `[${params.topLevelCode}] ` : '';
  const reqSuffix = params.requestId ? ` (Ref: ${params.requestId})` : '';
  if (directReason) {
    return `${codePrefix}${directReason}${reqSuffix}`;
  }

  const statusText = params.httpStatus ? `HTTP ${params.httpStatus}` : 'Kesalahan server';
  return `${statusText}: Gagal menyimpan penugasan ke server.${reqSuffix}`;
}

export function validateReassignPreconditions(params: {
  ticket?: Ticket;
  users: User[];
  leader: Pick<User, 'id' | 'name' | 'role' | 'contractorId' | 'contractor' | 'area'>;
  newInstallerName: string;
  newInstallerId?: string;
  reason: string;
}): ReassignValidationResult {
  const { ticket, users, leader, newInstallerName, newInstallerId, reason } = params;

  if (String(leader?.role || '').trim().toLowerCase() !== 'leader') {
    return {
      valid: false,
      code: 'REQUIRE_LEADER_ROLE',
      httpStatus: 403,
      error: 'Akses Ditolak: Hanya akun dengan role Leader yang berwenang melakukan Reassign WO.'
    };
  }

  if (!ticket) {
    return {
      valid: false,
      code: 'NOT_FOUND',
      httpStatus: 404,
      error: 'Tiket Work Order tidak ditemukan.'
    };
  }

  if (ticket.isDeleted || ticket.isArchived) {
    return {
      valid: false,
      code: 'WO_DELETED_OR_ARCHIVED',
      httpStatus: 409,
      error: `Work Order ${ticket.woNumber || ticket.id} sudah dihapus atau diarsipkan sehingga tidak dapat direassign.`
    };
  }

  if (
    ticket.statusWOInstaller === 'Completed' ||
    ticket.statusWOInstaller === 'Installed' ||
    ticket.statusWOAgent === 'Done' ||
    ticket.statusWOAgent === 'Closed' ||
    ticket.ticketResult === 'Closed'
  ) {
    return {
      valid: false,
      code: 'WO_COMPLETED_OR_CLOSED',
      httpStatus: 409,
      error: `WO ${ticket.woNumber} telah selesai atau ditutup sehingga tidak dapat di-reassign.`
    };
  }

  if (!isTicketInLeaderScope(ticket, leader)) {
    return {
      valid: false,
      code: 'SCOPE_MISMATCH',
      httpStatus: 403,
      error: `Akses Ditolak: WO ${ticket.woNumber} berada di luar cakupan Contractor/Area Anda (${leader.contractor || leader.contractorId || '-'}).`
    };
  }

  const cleanReason = String(reason || '').trim();
  if (cleanReason.length < 5) {
    return {
      valid: false,
      code: 'INVALID_REASON',
      httpStatus: 400,
      error: 'Alasan reassign wajib diisi minimal 5 karakter untuk keperluan audit.'
    };
  }

  const cleanInstallerId = String(newInstallerId || '').trim();
  const cleanInstallerName = String(newInstallerName || '').trim();
  if (!cleanInstallerId && !cleanInstallerName) {
    return {
      valid: false,
      code: 'INVALID_INPUT',
      httpStatus: 400,
      error: 'Teknisi pengganti dan ID akun teknisi wajib dipilih.'
    };
  }

  const installers = (users || []).filter(
    u => String(u?.role || '').trim().toLowerCase() === 'installer'
  );

  let matchedInstaller: User | undefined;
  if (cleanInstallerId) {
    matchedInstaller = installers.find(u => String(u.id || '').trim() === cleanInstallerId);
    if (!matchedInstaller) {
      return {
        valid: false,
        code: 'INSTALLER_NOT_FOUND',
        httpStatus: 400,
        error: `Akun teknisi dengan ID "${cleanInstallerId}" tidak ditemukan di direktori Installer aktif.`
      };
    }
  } else {
    const needle = norm(cleanInstallerName);
    const exactMatches = installers.filter(
      u => !u.isDeleted && (norm(u.name) === needle || norm(u.username) === needle)
    );
    const activeInScope = exactMatches.filter(
      u =>
        u.active !== false &&
        !u.isArchived &&
        (!(leader.contractorId || leader.contractor) ||
          isContractorScopeMatchClient(leader.contractorId, leader.contractor, u.contractorId, u.contractor))
    );

    if (activeInScope.length > 1) {
      return {
        valid: false,
        code: 'INSTALLER_AMBIGUOUS',
        httpStatus: 400,
        error: `Nama teknisi "${cleanInstallerName}" ambigu (${activeInScope.length} akun ditemukan). Pilih teknisi menggunakan ID akun yang unik.`
      };
    }

    matchedInstaller =
      activeInScope[0] ||
      exactMatches.find(u => u.active !== false && !u.isArchived) ||
      exactMatches[0] ||
      installers.find(u => norm(u.name) === needle || norm(u.username) === needle);

    if (!matchedInstaller) {
      return {
        valid: false,
        code: 'INSTALLER_NOT_FOUND',
        httpStatus: 400,
        error: `Akun teknisi "${cleanInstallerName}" tidak ditemukan di database Installer aktif.`
      };
    }
  }

  const resolvedId = String(matchedInstaller.id || '').trim();
  if (!resolvedId || /^inst-\d{10,}$/.test(resolvedId)) {
    return {
      valid: false,
      code: 'INSTALLER_ID_INVALID',
      httpStatus: 400,
      error: `Akun teknisi "${matchedInstaller.name}" tidak memiliki ID akun Supabase yang valid.`
    };
  }

  if (matchedInstaller.isDeleted || matchedInstaller.isArchived || matchedInstaller.active === false) {
    return {
      valid: false,
      code: 'INSTALLER_INACTIVE',
      httpStatus: 400,
      error: `Teknisi "${matchedInstaller.name}" sedang tidak aktif atau telah dihapus/diarsipkan dari sistem.`
    };
  }

  if (
    (leader.contractorId || leader.contractor) &&
    !isContractorScopeMatchClient(
      leader.contractorId,
      leader.contractor,
      matchedInstaller.contractorId,
      matchedInstaller.contractor
    )
  ) {
    return {
      valid: false,
      code: 'SCOPE_MISMATCH',
      httpStatus: 403,
      error: `Akses Ditolak: Teknisi "${matchedInstaller.name}" berada di luar cakupan Contractor Anda.`
    };
  }

  if (leader.area && matchedInstaller.area && !isScopeStringMatch(leader.area, matchedInstaller.area)) {
    return {
      valid: false,
      code: 'SCOPE_MISMATCH',
      httpStatus: 403,
      error: `Akses Ditolak: Teknisi "${matchedInstaller.name}" (${matchedInstaller.area}) berada di luar cakupan Area Anda (${leader.area}).`
    };
  }

  const currentInstId = String(ticket.installerId || (ticket as any).installerUid || '').trim();
  if (
    (currentInstId && currentInstId === resolvedId) ||
    (!currentInstId && ticket.installerName && norm(ticket.installerName) === norm(matchedInstaller.name))
  ) {
    return {
      valid: false,
      code: 'SAME_INSTALLER',
      httpStatus: 400,
      error: `WO ${ticket.woNumber} sudah ditugaskan kepada ${matchedInstaller.name}. Pilih teknisi lain untuk melakukan reassign.`
    };
  }

  return {
    valid: true,
    installer: matchedInstaller,
    cleanReason
  };
}

export function parseReassignApiResponse(
  httpStatus: number,
  ok: boolean,
  rawJson: any
): ReassignActionResult {
  if (!ok) {
    const errMsg =
      String(rawJson?.error || rawJson?.message || '').trim() ||
      `Reassign gagal (HTTP ${httpStatus})`;
    return {
      success: false,
      httpStatus,
      code: typeof rawJson?.code === 'string' ? rawJson.code : undefined,
      requestId: typeof rawJson?.requestId === 'string' ? rawJson.requestId : undefined,
      error: errMsg
    };
  }

  if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
    return {
      success: false,
      httpStatus,
      code: 'INVALID_RESPONSE_CONTRACT',
      error: 'Respons server reassign tidak valid (format JSON tidak sesuai).'
    };
  }

  if (rawJson.success !== true) {
    const errMsg =
      String(rawJson.error || rawJson.message || '').trim() ||
      'Server menolak permintaan reassign.';
    return {
      success: false,
      httpStatus,
      code: typeof rawJson.code === 'string' ? rawJson.code : 'REASSIGN_REJECTED',
      requestId: typeof rawJson.requestId === 'string' ? rawJson.requestId : undefined,
      error: errMsg
    };
  }

  const wo = rawJson.workOrder;
  const hasValidWorkOrder =
    Boolean(wo) &&
    typeof wo === 'object' &&
    !Array.isArray(wo) &&
    (Boolean(String(wo.id || '').trim()) || Boolean(String(wo.woNumber || '').trim()));

  if (!hasValidWorkOrder) {
    return {
      success: false,
      httpStatus,
      code: 'INVALID_RESPONSE_CONTRACT',
      requestId: typeof rawJson.requestId === 'string' ? rawJson.requestId : undefined,
      error: 'Respons server reassign tidak sesuai kontrak (data workOrder tidak ditemukan).'
    };
  }

  return {
    success: true,
    httpStatus,
    requestId: typeof rawJson.requestId === 'string' ? rawJson.requestId : undefined,
    workOrder: wo as Ticket,
    historyEntry: rawJson.historyEntry as WOAssignmentHistory | undefined
  };
}

export async function executeReassignWorkOrderRequest(params: {
  ticket?: Ticket;
  users: User[];
  leader: Pick<User, 'id' | 'name' | 'role' | 'contractorId' | 'contractor' | 'area'>;
  newInstallerName: string;
  newInstallerId?: string;
  reason: string;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ReassignActionResult> {
  const {
    ticket,
    users,
    leader,
    newInstallerName,
    newInstallerId,
    reason,
    headers,
    fetchImpl = fetch,
    timeoutMs = 25_000
  } = params;

  const validation = validateReassignPreconditions({
    ticket,
    users,
    leader,
    newInstallerName,
    newInstallerId,
    reason
  });

  if (!validation.valid || !validation.installer || !ticket) {
    return {
      success: false,
      error: validation.error || 'Validasi reassign gagal.',
      code: validation.code || 'VALIDATION_ERROR',
      httpStatus: validation.httpStatus || 400
    };
  }

  const targetInstaller = validation.installer;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl('/api/tickets/reassign', {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        ticketId: ticket.id,
        woNumber: ticket.woNumber,
        previousInstallerName: ticket.installerName || undefined,
        newInstallerId: targetInstaller.id,
        newInstallerName: targetInstaller.name,
        reason: validation.cleanReason,
        contractorName: ticket.contactorName || ticket.contractorName || leader.contractor || undefined
      })
    });

    const rawJson = await res.json().catch(() => null);
    return parseReassignApiResponse(res.status, res.ok, rawJson);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return {
        success: false,
        code: 'REQUEST_TIMEOUT',
        httpStatus: 408,
        error: `Permintaan reassign timeout (melebihi ${Math.round(timeoutMs / 1000)} detik). Periksa koneksi lalu coba lagi.`
      };
    }
    return {
      success: false,
      code: 'NETWORK_ERROR',
      error: err?.message || 'Gagal menghubungi server reassign.'
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
