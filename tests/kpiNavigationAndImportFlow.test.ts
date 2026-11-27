import test from 'node:test';
import assert from 'node:assert/strict';

import type { ImportRowErrorRecord, ParsedRowData, Ticket } from '../src/types/index.ts';
import { matchesKpiFilter } from '../src/services/woLifecycleService.ts';
import { evaluateManagementWoQuality } from '../src/components/portals/ManagementDataPortal.tsx';
import { buildRepairParseResultFromErrors } from '../src/services/enterpriseImportService.ts';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: overrides.id || 'tkt-1',
    woNumber: overrides.woNumber || 'WO202600001',
    idCustomer: overrides.idCustomer || '1234567',
    customerId: overrides.customerId || '1234567',
    customerName: overrides.customerName || 'Budi Santoso',
    customerPhone: overrides.customerPhone || '081234567890',
    address: overrides.address || 'Jl. Melati No. 1',
    streetName: overrides.streetName || 'Jl. Melati No. 1',
    clusterName: overrides.clusterName || 'Cluster Melati',
    area: overrides.area || 'Jakarta Selatan',
    fatCode: overrides.fatCode || 'FAT-01',
    fdtCode: overrides.fdtCode || 'FDT-01',
    contactorName: overrides.contactorName ?? 'PT Mitra Jaya',
    contractorName: overrides.contractorName ?? 'PT Mitra Jaya',
    appointmentDate: overrides.appointmentDate ?? '2026-11-27',
    slotTime: overrides.slotTime || '09:00 - 11:00 WIB',
    statusWOAgent: overrides.statusWOAgent || 'In Progress',
    statusWOInstaller: overrides.statusWOInstaller || 'Assigned',
    installerName: overrides.installerName ?? 'Teknisi Andi',
    installerId: overrides.installerId ?? 'inst-1',
    assignedTo: overrides.assignedTo ?? 'inst-1',
    date: overrides.date || '2026-11-27',
    createdAt: overrides.createdAt || '2026-11-27T01:00:00Z',
    updatedAt: overrides.updatedAt || '2026-11-27T02:00:00Z',
    ...overrides
  } as Ticket;
}

test('matchesKpiFilter handles revision_unassigned, kendala_revisi, approval, and field KPI filters accurately', () => {
  const unassignedTicket = makeTicket({
    id: 't-unassigned',
    installerName: '',
    installerId: '',
    assignedTo: '',
    statusWOInstaller: 'Unassigned'
  });

  const revisionTicket = makeTicket({
    id: 't-rev',
    approvalStatus: 'REVISION' as any,
    statusWOInstaller: 'Assigned'
  });

  const waitingApprovalTicket = makeTicket({
    id: 't-wait',
    approvalStatus: 'BUTUH APPROVAL',
    reportStatusLabel: 'COMPLETE',
    technicalReport: {
      mainCategory: 'COMPLETE',
      submittedAt: '2026-11-27T04:00:00Z'
    } as any
  });

  const approvedDoneTicket = makeTicket({
    id: 't-done',
    approvalStatus: 'APPROVED',
    statusWOAgent: 'Done',
    ticketResult: 'Closed',
    reportStatusLabel: 'COMPLETE'
  });

  const pendingTechTicket = makeTicket({
    id: 't-pending-tech',
    statusWOInstaller: 'Pending Technical',
    reportStatusLabel: 'PENDING'
  });

  const validHouseCheckInTicket = makeTicket({
    id: 't-checkin',
    checkInAt: '2026-11-27T03:00:00Z',
    houseLocation: {
      latitude: -6.25,
      longitude: 106.8,
      photoUrl: 'https://example.com/house.jpg'
    } as any,
    technicalReport: {
      photoSlots: [
        {
          slotKey: 'customer_house',
          url: 'https://example.com/house.jpg',
          latitude: -6.25,
          longitude: 106.8,
          geotagStatus: 'verified'
        }
      ]
    } as any
  });

  // revision_unassigned
  assert.equal(matchesKpiFilter(unassignedTicket, 'revision_unassigned'), true);
  assert.equal(matchesKpiFilter(revisionTicket, 'revision_unassigned'), true);
  assert.equal(matchesKpiFilter(approvedDoneTicket, 'revision_unassigned'), false);
  assert.equal(matchesKpiFilter(waitingApprovalTicket, 'revision_unassigned'), false);

  // kendala_revisi
  assert.equal(matchesKpiFilter(revisionTicket, 'kendala_revisi'), true);
  assert.equal(matchesKpiFilter(pendingTechTicket, 'kendala_revisi'), true);
  assert.equal(matchesKpiFilter(waitingApprovalTicket, 'kendala_revisi'), false);
  assert.equal(matchesKpiFilter(approvedDoneTicket, 'kendala_revisi'), false);

  // approval & closed
  assert.equal(matchesKpiFilter(waitingApprovalTicket, 'butuh_approval'), true);
  assert.equal(matchesKpiFilter(approvedDoneTicket, 'butuh_approval'), false);
  assert.equal(matchesKpiFilter(approvedDoneTicket, 'approved'), true);
  assert.equal(matchesKpiFilter(approvedDoneTicket, 'closed'), true);

  // field KPIs
  assert.equal(matchesKpiFilter(validHouseCheckInTicket, 'field_checkin'), true);
  assert.equal(matchesKpiFilter(unassignedTicket, 'field_checkin'), false);
  assert.equal(matchesKpiFilter(waitingApprovalTicket, 'field_complete'), true);
  assert.equal(matchesKpiFilter(pendingTechTicket, 'field_pending'), true);
  assert.equal(matchesKpiFilter(makeTicket({ id: 't-req', checkInAt: undefined, statusWOInstaller: 'Assigned' }), 'field_requested'), true);
  assert.equal(matchesKpiFilter(unassignedTicket, 'total_today'), true);
});

