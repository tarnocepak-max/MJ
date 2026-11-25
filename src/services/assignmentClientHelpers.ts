import type { Ticket, User } from '../types/index';

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
