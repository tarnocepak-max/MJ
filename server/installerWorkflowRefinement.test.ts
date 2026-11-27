import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePhotoEvidenceCompleteness,
  evaluateReportPhotoEvidenceRequirement,
  MIN_COMPLETED_PHOTO_EVIDENCE,
  MIN_UNSUCCESS_PHOTO_EVIDENCE
} from '../src/utils/photoEvidenceValidation.ts';
import { resolveUnsuccessCategories } from '../src/utils/fullviewWorkflow.ts';
import { validateHierarchicalDroplistSelection } from '../src/utils/hierarchicalValidation.ts';
import { INITIAL_HIERARCHICAL_DROPLISTS } from '../src/constants/hierarchicalDroplists.ts';
import type { TechnicalPhotoSlot } from '../src/types/index.ts';
import { computeSlaTelemetryPayload, DEFAULT_SLA_THRESHOLD_CONFIG } from './slaTelemetryService.ts';
import { isTicketCheckedIn } from './woLifecycleService.ts';

function makeValidSlot(
  slotKey: TechnicalPhotoSlot['slotKey'],
  override: Partial<TechnicalPhotoSlot> = {}
): TechnicalPhotoSlot {
  return {
    id: `evd_${slotKey}`,
    slotKey,
    title: slotKey,
    url: `/api/storage/public/wo_photo_evidence/${slotKey}.jpg`,
    storagePath: `wo_photo_evidence/${slotKey}.jpg`,
    capturedAt: '10:00:00',
    uploadedAt: '2026-11-28T03:00:00.000Z',
    uploadStatus: 'uploaded',
    ...override
  };
}

test('Photo evidence validation enforces 3 mandatory for COMPLETE and 4 valid total (3 mandatory + >=1 optional) for UNSUCCESS', () => {
  const threeMandatory = [
    makeValidSlot('customer_house'),
    makeValidSlot('fat_pole'),
    makeValidSlot('fat_attenuation')
  ];

  // Completed passes with 3 mandatory
  const complete3 = evaluateReportPhotoEvidenceRequirement(threeMandatory, 'COMPLETE');
  assert.equal(complete3.isReady, true);
  assert.equal(complete3.requiredTotalCount, MIN_COMPLETED_PHOTO_EVIDENCE);

  // Unsuccess fails with only 3 mandatory
  for (const status of ['PENDING', 'RESCHEDULE', 'CANCEL']) {
    const res = evaluateReportPhotoEvidenceRequirement(threeMandatory, status);
    assert.equal(res.isReady, false, `${status} must fail with only 3 mandatory`);
    assert.equal(res.requiredTotalCount, MIN_UNSUCCESS_PHOTO_EVIDENCE);
    assert.match(res.errorMessage, /minimal 4 foto evidence/i);
  }

  // 2 mandatory + 2 optional fails for Unsuccess AND Completed
  const twoMandTwoOpt = [
    makeValidSlot('customer_house'),
    makeValidSlot('fat_pole'),
    makeValidSlot('fat_port'),
    makeValidSlot('opm')
  ];
  const failTwoMand = evaluateReportPhotoEvidenceRequirement(twoMandTwoOpt, 'PENDING');
  assert.equal(failTwoMand.isReady, false);
  assert.equal(failTwoMand.evaluation.isMandatoryComplete, false);
  assert.equal(failTwoMand.evaluation.verifiedTotalCount, 4);

  // 3 mandatory + 1 optional passes for Unsuccess
  const threeMandOneOpt = [...threeMandatory, makeValidSlot('opm')];
  for (const status of ['PENDING', 'RESCHEDULE', 'CANCEL']) {
    const passRes = evaluateReportPhotoEvidenceRequirement(threeMandOneOpt, status);
    assert.equal(passRes.isReady, true, `${status} must pass with 3 mandatory + 1 optional`);
    assert.equal(passRes.evaluation.verifiedTotalCount, 4);
  }

  // Duplicate slots are deduplicated and do NOT inflate count to 4
  const duplicateSlots = [
    ...threeMandatory,
    makeValidSlot('customer_house', { id: 'dup', uploadedAt: '2026-11-28T03:05:00.000Z' })
  ];
  const dupRes = evaluateReportPhotoEvidenceRequirement(duplicateSlots, 'PENDING');
  assert.equal(dupRes.evaluation.verifiedTotalCount, 3);
  assert.equal(dupRes.isReady, false);

  // Unuploaded / local data URI / pending_offline / uploading / failed optional photo is NOT counted
  const unuploadedOptional = [
    ...threeMandatory,
    makeValidSlot('fat_port', { url: 'data:image/jpeg;base64,AAA', uploadStatus: 'pending_offline' })
  ];
  const unuploadedRes = evaluateReportPhotoEvidenceRequirement(unuploadedOptional, 'CANCEL');
  assert.equal(unuploadedRes.isReady, false);

  const uploadingRuntimeRes = evaluateReportPhotoEvidenceRequirement(
    threeMandOneOpt,
    'RESCHEDULE',
    { opm: { status: 'uploading' } }
  );
  assert.equal(uploadingRuntimeRes.isReady, false);

  // Chat attachment with unknown slotKey is excluded
  const withChatAttachment = [
    ...threeMandatory,
    makeValidSlot('chat_attachment' as any, { slotKey: 'chat_attachment' as any })
  ];
  const chatRes = evaluatePhotoEvidenceCompleteness(withChatAttachment);
  assert.equal(chatRes.verifiedTotalCount, 3);
});

