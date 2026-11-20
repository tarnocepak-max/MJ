import {
  Ticket,
  User,
  WOKpiFilterKey,
  WOKpiSummary,
  FieldDispatchKpiCounts,
  ProgressReportHistoryItem
} from '../types';
import { getTicketAppointmentDate, getJakartaDateString } from './appointmentDateParser';

export type CanonicalReportStatus = 'PENDING' | 'COMPLETE' | 'RESCHEDULE' | 'CANCEL' | 'NONE';
export type CanonicalApprovalStatus = 'NONE' | 'BUTUH APPROVAL' | 'APPROVED' | 'REVISION';

export function isValidGeoCoordPair(lat: unknown, lng: unknown): boolean {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return false;
  if (Math.abs(nLat) < 0.0001 && Math.abs(nLng) < 0.0001) return false;
  return Math.abs(nLat) <= 90 && Math.abs(nLng) <= 180;
}

export function isTicketAssigned(ticket: Ticket): boolean {
  if (!ticket) return false;
  const hasInstallerName = Boolean(String(ticket.installerName || '').trim());
  const hasInstallerId = Boolean(String(ticket.installerId || ticket.assignedTo || '').trim());
  const st = String(ticket.statusWOInstaller || '').trim().toLowerCase();
  if (st === 'unassigned' && !hasInstallerName) return false;
  return hasInstallerName || hasInstallerId;
}

export function isTicketCheckedIn(ticket: Ticket): boolean {
  if (!ticket) return false;
  if (ticket.checkInAt && String(ticket.checkInAt).trim()) return true;
  const ws = String(ticket.workSessionStatus || '').trim().toLowerCase();
  if (ws === 'sedang dikerjakan' || ws === 'selesai') return true;
  const inst = String(ticket.statusWOInstaller || '').trim().toUpperCase();
  return inst === 'PROGRESS' || inst === 'ON SITE' || inst === 'EN ROUTE' || inst === 'IN PROGRESS';
}

/**
 * Validasi Check-In Field Dispatch KPI:
 * Wajib memiliki:
 * 1. Transaksi Check-In tersimpan (checkInAt)
 * 2. Foto Rumah ('customer_house') tersimpan dengan URL valid
 * 3. Koordinat GPS/Geotag valid (non-null, non-0,0) sesuai SOP
 */
export function hasValidHousePhotoCheckIn(ticket: Ticket): boolean {
  if (!ticket) return false;
  const hasCheckInTs = Boolean(ticket.checkInAt && String(ticket.checkInAt).trim());
  if (!hasCheckInTs) return false;

  const slots = Array.isArray(ticket.technicalReport?.photoSlots)
    ? ticket.technicalReport!.photoSlots
    : [];
  const houseSlot = slots.find(
    s => s && s.slotKey === 'customer_house' && Boolean(String(s.url || '').trim()) && s.uploadStatus !== 'failed'
  );
  const houseLoc = ticket.houseLocation;
  const hasSavedHousePhoto = Boolean(houseSlot?.url || String(houseLoc?.photoUrl || '').trim());
  if (!hasSavedHousePhoto) return false;

  const slotGpsOk = Boolean(
    houseSlot &&
      houseSlot.geotagStatus !== 'missing' &&
      isValidGeoCoordPair(houseSlot.latitude, houseSlot.longitude)
  );
  const locGpsOk = Boolean(houseLoc && isValidGeoCoordPair(houseLoc.latitude, houseLoc.longitude));

  return slotGpsOk || locGpsOk;
}

export function normalizeCanonicalReportStatus(rawValue: unknown): CanonicalReportStatus {
  const s = String(rawValue || '').trim().toUpperCase();
  if (!s) return 'NONE';
  if (s.includes('CANCEL') || s.includes('FAILED') || s.includes('BATAL')) return 'CANCEL';
  if (s.includes('RESCHEDULE') || s.includes('RESCH')) return 'RESCHEDULE';
  if (s.includes('PENDING') || s.includes('TERTUNDA') || s.includes('KENDALA') || s.includes('UNCOMPLETE')) return 'PENDING';
  if (s.includes('COMPLETE') || s.includes('INSTALLED') || s.includes('BERHASIL') || s.includes('DONE') || s.includes('RESOLVED')) {
    return 'COMPLETE';
  }
  return 'NONE';
}

