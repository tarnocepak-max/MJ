import assert from 'node:assert/strict';
import {
  computeKpiSummary,
  matchesKpiFilter as matchesServerKpiFilter,
  extractProgressReportHistoryFromTickets,
  normalizeCanonicalReportStatus,
  getTicketCanonicalReportStatus,
  getTicketCanonicalApprovalStatus,
  isTicketClosed,
  type WOKpiFilterKey
} from '../server/woLifecycleService';
import {
  computeClientKpiSummary,
  matchesKpiFilter as matchesClientKpiFilter,
  extractProgressReportHistoryClient,
  scopeTicketsForRoleClient
} from '../src/services/woLifecycleService';
import type { Ticket, User } from '../src/types';

const TODAY_WIB = '2026-11-16';
const TOMORROW_WIB = '2026-11-17';
const YESTERDAY_WIB = '2026-11-15';

function makeTicket(partial: Partial<Ticket> & { id: string; woNumber: string }): Ticket {
  return {
    id: partial.id,
    woNumber: partial.woNumber,
    workOrderNumber: partial.woNumber,
    idCustomer: `CUST-${partial.id}`,
    customerName: partial.customerName || `Customer ${partial.id}`,
    customerPhone: '08123456789',
    streetName: 'Jl. Telekomunikasi No. 1',
    clusterName: 'Cluster Alpha',
    area: partial.area || 'Jakarta Selatan',
    contactorName: partial.contactorName || 'PT Mora Mitra A',
    contractorName: partial.contractorName || partial.contactorName || 'PT Mora Mitra A',
    ticketCategory: 'New Installation',
    date: partial.date ?? partial.appointmentDate ?? TODAY_WIB,
    appointmentDate: partial.appointmentDate ?? TODAY_WIB,
    slotTime: '09:00 - 11:00',
    statusWhatsApp: 'confirmed',
    statusWOAgent: partial.statusWOAgent || 'Assigned',
    statusWOInstaller: partial.statusWOInstaller || 'Assigned',
    isArchived: false,
    createdAt: '2026-11-16T01:00:00.000Z',
    updatedAt: '2026-11-16T02:00:00.000Z',
    ...partial
  };
}

