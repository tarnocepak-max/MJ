/**
 * Shared MoraJaws WO Lifecycle & KPI Aggregation Engine (Server-Side)
 *
 * Single authoritative source for:
 * - Operational WIB date filtering (Today vs Future vs Backlog)
 * - Canonical Assignment, Check-in (LiveChat PROGRESS), Report Status (PENDING/COMPLETE/RESCHEDULE/CANCEL),
 *   Approval Status (BUTUH APPROVAL / APPROVED / REVISION / REJECTED), and Closed state classification
 * - 13 Dashboard KPI categories + Vendor, Area, Leader, Installer breakdowns
 * - Append-only History Progress Report extraction
 */

export type CanonicalReportStatus = 'PENDING' | 'COMPLETE' | 'RESCHEDULE' | 'CANCEL' | 'NONE';
export type CanonicalApprovalStatus = 'NONE' | 'BUTUH APPROVAL' | 'APPROVED' | 'REVISION';

export type WOKpiFilterKey =
  | 'total_today'
  | 'unassigned'
  | 'assigned'
  | 'not_checked_in'
  | 'checked_in_progress'
  | 'report_pending'
  | 'report_complete'
  | 'report_reschedule'
  | 'report_cancel'
  | 'butuh_approval'
  | 'approved'
  | 'revision_rejected'
  | 'closed'
  | 'unmapped_distribution'
  | 'field_checkin'
  | 'field_complete'
  | 'field_requested'
  | 'field_reschedule'
  | 'field_pending'
  | 'field_cancel';

export function isValidGeoCoordPairServer(lat: unknown, lng: unknown): boolean {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return false;
  if (Math.abs(nLat) < 0.0001 && Math.abs(nLng) < 0.0001) return false;
  return Math.abs(nLat) <= 90 && Math.abs(nLng) <= 180;
}

export function getTicketAppointmentDateServer(ticket: any): string {
  if (!ticket) return '';
  const raw = ticket.appointmentDate || ticket.date || ticket.ticketDate || '';
  if (!raw) return '';
  const str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(parsed);
    } catch {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return '';
}

export function isTicketAssigned(ticket: any): boolean {
  if (!ticket) return false;
  const hasInstallerName = Boolean(String(ticket.installerName || '').trim());
  const hasInstallerId = Boolean(String(ticket.installerId || ticket.assignedTo || '').trim());
  const st = String(ticket.statusWOInstaller || '').trim().toLowerCase();
  if (st === 'unassigned' && !hasInstallerName) return false;
  return hasInstallerName || hasInstallerId;
}

export function isTicketCheckedIn(ticket: any): boolean {
  if (!ticket) return false;
  if (ticket.checkInAt && String(ticket.checkInAt).trim()) return true;
  const ws = String(ticket.workSessionStatus || '').trim().toLowerCase();
  if (ws === 'sedang dikerjakan' || ws === 'selesai') return true;
  const inst = String(ticket.statusWOInstaller || '').trim().toUpperCase();
  return inst === 'PROGRESS' || inst === 'ON SITE' || inst === 'EN ROUTE' || inst === 'IN PROGRESS';
}

export function hasValidHousePhotoCheckIn(ticket: any): boolean {
  if (!ticket) return false;
  const hasCheckInTs = Boolean(ticket.checkInAt && String(ticket.checkInAt).trim());
  if (!hasCheckInTs) return false;

  const slots = Array.isArray(ticket.technicalReport?.photoSlots)
    ? ticket.technicalReport.photoSlots
    : [];
  const houseSlot = slots.find(
    (s: any) =>
      s &&
      s.slotKey === 'customer_house' &&
      Boolean(String(s.url || '').trim()) &&
      s.uploadStatus !== 'failed'
  );
  const houseLoc = ticket.houseLocation;
  const hasSavedHousePhoto = Boolean(houseSlot?.url || String(houseLoc?.photoUrl || '').trim());
  if (!hasSavedHousePhoto) return false;

  const slotGpsOk = Boolean(
    houseSlot &&
      houseSlot.geotagStatus !== 'missing' &&
      isValidGeoCoordPairServer(houseSlot.latitude, houseSlot.longitude)
  );
  const locGpsOk = Boolean(houseLoc && isValidGeoCoordPairServer(houseLoc.latitude, houseLoc.longitude));

  return slotGpsOk || locGpsOk;
}