export function getTicketCanonicalReportStatus(ticket: Ticket): CanonicalReportStatus {
  if (!ticket) return 'NONE';
  const latestReport = Array.isArray(ticket.progressReports) && ticket.progressReports.length > 0
    ? ticket.progressReports[0]
    : null;

  const tr = ticket.technicalReport;
  const hasActualTechReport = Boolean(
    tr &&
      (String(tr.submittedAt || '').trim() ||
        String(tr.mainCategory || '').trim() ||
        String(tr.workResult || '').trim())
  );

  const hasExplicitReportSignal = Boolean(
    latestReport || hasActualTechReport || String(ticket.reportStatusLabel || '').trim()
  );

  const hasSubmittedReport = Boolean(
    hasExplicitReportSignal ||
      ['BUTUH APPROVAL', 'WAITING APPROVAL', 'APPROVED', 'REJECTED', 'REVISI', 'REVISION'].includes(
        String(ticket.approvalStatus || '').trim().toUpperCase()
      )
  );

  if (!hasSubmittedReport) return 'NONE';

  const candidates = [
    latestReport?.reportStatusLabel,
    latestReport?.reportStatus,
    ticket.reportStatusLabel,
    tr?.mainCategory,
    tr?.workResult,
    ...(hasExplicitReportSignal ? [ticket.statusWOInstaller, ticket.statusWOAgent] : [])
  ];

  for (const c of candidates) {
    const normalized = normalizeCanonicalReportStatus(c);
    if (normalized !== 'NONE') return normalized;
  }

  return 'NONE';
}

export function getTicketCanonicalApprovalStatus(ticket: Ticket): CanonicalApprovalStatus {
  if (!ticket) return 'NONE';
  const raw = String(ticket.approvalStatus || '').trim().toUpperCase();
  if (raw === 'BUTUH APPROVAL' || raw === 'WAITING APPROVAL' || raw === 'PENDING APPROVAL') {
    return 'BUTUH APPROVAL';
  }
  if (raw === 'APPROVED') return 'APPROVED';
  if (raw === 'REJECTED' || raw === 'REVISI' || raw === 'REVISION' || raw === 'REVISION / REJECTED') {
    return 'REVISION';
  }
  return 'NONE';
}

export function isTicketClosed(ticket: Ticket): boolean {
  if (!ticket) return false;
  if (String(ticket.statusWOAgent || '').trim().toLowerCase() === 'closed') return true;
  if (getTicketCanonicalApprovalStatus(ticket) === 'APPROVED' && Boolean(ticket.closedAt)) return true;
  return false;
}

export function isFieldRequestedWo(ticket: Ticket): boolean {
  if (!ticket || ticket.isDeleted || ticket.isArchived) return false;
  if (!isTicketAssigned(ticket)) return false;
  if (isTicketClosed(ticket)) return false;
  if (getTicketCanonicalReportStatus(ticket) !== 'NONE') return false;
  if (isTicketCheckedIn(ticket) || Boolean(ticket.workStartedAt)) return false;
  return true;
}

export function isTicketUnmappedDistribution(ticket: Ticket): boolean {
  if (!ticket) return false;
  const ds = String(ticket.distributionStatus || '').trim().toLowerCase();
  if (ds === 'unmapped_contractor' || ds === 'unmapped_leader' || ds === 'coverage_mismatch' || ds === 'schedule_not_available') {
    return true;
  }
  return !String(ticket.leaderName || '').trim() && ds !== 'distributed';
}

export function dedupeTicketsByCanonicalId<T extends { id?: string; woNumber?: string; isDeleted?: boolean; isArchived?: boolean }>(
  tickets: T[]
): T[] {
  const map = new Map<string, T>();
  (tickets || []).forEach(t => {
    if (!t || t.isDeleted || t.isArchived) return;
    const key = String(t.id || t.woNumber || '').trim();
    if (!key) return;
    map.set(key, t);
  });
  return Array.from(map.values());
}