test('evaluateManagementWoQuality computes KPI counts matching Data WO rows 1:1', () => {
  const tickets: Ticket[] = [
    // Valid
    makeTicket({ id: '1', woNumber: 'WO-001', idCustomer: '7654321', appointmentDate: '2026-11-27', statusWOAgent: 'In Progress', statusWOInstaller: 'Assigned' }),
    // Duplicate WO-001 (also problematic, awaiting validation)
    makeTicket({ id: '2', woNumber: 'WO-001', idCustomer: '7654322', appointmentDate: '2026-11-27', statusWOAgent: 'Pending', statusWOInstaller: 'Unassigned' }),
    // Bad Customer ID (not 7 digits) & missing contractor
    makeTicket({ id: '3', woNumber: 'WO-003', idCustomer: '123', customerId: '123', contactorName: '', contractorName: '', appointmentDate: '2026-11-27' }),
    // Missing appointment date (valid 7-digit ID & contractor -> validCount still counts if not problematic, missingAppointmentDateCount increments)
    makeTicket({ id: '4', woNumber: 'WO-004', idCustomer: '7654324', appointmentDate: '' }),
    // Deleted / Archived records must be ignored completely
    makeTicket({ id: '5', woNumber: 'WO-005', isDeleted: true }),
    makeTicket({ id: '6', woNumber: 'WO-006', isArchived: true })
  ];

  const quality = evaluateManagementWoQuality(tickets);

  assert.equal(quality.metrics.total, 4);
  assert.equal(quality.metrics.duplicateCount, 1);
  assert.equal(quality.metrics.problematicCount, 2); // id '2' (duplicate) + id '3' (invalid CID & contractor)
  assert.equal(quality.metrics.validCount, 2); // id '1' + id '4'
  assert.equal(quality.metrics.missingAppointmentDateCount, 1); // id '4'
  assert.equal(quality.metrics.awaitingValidationCount, 1); // id '2'

  assert.equal(quality.flagsById.has('5'), false);
  assert.equal(quality.flagsById.has('6'), false);
  assert.equal(quality.flagsById.get('2')?.isDuplicate, true);
  assert.equal(quality.flagsById.get('3')?.isProblematic, true);
  assert.equal(quality.flagsById.get('4')?.isMissingDate, true);
});