// Construct comprehensive test dataset spanning all lifecycle stages & dates
const sampleTickets: Ticket[] = [
  // 1. Today unassigned & unmapped distribution
  makeTicket({
    id: 't1',
    woNumber: 'WO-1001',
    area: 'Jakarta Selatan',
    contactorName: 'PT Mora Mitra A',
    leaderName: '',
    distributionStatus: 'unmapped_leader',
    installerName: '',
    statusWOInstaller: 'Unassigned',
    statusWOAgent: 'Pending'
  }),
  // 2. Today assigned, not checked in yet
  makeTicket({
    id: 't2',
    woNumber: 'WO-1002',
    area: 'Jakarta Selatan',
    contactorName: 'PT Mora Mitra A',
    leaderName: 'Leader Alpha',
    distributionStatus: 'distributed',
    installerName: 'Teknisi Budi',
    installerId: 'inst-1',
    assignedTo: 'inst-1',
    statusWOInstaller: 'Assigned'
  }),
  // 3. Today checked-in (LiveChat PROGRESS) in progress, no report yet
  makeTicket({
    id: 't3',
    woNumber: 'WO-1003',
    area: 'Jakarta Barat',
    contactorName: 'PT Mora Mitra B',
    leaderName: 'Leader Beta',
    distributionStatus: 'distributed',
    installerName: 'Teknisi Citra',
    installerId: 'inst-2',
    assignedTo: 'inst-2',
    checkInAt: '2026-11-16T03:05:00.000Z',
    statusWOInstaller: 'In Progress'
  }),
  // 4. Today report PENDING + BUTUH APPROVAL
  makeTicket({
    id: 't4',
    woNumber: 'WO-1004',
    area: 'Jakarta Selatan',
    contactorName: 'PT Mora Mitra A',
    leaderName: 'Leader Alpha',
    distributionStatus: 'distributed',
    installerName: 'Teknisi Budi',
    installerId: 'inst-1',
    assignedTo: 'inst-1',
    checkInAt: '2026-11-16T02:10:00.000Z',
    checkOutAt: '2026-11-16T03:10:00.000Z',
    statusWOInstaller: 'Pending Technical',
    reportStatusLabel: 'PENDING',
    approvalStatus: 'BUTUH APPROVAL',
    progressReports: [
      {
        id: 'rep-t4-v1',
        ticketId: 't4',
        timestamp: '2026-11-16T03:10:00.000Z',
        submittedBy: 'Teknisi Budi',
        userRole: 'installer',
        reportStatus: 'PENDING',
        reportStatusLabel: 'PENDING',
        reasonReport: 'Kendala Tiang',
        rootCause: 'Menunggu Izin',
        remarksReport: 'Perlu izin RT setempat',
        installerName: 'Teknisi Budi',
        appointmentDate: TODAY_WIB
      }
    ]
  }),
  // 5. Today report COMPLETE + APPROVED -> AUTO CLOSED
  makeTicket({
    id: 't5',
    woNumber: 'WO-1005',
    area: 'Jakarta Selatan',
    contactorName: 'PT Mora Mitra A',
    leaderName: 'Leader Alpha',
    distributionStatus: 'distributed',
    installerName: 'Teknisi Budi',
    installerId: 'inst-1',
    assignedTo: 'inst-1',
    checkInAt: '2026-11-16T01:30:00.000Z',
    checkOutAt: '2026-11-16T02:45:00.000Z',
    statusWOInstaller: 'Completed',
    statusWOAgent: 'Closed',
    reportStatusLabel: 'COMPLETE',
    approvalStatus: 'APPROVED',
    approvedBy: 'Dispatch Dani',
    approvedAt: '2026-11-16T02:50:00.000Z',
    closedAt: '2026-11-16T02:50:00.000Z',
    progressReports: [
      {
        id: 'rep-t5-v1',
        ticketId: 't5',
        timestamp: '2026-11-16T02:45:00.000Z',
        submittedBy: 'Teknisi Budi',
        userRole: 'installer',
        reportStatus: 'COMPLETE',
        reportStatusLabel: 'COMPLETE',
        reasonReport: 'Instalasi Berhasil',
        rootCause: 'Normal',
        remarksReport: 'Redaman -17 dBm normal',
        approvalStatus: 'APPROVED',
        approvedBy: 'Dispatch Dani',
        approvedAt: '2026-11-16T02:50:00.000Z',
        installerName: 'Teknisi Budi',
        appointmentDate: TODAY_WIB
      }
    ]
  }),
  // 6. Today report RESCHEDULE + APPROVED -> AUTO CLOSED (preserving original reportStatus RESCHEDULE!)
  makeTicket({
    id: 't6',
    woNumber: 'WO-1006',
    area: 'Jakarta Barat',
    contactorName: 'PT Mora Mitra B',
    leaderName: 'Leader Beta',
    distributionStatus: 'distributed',
    installerName: 'Teknisi Citra',
    installerId: 'inst-2',
    assignedTo: 'inst-2',
    checkInAt: '2026-11-16T01:40:00.000Z',
    checkOutAt: '2026-11-16T02:00:00.000Z',
    statusWOInstaller: 'Pending Technical',
    statusWOAgent: 'Closed',
    reportStatusLabel: 'RESCHEDULE',
    approvalStatus: 'APPROVED',
    approvedBy: 'Dispatch Dani',
    approvedAt: '2026-11-16T02:15:00.000Z',
    closedAt: '2026-11-16T02:15:00.000Z',
    progressReports: [
      {
        id: 'rep-t6-v1',
        ticketId: 't6',
        timestamp: '2026-11-16T02:00:00.000Z',
        submittedBy: 'Teknisi Citra',
        userRole: 'installer',
        reportStatus: 'RESCHEDULE',
        reportStatusLabel: 'RESCHEDULE',
        reasonReport: 'Customer Request',
        rootCause: 'Rumah Kosong',
        remarksReport: 'Pelanggan minta reschedule',
        approvalStatus: 'APPROVED',
        approvedBy: 'Dispatch Dani',
        approvedAt: '2026-11-16T02:15:00.000Z',
        installerName: 'Teknisi Citra',
        appointmentDate: TODAY_WIB
      }
    ]
  }),
  // 7. Today report CANCEL + REVISION (v1 rejected by Dispatch, v2 revision requested)
  makeTicket({
    id: 't7',
    woNumber: 'WO-1007',
    area: 'Jakarta Selatan',
    contactorName: 'PT Mora Mitra A',
    leaderName: 'Leader Alpha',
    distributionStatus: 'distributed',
    installerName: 'Teknisi Budi',
    installerId: 'inst-1',
    assignedTo: 'inst-1',
    checkInAt: '2026-11-16T01:15:00.000Z',
    checkOutAt: '2026-11-16T01:55:00.000Z',
    statusWOInstaller: 'Failed / Cancelled',
    reportStatusLabel: 'CANCEL',
    approvalStatus: 'REJECTED',
    rejectedBy: 'Dispatch Dani',
    rejectedAt: '2026-11-16T02:05:00.000Z',
    rejectionReason: 'Foto bukti rumah kosong belum dilampirkan di LiveChat',
    progressReports: [
      {
        id: 'rep-t7-v2',
        ticketId: 't7',
        timestamp: '2026-11-16T01:55:00.000Z',
        submittedBy: 'Teknisi Budi',
        userRole: 'installer',
        reportStatus: 'CANCEL',
        reportStatusLabel: 'CANCEL',
        reasonReport: 'Batal Pasang',
        rootCause: 'Customer Cancel',
        remarksReport: 'Pelanggan membatalkan pemasangan',
        approvalStatus: 'REJECTED',
        rejectedBy: 'Dispatch Dani',
        rejectedAt: '2026-11-16T02:05:00.000Z',
        revisionReason: 'Foto bukti rumah kosong belum dilampirkan di LiveChat',
        installerName: 'Teknisi Budi',
        appointmentDate: TODAY_WIB
      },
      {
        id: 'rep-t7-v1',
        ticketId: 't7',
        timestamp: '2026-11-16T01:35:00.000Z',
        submittedBy: 'Teknisi Budi',
        userRole: 'installer',
        reportStatus: 'PENDING',
        reportStatusLabel: 'PENDING',
        reasonReport: 'Customer Tidak Ditempat',
        rootCause: 'Tidak Terhubung',
        remarksReport: 'Menunggu konfirmasi awal',
        approvalStatus: 'REJECTED',
        rejectedBy: 'Dispatch Dani',
        rejectedAt: '2026-11-16T01:45:00.000Z',
        revisionReason: 'Konfirmasi ulang status pembatalan dengan pelanggan',
        installerName: 'Teknisi Budi',
        appointmentDate: TODAY_WIB
      }
    ]
  }),
  // 8. Tomorrow WO (MUST NOT leak into TODAY_WIB KPI!)
  makeTicket({
    id: 't8',
    woNumber: 'WO-1008',
    appointmentDate: TOMORROW_WIB,
    contactorName: 'PT Mora Mitra A',
    leaderName: 'Leader Alpha',
    distributionStatus: 'distributed',
    installerName: 'Teknisi Budi',
    installerId: 'inst-1',
    assignedTo: 'inst-1'
  }),
  // 9. Backlog / Yesterday WO (MUST NOT leak into TODAY_WIB KPI!)
  makeTicket({
    id: 't9',
    woNumber: 'WO-1009',
    appointmentDate: YESTERDAY_WIB,
    contactorName: 'PT Mora Mitra A',
    leaderName: 'Leader Alpha',
    distributionStatus: 'distributed',
    installerName: 'Teknisi Budi',
    installerId: 'inst-1',
    assignedTo: 'inst-1'
  })
];