export function computeFieldDispatchCounts(tickets: Ticket[]): FieldDispatchKpiCounts {
  const deduped = dedupeTicketsByCanonicalId(tickets);
  const result: FieldDispatchKpiCounts = {
    checkIn: 0,
    complete: 0,
    requested: 0,
    reschedule: 0,
    pending: 0,
    cancel: 0
  };

  deduped.forEach(t => {
    const reportStatus = getTicketCanonicalReportStatus(t);
    if (hasValidHousePhotoCheckIn(t)) result.checkIn++;
    if (reportStatus === 'COMPLETE') result.complete++;
    if (isFieldRequestedWo(t)) result.requested++;
    if (reportStatus === 'RESCHEDULE') result.reschedule++;
    if (reportStatus === 'PENDING') result.pending++;
    if (reportStatus === 'CANCEL') result.cancel++;
  });

  return result;
}

export function matchesKpiFilter(ticket: Ticket, filterKey: WOKpiFilterKey): boolean {
  const assigned = isTicketAssigned(ticket);
  const checkedIn = isTicketCheckedIn(ticket);
  const validHouseCheckIn = hasValidHousePhotoCheckIn(ticket);
  const reportStatus = getTicketCanonicalReportStatus(ticket);
  const approvalStatus = getTicketCanonicalApprovalStatus(ticket);
  const closed = isTicketClosed(ticket);

  switch (filterKey) {
    case 'total_today':
      return true;
    case 'unassigned':
      return !assigned;
    case 'assigned':
      return assigned;
    case 'not_checked_in':
      return !checkedIn && !closed;
    case 'checked_in_progress':
      return checkedIn && !closed && approvalStatus !== 'APPROVED';
    case 'report_pending':
    case 'field_pending':
      return reportStatus === 'PENDING';
    case 'report_complete':
    case 'field_complete':
      return reportStatus === 'COMPLETE';
    case 'report_reschedule':
    case 'field_reschedule':
      return reportStatus === 'RESCHEDULE';
    case 'report_cancel':
    case 'field_cancel':
      return reportStatus === 'CANCEL';
    case 'field_checkin':
      return validHouseCheckIn;
    case 'field_requested':
      return isFieldRequestedWo(ticket);
    case 'butuh_approval':
      return approvalStatus === 'BUTUH APPROVAL';
    case 'approved':
      return approvalStatus === 'APPROVED';
    case 'revision_rejected':
      return approvalStatus === 'REVISION';
    case 'closed':
      return closed;
    case 'unmapped_distribution':
      return isTicketUnmappedDistribution(ticket);
    default:
      return true;
  }
}

export function scopeTicketsForRoleClient(tickets: Ticket[], user: User | null | undefined): Ticket[] {
  if (!user) return [];
  const role = user.role;
  if (role === 'super_admin' || role === 'dispatch' || role === 'management_data' || role === 'it_support') {
    return tickets;
  }
  if (role === 'leader') {
    const myName = (user.name || '').trim().toLowerCase();
    const myContractor = (user.contractor || '').trim().toLowerCase();
    const myArea = (user.area || '').trim().toLowerCase();
    return tickets.filter(t => {
      const tContr = (t.contactorName || t.contractorName || '').trim().toLowerCase();
      if (myContractor && tContr && !tContr.includes(myContractor) && !myContractor.includes(tContr)) {
        return false;
      }
      if (myArea) {
        const tArea = (t.area || '').trim().toLowerCase();
        if (tArea && !tArea.includes(myArea) && !myArea.includes(tArea)) return false;
      }
      const tLeader = (t.leaderName || '').trim().toLowerCase();
      if (tLeader && myName && tLeader !== myName && !myContractor) return false;
      return true;
    });
  }
  if (role === 'installer') {
    const myId = user.id || '';
    const myUsername = (user.username || '').trim().toLowerCase();
    const myName = (user.name || '').trim().toLowerCase().replace(/\(.*?\)/g, '').trim();
    return tickets.filter(t => {
      if (myId && (t.assignedTo === myId || t.installerId === myId || t.assignedToUid === myId)) return true;
      if (myUsername && t.assignedTo?.toLowerCase() === myUsername) return true;
      const tInst = (t.installerName || '').trim().toLowerCase();
      if (myName && tInst && (tInst === myName || tInst.includes(myName) || myName.includes(tInst))) return true;
      return false;
    });
  }
  return [];
}