test('Unsuccess categories strictly exclude standalone kendala and contain only pending, reschedule, cancel', () => {
  const categories = resolveUnsuccessCategories(INITIAL_HIERARCHICAL_DROPLISTS);
  assert.deepEqual(
    categories.map(c => c.key),
    ['pending', 'reschedule', 'cancel']
  );
  const pending = categories.find(c => c.key === 'pending');
  assert.ok(pending);
  assert.ok(pending.reasons.length > 0, 'Pending must contain configured kendala reasons');
});

test('Hierarchical droplist validation verifies L1, L2, active flag, and strict parent-child relationship', () => {
  const ok = validateHierarchicalDroplistSelection({
    statuses: INITIAL_HIERARCHICAL_DROPLISTS,
    reportStatusId: 'hs-pending',
    reportStatusLabel: 'PENDING',
    reasonReportId: 'hr-p1',
    reasonReportLabel: 'Kendala Redaman Tinggi / LOS'
  });
  assert.equal(ok.valid, true);

  // Mismatched parent-child (COMPLETE status with PENDING reason) must fail
  const mismatch = validateHierarchicalDroplistSelection({
    statuses: INITIAL_HIERARCHICAL_DROPLISTS,
    reportStatusId: 'hs-complete',
    reportStatusLabel: 'COMPLETE',
    reasonReportId: 'hr-p1',
    reasonReportLabel: 'Kendala Redaman Tinggi / LOS'
  });
  assert.equal(mismatch.valid, false);
  if (!mismatch.valid) {
    assert.equal(mismatch.code, 'INVALID_REASON_PARENT_CHILD');
  }

  // Inactive L1 status must fail
  const inactiveL1 = validateHierarchicalDroplistSelection({
    statuses: INITIAL_HIERARCHICAL_DROPLISTS,
    reportStatusId: 'hs-onsite',
    reasonReportId: 'hr-os1'
  });
  assert.equal(inactiveL1.valid, false);
  if (!inactiveL1.valid) {
    assert.equal(inactiveL1.code, 'INACTIVE_REPORT_STATUS');
  }
});

test('Check-in KPI and lifecycle do NOT treat LiveChat #PROGRESS message alone as Check-In', () => {
  const unCheckedTicket: any = {
    id: 'wo-1',
    woNumber: 'WO-1001',
    appointmentDate: '2026-11-28',
    contractorId: 'c1',
    contractorName: 'Mitra Test',
    area: 'Jakarta',
    statusWOInstaller: 'Assigned',
    statusWOAgent: 'In Progress',
    workSessionStatus: 'Belum Check-in'
  };

  assert.equal(isTicketCheckedIn(unCheckedTicket), false);

  const telemetry = computeSlaTelemetryPayload({
    tickets: [unCheckedTicket],
    contractors: [{ id: 'c1', name: 'Mitra Test', active: true } as any],
    coverageAreas: [{ id: 'a1', name: 'Jakarta', active: true } as any],
    users: [],
    ticketMessages: [
      {
        id: 'msg-1',
        ticketId: 'wo-1',
        woNumber: 'WO-1001',
        senderId: 'inst-1',
        senderName: 'Teknisi',
        senderRole: 'installer',
        text: 'OTW lokasi',
        category: 'PROGRESS',
        timestamp: '2026-11-28T02:00:00.000Z'
      } as any
    ],
    operationalDateWIB: '2026-11-28',
    period: 'today',
    config: DEFAULT_SLA_THRESHOLD_CONFIG,
    configVersion: 1,
    isConfigPersistedInDb: true,
    databaseSource: 'supabase',
    nowMs: Date.parse('2026-11-28T03:00:00.000Z')
  });

  const checkInMetric = telemetry.operationalMatrix.find(m => m.id === 'livechat_checkin');
  assert.ok(checkInMetric);
  assert.equal(checkInMetric.passedCount, 0, 'PROGRESS message alone must NOT count as Check-In KPI');
});