console.log('Running MoraJaws WO Lifecycle Verification Suite...\n');

// 1. Canonical status normalization assertions
assert.equal(normalizeCanonicalReportStatus('PENDING'), 'PENDING');
assert.equal(normalizeCanonicalReportStatus('Pending Technical'), 'PENDING');
assert.equal(normalizeCanonicalReportStatus('COMPLETE'), 'COMPLETE');
assert.equal(normalizeCanonicalReportStatus('Completed'), 'COMPLETE');
assert.equal(normalizeCanonicalReportStatus('Installed'), 'COMPLETE');
assert.equal(normalizeCanonicalReportStatus('RESCHEDULE'), 'RESCHEDULE');
assert.equal(normalizeCanonicalReportStatus('Failed / Cancelled'), 'CANCEL');

assert.equal(getTicketCanonicalReportStatus(sampleTickets[5]), 'RESCHEDULE');
assert.equal(getTicketCanonicalApprovalStatus(sampleTickets[5]), 'APPROVED');
assert.equal(isTicketClosed(sampleTickets[5]), true, 'Approved RESCHEDULE must auto-close WO');
assert.equal(getTicketCanonicalApprovalStatus(sampleTickets[6]), 'REVISION');
assert.equal(isTicketClosed(sampleTickets[6]), false, 'Rejected/Revision report must keep WO open');