export function normalizeCanonicalReportStatus(rawValue: any): CanonicalReportStatus {
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

export function getTicketCanonicalReportStatus(ticket: any): CanonicalReportStatus {
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

export function getTicketCanonicalApprovalStatus(ticket: any): CanonicalApprovalStatus {
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

export function isTicketClosed(ticket: any): boolean {
  if (!ticket) return false;
  const agent = String(ticket.statusWOAgent || '').trim().toLowerCase();
  if (agent === 'closed') return true;
  if (getTicketCanonicalApprovalStatus(ticket) === 'APPROVED' && Boolean(ticket.closedAt)) return true;
  return false;
}

export function isFieldRequestedWo(ticket: any): boolean {
  if (!ticket || ticket.isDeleted || ticket.isArchived) return false;
  if (!isTicketAssigned(ticket)) return false;
  if (isTicketClosed(ticket)) return false;
  if (getTicketCanonicalReportStatus(ticket) !== 'NONE') return false;
  if (isTicketCheckedIn(ticket) || Boolean(ticket.workStartedAt)) return false;
  return true;
}

export function isTicketUnmappedDistribution(ticket: any): boolean {
  if (!ticket) return false;
  const ds = String(ticket.distributionStatus || '').trim().toLowerCase();
  if (ds === 'unmapped_contractor' || ds === 'unmapped_leader' || ds === 'coverage_mismatch' || ds === 'schedule_not_available') {
    return true;
  }
  return !String(ticket.leaderName || '').trim() && ds !== 'distributed';
}

export function matchesKpiFilter(ticket: any, filterKey: WOKpiFilterKey): boolean {
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

export function computeKpiSummary(
  scopedTickets: any[],
  options: {
    dateWIB: string;
    scopeRole: string;
    contractorFilter?: string;
    areaFilter?: string;
  }
) {
  const { dateWIB, scopeRole, contractorFilter = 'ALL', areaFilter = 'ALL' } = options;

  const dedupedMap = new Map<string, any>();
  (scopedTickets || []).forEach(t => {
    if (!t || t.isDeleted || t.isArchived) return;
    const key = String(t.id || t.woNumber || '').trim();
    if (!key) return;
    dedupedMap.set(key, t);
  });

  const activeTodayTickets = Array.from(dedupedMap.values()).filter(t => {
    const appDate = getTicketAppointmentDateServer(t);
    if (!appDate || appDate !== dateWIB) return false;

    if (contractorFilter && contractorFilter !== 'ALL') {
      const cName = String(t.contactorName || t.contractorName || '').trim().toLowerCase();
      if (cName !== contractorFilter.trim().toLowerCase()) return false;
    }
    if (areaFilter && areaFilter !== 'ALL') {
      const aName = String(t.area || '').trim().toLowerCase();
      if (aName !== areaFilter.trim().toLowerCase()) return false;
    }
    return true;
  });

  const counts = {
    totalToday: activeTodayTickets.length,
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

  const fieldDispatchCounts = {
    checkIn: 0,
    complete: 0,
    requested: 0,
    reschedule: 0,
    pending: 0,
    cancel: 0
  };

  const vendorMap = new Map<string, any>();
  const areaMap = new Map<string, any>();
  const leaderMap = new Map<string, any>();
  const installerMap = new Map<string, any>();

  activeTodayTickets.forEach(t => {
    const assigned = isTicketAssigned(t);
    const checkedIn = isTicketCheckedIn(t);
    const reportStatus = getTicketCanonicalReportStatus(t);
    const approvalStatus = getTicketCanonicalApprovalStatus(t);
    const closed = isTicketClosed(t);
    const unmapped = isTicketUnmappedDistribution(t);

    if (hasValidHousePhotoCheckIn(t)) fieldDispatchCounts.checkIn++;
    if (reportStatus === 'COMPLETE') fieldDispatchCounts.complete++;
    if (isFieldRequestedWo(t)) fieldDispatchCounts.requested++;
    if (reportStatus === 'RESCHEDULE') fieldDispatchCounts.reschedule++;
    if (reportStatus === 'PENDING') fieldDispatchCounts.pending++;
    if (reportStatus === 'CANCEL') fieldDispatchCounts.cancel++;

    if (assigned) counts.assigned++;
    else counts.unassigned++;

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

    // Vendor Breakdown
    const vendorName = String(t.contactorName || t.contractorName || 'Tanpa Vendor').trim() || 'Tanpa Vendor';
    if (!vendorMap.has(vendorName)) {
      vendorMap.set(vendorName, {
        contractorId: t.contractorId || undefined,
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

    // Area Breakdown
    const areaName = String(t.area || 'Tanpa Area').trim() || 'Tanpa Area';
    if (!areaMap.has(areaName)) {
      areaMap.set(areaName, {
        area: areaName,
        total: 0,
        unassigned: 0,
        checkedInProgress: 0,
        butuhApproval: 0,
        approved: 0,
        closed: 0
      });
    }
    const ab = areaMap.get(areaName);
    ab.total++;
    if (!assigned) ab.unassigned++;
    if (checkedIn && !closed && approvalStatus !== 'APPROVED') ab.checkedInProgress++;
    if (approvalStatus === 'BUTUH APPROVAL') ab.butuhApproval++;
    if (approvalStatus === 'APPROVED') ab.approved++;
    if (closed) ab.closed++;

    // Leader Breakdown
    const leaderName = String(t.leaderName || 'Belum Terdistribusi').trim() || 'Belum Terdistribusi';
    const leaderKey = `${leaderName}::${vendorName}`;
    if (!leaderMap.has(leaderKey)) {
      leaderMap.set(leaderKey, {
        leaderName,
        contractorName: vendorName,
        total: 0,
        unassigned: 0,
        assigned: 0,
        checkedInProgress: 0,
        butuhApproval: 0,
        closed: 0
      });
    }
    const lb = leaderMap.get(leaderKey);
    lb.total++;
    if (assigned) lb.assigned++; else lb.unassigned++;
    if (checkedIn && !closed && approvalStatus !== 'APPROVED') lb.checkedInProgress++;
    if (approvalStatus === 'BUTUH APPROVAL') lb.butuhApproval++;
    if (closed) lb.closed++;

    // Installer Breakdown
    if (assigned) {
      const installerName = String(t.installerName || t.assignedTo || 'Teknisi').trim() || 'Teknisi';
      const instKey = `${installerName}::${vendorName}`;
      if (!installerMap.has(instKey)) {
        installerMap.set(instKey, {
          installerName,
          contractorName: vendorName,
          area: areaName,
          total: 0,
          checkedInProgress: 0,
          butuhApproval: 0,
          approved: 0,
          revisionRejected: 0,
          closed: 0
        });
      }
      const ib = installerMap.get(instKey);
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
    scopeRole,
    contractorFilter: contractorFilter || 'ALL',
    areaFilter: areaFilter || 'ALL',
    counts,
    fieldDispatchCounts,
    byVendor: Array.from(vendorMap.values()).sort((a, b) => b.total - a.total),
    byArea: Array.from(areaMap.values()).sort((a, b) => b.total - a.total),
    byLeader: Array.from(leaderMap.values()).sort((a, b) => b.total - a.total),
    byInstaller: Array.from(installerMap.values()).sort((a, b) => b.total - a.total)
  };
}

export function extractProgressReportHistoryFromTickets(tickets: any[]): any[] {
  const items: any[] = [];
  (tickets || []).forEach(t => {
    if (!t || t.isDeleted) return;
    const reports = Array.isArray(t.progressReports) ? t.progressReports : [];
    const totalVersions = reports.length;

    reports.forEach((rep: any, idx: number) => {
      if (!rep) return;
      const versionNumber = totalVersions - idx;
      const isLatest = idx === 0;
      const repApproval =
        rep.approvalStatus ||
        (isLatest ? t.approvalStatus : undefined) ||
        'BUTUH APPROVAL';
      const canonicalReport = normalizeCanonicalReportStatus(
        rep.reportStatusLabel || rep.reportStatus || t.reportStatusLabel
      );

      items.push({
        id: rep.id || `${t.id}_v${versionNumber}`,
        ticketId: t.id,
        woNumber: t.woNumber || t.workOrderNumber || '',
        appointmentDate: rep.appointmentDate || getTicketAppointmentDateServer(t),
        slotTime: rep.slotTime || t.slotTime || '',
        customerName: t.customerName || '',
        installerName: rep.installerName || rep.submittedBy || t.installerName || '-',
        installerId: rep.submittedById || t.installerId || undefined,
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
          (isLatest && (repApproval === 'APPROVED' ? t.approvedBy : repApproval === 'REJECTED' || repApproval === 'REVISI' ? t.rejectedBy : undefined)),
        dispatchApproverId:
          rep.approvedById ||
          rep.rejectedById ||
          (isLatest && (repApproval === 'APPROVED' ? t.approvedById : t.rejectedById)),
        approvalTimestamp:
          rep.approvedAt ||
          rep.rejectedAt ||
          (isLatest && (repApproval === 'APPROVED' ? t.approvedAt : repApproval === 'REJECTED' || repApproval === 'REVISI' ? t.rejectedAt : undefined)),
        approvalNotes: rep.approvalNotes || (isLatest ? t.approvalNotes : undefined),
        revisionReason: rep.revisionReason || rep.rejectionReason || (isLatest ? t.rejectionReason : undefined),
        finalWoStatus: isTicketClosed(t) && repApproval === 'APPROVED' ? 'CLOSED' : (t.statusWOAgent || 'In Progress')
      });
    });
  });

  return items.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}