export function computeClientKpiSummary(
  tickets: Ticket[],
  user: User,
  options: { dateWIB?: string; contractorFilter?: string; areaFilter?: string } = {}
): WOKpiSummary {
  const dateWIB = options.dateWIB || getJakartaDateString(0);
  const contractorFilter = options.contractorFilter || 'ALL';
  const areaFilter = options.areaFilter || 'ALL';

  const scoped = dedupeTicketsByCanonicalId(scopeTicketsForRoleClient(tickets, user)).filter(t => {
    if (!t || t.isDeleted || t.isArchived) return false;
    const d = getTicketAppointmentDate(t);
    if (!d || d !== dateWIB) return false;
    if (contractorFilter !== 'ALL') {
      const c = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
      if (c !== contractorFilter.trim().toLowerCase()) return false;
    }
    if (areaFilter !== 'ALL') {
      const a = String(t.area || '').trim().toLowerCase();
      if (a !== areaFilter.trim().toLowerCase()) return false;
    }
    return true;
  });

  const counts: WOKpiSummary['counts'] = {
    totalToday: scoped.length,
    unassigned: 0,
    assigned: 0,
    notCheckedIn: 0,
    checkedInProgress: 0,
    reportPending: 0,
    reportComplete: 0,
    reportReschedule: 0,
    reportCancel: 0,
    butuhApproval: 0,
    approved: 0,
    revisionRejected: 0,
    closed: 0,
    unmappedDistribution: 0
  };

  const fieldDispatchCounts = computeFieldDispatchCounts(scoped);

  const vendorMap = new Map<string, any>();
  const areaMap = new Map<string, any>();
  const leaderMap = new Map<string, any>();
  const installerMap = new Map<string, any>();

  scoped.forEach(t => {
    const assigned = isTicketAssigned(t);
    const checkedIn = isTicketCheckedIn(t);
    const reportStatus = getTicketCanonicalReportStatus(t);
    const approvalStatus = getTicketCanonicalApprovalStatus(t);
    const closed = isTicketClosed(t);
    const unmapped = isTicketUnmappedDistribution(t);

    if (assigned) counts.assigned++; else counts.unassigned++;
    if (!checkedIn && !closed) counts.notCheckedIn++;
    if (checkedIn && !closed && approvalStatus !== 'APPROVED') counts.checkedInProgress++;
    if (reportStatus === 'PENDING') counts.reportPending++;
    else if (reportStatus === 'COMPLETE') counts.reportComplete++;
    else if (reportStatus === 'RESCHEDULE') counts.reportReschedule++;
    else if (reportStatus === 'CANCEL') counts.reportCancel++;
    if (approvalStatus === 'BUTUH APPROVAL') counts.butuhApproval++;
    else if (approvalStatus === 'APPROVED') counts.approved++;
    else if (approvalStatus === 'REVISION') counts.revisionRejected++;
    if (closed) counts.closed++;
    if (unmapped) counts.unmappedDistribution++;

    const vendorName = String(t.contactorName || t.contractorName || 'Tanpa Vendor').trim() || 'Tanpa Vendor';
    if (!vendorMap.has(vendorName)) {
      vendorMap.set(vendorName, {
        contractorId: t.contractorId,
        contractorName: vendorName,
        total: 0,
        unassigned: 0,
        assigned: 0,
        notCheckedIn: 0,
        checkedInProgress: 0,
        reportPending: 0,
        reportComplete: 0,
        reportReschedule: 0,
        reportCancel: 0,
        butuhApproval: 0,
        approved: 0,
        revisionRejected: 0,
        closed: 0,
        unmapped: 0
      });
    }
    const vb = vendorMap.get(vendorName);
    vb.total++;
    if (assigned) vb.assigned++; else vb.unassigned++;
    if (!checkedIn && !closed) vb.notCheckedIn++;
    if (checkedIn && !closed && approvalStatus !== 'APPROVED') vb.checkedInProgress++;
    if (reportStatus === 'PENDING') vb.reportPending++;
    if (reportStatus === 'COMPLETE') vb.reportComplete++;
    if (reportStatus === 'RESCHEDULE') vb.reportReschedule++;
    if (reportStatus === 'CANCEL') vb.reportCancel++;
    if (approvalStatus === 'BUTUH APPROVAL') vb.butuhApproval++;
    if (approvalStatus === 'APPROVED') vb.approved++;
    if (approvalStatus === 'REVISION') vb.revisionRejected++;
    if (closed) vb.closed++;
    if (unmapped) vb.unmapped++;

    const areaName = String(t.area || 'Tanpa Area').trim() || 'Tanpa Area';
    if (!areaMap.has(areaName)) {
      areaMap.set(areaName, { area: areaName, total: 0, unassigned: 0, checkedInProgress: 0, butuhApproval: 0, approved: 0, closed: 0 });
    }
    const ab = areaMap.get(areaName);
    ab.total++;
    if (!assigned) ab.unassigned++;
    if (checkedIn && !closed && approvalStatus !== 'APPROVED') ab.checkedInProgress++;
    if (approvalStatus === 'BUTUH APPROVAL') ab.butuhApproval++;
    if (approvalStatus === 'APPROVED') ab.approved++;
    if (closed) ab.closed++;

    const leaderName = String(t.leaderName || 'Belum Terdistribusi').trim() || 'Belum Terdistribusi';
    const lKey = `${leaderName}::${vendorName}`;
    if (!leaderMap.has(lKey)) {
      leaderMap.set(lKey, { leaderName, contractorName: vendorName, total: 0, unassigned: 0, assigned: 0, checkedInProgress: 0, butuhApproval: 0, closed: 0 });
    }
    const lb = leaderMap.get(lKey);
    lb.total++;
    if (assigned) lb.assigned++; else lb.unassigned++;
    if (checkedIn && !closed && approvalStatus !== 'APPROVED') lb.checkedInProgress++;
    if (approvalStatus === 'BUTUH APPROVAL') lb.butuhApproval++;
    if (closed) lb.closed++;

    if (assigned) {
      const installerName = String(t.installerName || t.assignedTo || 'Teknisi').trim() || 'Teknisi';
      const iKey = `${installerName}::${vendorName}`;
      if (!installerMap.has(iKey)) {
        installerMap.set(iKey, { installerName, contractorName: vendorName, area: areaName, total: 0, checkedInProgress: 0, butuhApproval: 0, approved: 0, revisionRejected: 0, closed: 0 });
      }
      const ib = installerMap.get(iKey);
      ib.total++;
      if (checkedIn && !closed && approvalStatus !== 'APPROVED') ib.checkedInProgress++;
      if (approvalStatus === 'BUTUH APPROVAL') ib.butuhApproval++;
      if (approvalStatus === 'APPROVED') ib.approved++;
      if (approvalStatus === 'REVISION') ib.revisionRejected++;
      if (closed) ib.closed++;
    }
  });

  return {
    dateWIB,
    generatedAt: new Date().toISOString(),
    scopeRole: user.role,
    contractorFilter,
    areaFilter,
    counts,
    fieldDispatchCounts,
    byVendor: Array.from(vendorMap.values()).sort((a, b) => b.total - a.total),
    byArea: Array.from(areaMap.values()).sort((a, b) => b.total - a.total),
    byLeader: Array.from(leaderMap.values()).sort((a, b) => b.total - a.total),
    byInstaller: Array.from(installerMap.values()).sort((a, b) => b.total - a.total)
  };
}