// 2. Server vs Client KPI Summary parity & WIB date isolation
const superAdminUser: User = {
  id: 'sa-1',
  username: 'superadmin',
  name: 'Super Admin',
  role: 'super_admin',
  active: true
};

const serverSummary = computeKpiSummary(sampleTickets, {
  dateWIB: TODAY_WIB,
  scopeRole: 'super_admin'
});
const clientSummary = computeClientKpiSummary(sampleTickets, superAdminUser, {
  dateWIB: TODAY_WIB
});

assert.deepEqual(serverSummary.counts, clientSummary.counts, 'Server and Client KPI counts must match identically');
assert.equal(serverSummary.counts.totalToday, 7, 'Future & backlog WOs must be excluded from today WIB count');
assert.equal(serverSummary.counts.unassigned, 1);
assert.equal(serverSummary.counts.assigned, 6);
assert.equal(serverSummary.counts.notCheckedIn, 2); // t1 + t2
assert.equal(serverSummary.counts.checkedInProgress, 3); // t3, t4, t7 (not closed & not approved)
assert.equal(serverSummary.counts.reportPending, 1);
assert.equal(serverSummary.counts.reportComplete, 1);
assert.equal(serverSummary.counts.reportReschedule, 1);
assert.equal(serverSummary.counts.reportCancel, 1);
assert.equal(serverSummary.counts.butuhApproval, 1);
assert.equal(serverSummary.counts.approved, 2);
assert.equal(serverSummary.counts.revisionRejected, 1);
assert.equal(serverSummary.counts.closed, 2);
assert.equal(serverSummary.counts.unmappedDistribution, 1);

// 3. Invariant: Every KPI count === matchesKpiFilter(todayTickets, key).length on BOTH server and client
const todayTickets = sampleTickets.filter(t => t.appointmentDate === TODAY_WIB);
const filterToCountField: Array<[WOKpiFilterKey, keyof typeof serverSummary.counts]> = [
  ['total_today', 'totalToday'],
  ['unassigned', 'unassigned'],
  ['assigned', 'assigned'],
  ['not_checked_in', 'notCheckedIn'],
  ['checked_in_progress', 'checkedInProgress'],
  ['report_pending', 'reportPending'],
  ['report_complete', 'reportComplete'],
  ['report_reschedule', 'reportReschedule'],
  ['report_cancel', 'reportCancel'],
  ['butuh_approval', 'butuhApproval'],
  ['approved', 'approved'],
  ['revision_rejected', 'revisionRejected'],
  ['closed', 'closed'],
  ['unmapped_distribution', 'unmappedDistribution']
];

for (const [filterKey, countField] of filterToCountField) {
  const srvMatches = todayTickets.filter(t => matchesServerKpiFilter(t, filterKey)).length;
  const cliMatches = todayTickets.filter(t => matchesClientKpiFilter(t, filterKey)).length;
  assert.equal(srvMatches, serverSummary.counts[countField], `Server drill-down mismatch for ${filterKey}`);
  assert.equal(cliMatches, clientSummary.counts[countField], `Client drill-down mismatch for ${filterKey}`);
}

// 4. Vendor Breakdown & Contractor Scope Filtering
assert.equal(serverSummary.byVendor.length, 2);
const mitraA = serverSummary.byVendor.find(v => v.contractorName === 'PT Mora Mitra A');
assert.ok(mitraA);
assert.equal(mitraA.total, 5);