test('buildRepairParseResultFromErrors excludes duplicates/succeeded rows and rehydrates ONLY failed rows without column shift', () => {
  const serverErrors: ImportRowErrorRecord[] = [
    {
      id: 'err-dup',
      jobId: 'job-1',
      rowNumber: 2,
      woNumber: 'WO-DUP-1',
      errorCode: 'WO_DUPLICATE',
      errorMessage: 'Duplikat WO Number',
      rawPayload: {
        raw: {
          'WO Number': 'WO-DUP-1',
          'ID Customer': '1111111',
          'Customer Name': 'Duplicate User',
          'Area': 'Jakarta Barat',
          'Appointment Date': '2026-11-27'
        }
      },
      createdAt: '2026-11-27T05:00:00Z'
    },
    {
      id: 'err-fail-1',
      jobId: 'job-1',
      rowNumber: 3,
      woNumber: 'WO2026FAIL1',
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'ID Customer harus 7 digit angka',
      rawPayload: {
        raw: {
          'WO Number': 'WO2026FAIL1',
          'ID Customer': '123',
          'Customer Name': 'Ani',
          'Customer Phone': '081200001111',
          'Street Name': 'Jl. Mawar',
          'Cluster Name': 'Mawar Indah',
          'FAT Code': 'FAT-01',
          'FDT Code': 'FDT-01',
          'Contactor Name': 'PT Mitra Test',
          'Area': 'Jakarta Selatan',
          'Appointment Date': '2026-11-27',
          'Extra Col': ''
        }
      },
      createdAt: '2026-11-27T05:00:00Z'
    },
    {
      id: 'err-fail-2',
      jobId: 'job-1',
      rowNumber: 4,
      woNumber: 'WO2026FAIL2',
      errorCode: 'BATCH_PERSIST_ERROR',
      errorMessage: 'Timeout insert row',
      rawPayload: {
        mapped: {
          woNumber: 'WO2026FAIL2',
          idCustomer: '7654321',
          customerName: 'Budi',
          customerPhone: '081200002222',
          streetName: 'Jl. Anggrek',
          clusterName: 'Anggrek',
          fatCode: 'FAT-02',
          fdtCode: 'FDT-02',
          contactorName: 'PT Mitra Test',
          area: 'Jakarta Timur',
          appointmentDate: '2026-11-28',
          slotTime: '13:00 - 15:00 WIB'
        }
      },
      createdAt: '2026-11-27T05:00:00Z'
    }
  ];

  const localFailedRows: ParsedRowData[] = [
    // Valid local row must be ignored
    {
      rowIndex: 0,
      raw: { 'WO Number': 'WO-OK-1' },
      mapped: { woNumber: 'WO-OK-1' } as any,
      isValid: true,
      isDuplicate: false,
      validationErrors: [],
      unrecognizedColumns: []
    },
    // Duplicate local row must be skipped
    {
      rowIndex: 1,
      raw: { 'WO Number': 'WO-DUP-LOCAL' },
      mapped: { woNumber: 'WO-DUP-LOCAL' } as any,
      isValid: false,
      isDuplicate: true,
      statusType: 'WO DUPLIKAT',
      validationErrors: ['WO sudah ada'],
      unrecognizedColumns: []
    },
    // Local failed row not on server must be included
    {
      rowIndex: 5,
      raw: {
        'WO Number': 'WO2026LOCL3',
        'ID Customer': '99',
        'Customer Name': 'Citra',
        'Customer Phone': '081200003333',
        'Street Name': 'Jl. Kenanga',
        'Cluster Name': 'Kenanga',
        'FAT Code': 'FAT-03',
        'FDT Code': 'FDT-03',
        'Contactor Name': 'PT Mitra Test',
        'Area': 'Depok',
        'Appointment Date': '2026-11-29'
      },
      mapped: { woNumber: 'WO2026LOCL3' } as any,
      isValid: false,
      isDuplicate: false,
      validationErrors: ['Customer ID kurang dari 7 digit'],
      unrecognizedColumns: []
    }
  ];

  const repaired = buildRepairParseResultFromErrors({
    serverErrors,
    localFailedRows,
    existingWoNumbers: ['WO-EXISTING-999'],
    contractors: [],
    coverageAreas: []
  });

  assert.equal(repaired.skippedDuplicateCount, 2); // 1 server WO_DUPLICATE + 1 local duplicate
  assert.equal(repaired.rehydratedCount, 3); // WO2026FAIL1, WO2026FAIL2, WO2026LOCL3 only
  const woNumbers = repaired.parseResult.parsedRows.map(r => r.mapped.woNumber);
  assert.deepEqual(woNumbers, ['WO2026FAIL1', 'WO2026FAIL2', 'WO2026LOCL3']);

  // Empty values must stay empty and never shift into neighboring columns
  const row1 = repaired.parseResult.parsedRows[0];
  assert.equal(row1.raw['Extra Col'], '');
  assert.equal(row1.mapped.area, 'Jakarta Selatan');

  // Row 2 has valid mandatory fields -> ready to import immediately after repair
  const row2 = repaired.parseResult.parsedRows[1];
  assert.equal(row2.isValid, true);
  assert.equal(row2.mapped.slotTime, '13:00 - 15:00 WIB');
});