export function extractProgressReportHistoryClient(tickets: Ticket[]): ProgressReportHistoryItem[] {
  const items: ProgressReportHistoryItem[] = [];
  (tickets || []).forEach(t => {
    if (!t || t.isDeleted) return;
    const reports = Array.isArray(t.progressReports) ? t.progressReports : [];
    const totalVersions = reports.length;

    reports.forEach((rep: any, idx: number) => {
      if (!rep) return;
      const versionNumber = totalVersions - idx;
      const isLatest = idx === 0;
      const repApproval = rep.approvalStatus || (isLatest ? t.approvalStatus : undefined) || 'BUTUH APPROVAL';
      const canonicalReport = normalizeCanonicalReportStatus(
        rep.reportStatusLabel || rep.reportStatus || t.reportStatusLabel
      );

      items.push({
        id: rep.id || `${t.id}_v${versionNumber}`,
        ticketId: t.id,
        woNumber: t.woNumber || t.workOrderNumber || '',
        appointmentDate: rep.appointmentDate || getTicketAppointmentDate(t),
        slotTime: rep.slotTime || t.slotTime || '',
        customerName: t.customerName || '',
        installerName: rep.installerName || rep.submittedBy || t.installerName || '-',
        vendorName: t.contactorName || t.contractorName || '-',
        area: t.area || '-',
        leaderName: t.leaderName || '-',
        versionNumber,
        reportStatus: canonicalReport !== 'NONE' ? canonicalReport : (rep.reportStatusLabel || rep.reportStatus || '-'),
        reasonReport: rep.reasonReportLabel || rep.reasonReport || '',
        rootCause: rep.rootcauseLabel || rep.rootCause || '',
        remarks: rep.remarksReport || rep.remarks || t.remarksWOInstaller || '-',
        submittedAt: rep.timestamp || t.updatedAt || t.createdAt,
        submittedBy: rep.submittedBy || t.installerName || '-',
        approvalStatus:
          repApproval === 'APPROVED'
            ? 'APPROVED'
            : repApproval === 'REJECTED' || repApproval === 'REVISI'
            ? 'REVISION / REJECTED'
            : 'WAITING APPROVAL',
        dispatchApprover:
          rep.approvedBy ||
          rep.rejectedBy ||
          (isLatest
            ? repApproval === 'APPROVED'
              ? t.approvedBy
              : repApproval === 'REJECTED' || repApproval === 'REVISI'
              ? t.rejectedBy
              : undefined
            : undefined),
        approvalTimestamp:
          rep.approvedAt ||
          rep.rejectedAt ||
          (isLatest
            ? repApproval === 'APPROVED'
              ? t.approvedAt
              : repApproval === 'REJECTED' || repApproval === 'REVISI'
              ? t.rejectedAt
              : undefined
            : undefined),
        approvalNotes: rep.approvalNotes || (isLatest ? t.approvalNotes : undefined),
        revisionReason: rep.revisionReason || rep.rejectionReason || (isLatest ? t.rejectionReason : undefined),
        finalWoStatus: isTicketClosed(t) && repApproval === 'APPROVED' ? 'CLOSED' : (t.statusWOAgent || 'In Progress')
      });
    });
  });

  return items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

export const KPI_FILTER_LABELS: Record<WOKpiFilterKey, string> = {
  total_today: 'Total WO Hari Ini',
  unassigned: 'Belum Assign',
  assigned: 'Sudah Assign',
  not_checked_in: 'Belum Check-in',
  checked_in_progress: 'Sudah Check-in / Progress',
  report_pending: 'Report Pending',
  report_complete: 'Report Complete',
  report_reschedule: 'Report Reschedule',
  report_cancel: 'Report Cancel',
  butuh_approval: 'Butuh Approval',
  approved: 'Disetujui (Approved)',
  revision_rejected: 'Perlu Revisi',
  closed: 'WO Closed',
  unmapped_distribution: 'Belum Terdistribusi',
  field_checkin: 'Check-in (Foto Rumah Valid)',
  field_complete: 'Complete (Report Done)',
  field_requested: 'Requested (Assigned)',
  field_reschedule: 'Reschedule',
  field_pending: 'Pending',
  field_cancel: 'Cancel'
};