const filteredMitraB = computeClientKpiSummary(sampleTickets, superAdminUser, {
  dateWIB: TODAY_WIB,
  contractorFilter: 'PT Mora Mitra B'
});
assert.equal(filteredMitraB.counts.totalToday, 2);

// 5. All 6 Role RBAC Scoping checks
const roleGlobalUsers: User[] = [
  superAdminUser,
  { id: 'disp-1', username: 'dispatch1', name: 'Dispatch Dani', role: 'dispatch', active: true },
  { id: 'md-1', username: 'mdata', name: 'Data Analyst', role: 'management_data', active: true },
  { id: 'it-1', username: 'itsup', name: 'IT Support', role: 'it_support', active: true }
];
for (const u of roleGlobalUsers) {
  const scoped = scopeTicketsForRoleClient(sampleTickets, u);
  assert.equal(scoped.length, sampleTickets.length, `${u.role} should see all tickets`);
}

const leaderUser: User = {
  id: 'lead-1',
  username: 'leadalpha',
  name: 'Leader Alpha',
  role: 'leader',
  contractor: 'PT Mora Mitra A',
  area: 'Jakarta Selatan',
  active: true
};
const leaderScoped = scopeTicketsForRoleClient(sampleTickets, leaderUser);
assert.equal(
  leaderScoped.every(t => (t.contactorName || '').includes('Mitra A')),
  true,
  'Leader must only see tickets within their Contractor scope'
);
assert.equal(
  leaderScoped.some(t => t.id === 't3' || t.id === 't6'),
  false,
  'Leader must NOT see PT Mora Mitra B tickets'
);

const installerUser: User = {
  id: 'inst-1',
  username: 'budi',
  name: 'Teknisi Budi',
  role: 'installer',
  contractor: 'PT Mora Mitra A',
  active: true
};
const installerScoped = scopeTicketsForRoleClient(sampleTickets, installerUser);
assert.equal(
  installerScoped.every(t => t.installerId === 'inst-1' || t.installerName === 'Teknisi Budi'),
  true,
  'Installer must only see own assigned tickets'
);
assert.equal(
  installerScoped.some(t => t.id === 't1' || t.id === 't3'),
  false,
  'Installer must NOT see unassigned or other installer tickets'
);

// 6. Append-only History Progress Report extraction & version retention
const serverHistory = extractProgressReportHistoryFromTickets(sampleTickets);
const clientHistory = extractProgressReportHistoryClient(sampleTickets);
assert.equal(serverHistory.length, 5, 'Should extract all 5 report versions across t4, t5, t6, t7(v2+v1)');
assert.equal(clientHistory.length, 5);

const t7Versions = serverHistory.filter(h => h.ticketId === 't7');
assert.equal(t7Versions.length, 2, 'Both v1 and v2 of t7 must remain preserved (append-only)');
assert.equal(t7Versions[0].versionNumber, 2);
assert.equal(t7Versions[1].versionNumber, 1);
assert.equal(t7Versions[0].reportStatus, 'CANCEL');
assert.equal(t7Versions[1].reportStatus, 'PENDING');

const t6History = serverHistory.find(h => h.ticketId === 't6');
assert.ok(t6History);
assert.equal(t6History.reportStatus, 'RESCHEDULE', 'Original RESCHEDULE reportStatus must remain intact after approval');
assert.equal(t6History.approvalStatus, 'APPROVED');
assert.equal(t6History.finalWoStatus, 'CLOSED', 'Approved RESCHEDULE must record finalWoStatus CLOSED');

console.log('ALL ASSERTIONS PASSED SUCCESSFULLY:');
console.log(`- Normalized status checks: PASS`);
console.log(`- Server vs Client KPI parity (14 filter invariants): PASS`);
console.log(`- WIB Operational Date isolation (Today vs Future vs Backlog): PASS`);
console.log(`- 6-Role RBAC & Vendor/Contractor scope isolation: PASS`);
console.log(`- Append-only History Progress Report versioning & RESCHEDULE -> APPROVED -> CLOSED: PASS`);
