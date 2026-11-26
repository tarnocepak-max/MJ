import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPhotoEvidenceIncompleteErrorMessage,
  evaluatePhotoEvidenceCompleteness,
  isPersistedStoragePhotoUrl,
  isVerifiedPersistedPhotoSlot,
  MANDATORY_PHOTO_SLOT_KEYS
} from './photoEvidenceValidation';
import type { TechnicalPhotoSlot } from '../types/index.ts';

function makeSlot(
  slotKey: TechnicalPhotoSlot['slotKey'],
  overrides: Partial<TechnicalPhotoSlot> = {}
): TechnicalPhotoSlot {
  return {
    id: `evd_${slotKey}`,
    slotKey,
    title: slotKey,
    url: `/api/storage/adapter/download?storagePath=${encodeURIComponent(`technical-reports/WO-123/${slotKey}/photo.jpg`)}&category=technical-reports&woNumber=WO-123`,
    storagePath: `technical-reports/WO-123/${slotKey}/photo.jpg`,
    uploadedAt: '2026-11-26T04:00:00.000Z',
    uploadStatus: 'uploaded',
    ...overrides
  };
}

test('isPersistedStoragePhotoUrl accepts adapter download, public storage, uploads, and http(s) URLs, while rejecting data/blob URIs', () => {
  assert.equal(
    isPersistedStoragePhotoUrl('/api/storage/adapter/download?storagePath=technical-reports%2FWO-1%2Fcustomer_house%2Fa.jpg&category=technical-reports'),
    true
  );
  assert.equal(isPersistedStoragePhotoUrl('/api/storage/public/abc.jpg'), true);
  assert.equal(isPersistedStoragePhotoUrl('/uploads/wo/photo.jpg'), true);
  assert.equal(isPersistedStoragePhotoUrl('https://wiahuupjgpadxqiiarzi.supabase.co/storage/v1/object/sign/abc.jpg'), true);

  assert.equal(isPersistedStoragePhotoUrl('data:image/jpeg;base64,/9j/4AAQ'), false);
  assert.equal(isPersistedStoragePhotoUrl('blob:https://mora-jawskies.vercel.app/123'), false);
  assert.equal(isPersistedStoragePhotoUrl(''), false);
  assert.equal(isPersistedStoragePhotoUrl(undefined), false);
});

test('isVerifiedPersistedPhotoSlot rejects failed, uploading, pending_offline, data URI, and metadata-less slots', () => {
  assert.equal(isVerifiedPersistedPhotoSlot(makeSlot('customer_house')), true);
  assert.equal(isVerifiedPersistedPhotoSlot(makeSlot('customer_house', { uploadStatus: 'failed' })), false);
  assert.equal(isVerifiedPersistedPhotoSlot(makeSlot('customer_house', { uploadStatus: 'uploading' })), false);
  assert.equal(isVerifiedPersistedPhotoSlot(makeSlot('customer_house', { uploadStatus: 'pending_offline' })), false);
  assert.equal(isVerifiedPersistedPhotoSlot(makeSlot('customer_house'), { status: 'uploading' }), false);
  assert.equal(isVerifiedPersistedPhotoSlot(makeSlot('customer_house'), { status: 'failed' }), false);
  assert.equal(
    isVerifiedPersistedPhotoSlot(makeSlot('customer_house', { url: 'data:image/jpeg;base64,/9j/4AAQ' })),
    false
  );
  assert.equal(
    isVerifiedPersistedPhotoSlot(makeSlot('customer_house', { storagePath: undefined, uploadedAt: undefined })),
    false
  );
});

test('evaluatePhotoEvidenceCompleteness tracks mandatory #1, #2, #3 progressively (1/3 -> 2/3 -> 3/3)', () => {
  assert.deepEqual([...MANDATORY_PHOTO_SLOT_KEYS], ['customer_house', 'fat_pole', 'fat_attenuation']);

  const case1 = evaluatePhotoEvidenceCompleteness([makeSlot('customer_house')]);
  assert.equal(case1.mandatoryCount, 1);
  assert.equal(case1.verifiedTotalCount, 1);
  assert.equal(case1.isMandatoryComplete, false);
  assert.deepEqual(case1.missingMandatorySlots.map(s => s.slotKey), ['fat_pole', 'fat_attenuation']);

  const case2 = evaluatePhotoEvidenceCompleteness([makeSlot('customer_house'), makeSlot('fat_pole')]);
  assert.equal(case2.mandatoryCount, 2);
  assert.equal(case2.verifiedTotalCount, 2);
  assert.equal(case2.isMandatoryComplete, false);
  assert.deepEqual(case2.missingMandatorySlots.map(s => s.slotKey), ['fat_attenuation']);

  const case3 = evaluatePhotoEvidenceCompleteness([
    makeSlot('customer_house'),
    makeSlot('fat_pole'),
    makeSlot('fat_attenuation')
  ]);
  assert.equal(case3.mandatoryCount, 3);
  assert.equal(case3.verifiedTotalCount, 3);
  assert.equal(case3.isMandatoryComplete, true);
  assert.equal(case3.missingMandatorySlots.length, 0);
});

test('optional photos (#4-#7) increase total count cleanly after 3/3 but NEVER substitute for a missing mandatory slot', () => {
  // All 3 mandatory + 2 optional -> Mandatory stays 3/3, Total is 5/7
  const completeWithOptionals = evaluatePhotoEvidenceCompleteness({
    customer_house: makeSlot('customer_house'),
    fat_pole: makeSlot('fat_pole'),
    fat_attenuation: makeSlot('fat_attenuation'),
    fat_port: makeSlot('fat_port'),
    opm: makeSlot('opm')
  });
  assert.equal(completeWithOptionals.mandatoryCount, 3);
  assert.equal(completeWithOptionals.optionalCount, 2);
  assert.equal(completeWithOptionals.verifiedTotalCount, 5);
  assert.equal(completeWithOptionals.isMandatoryComplete, true);

  // Only 2 mandatory (#1 & #2) + 2 optional (#4 & #7) = 4 total photos, STILL only 2/3 mandatory!
  const missingMandatory3WithOptionals = evaluatePhotoEvidenceCompleteness([
    makeSlot('customer_house'),
    makeSlot('fat_pole'),
    makeSlot('fat_port'),
    makeSlot('opm')
  ]);
  assert.equal(missingMandatory3WithOptionals.mandatoryCount, 2);
  assert.equal(missingMandatory3WithOptionals.optionalCount, 2);
  assert.equal(missingMandatory3WithOptionals.verifiedTotalCount, 4);
  assert.equal(missingMandatory3WithOptionals.isMandatoryComplete, false);
  assert.deepEqual(missingMandatory3WithOptionals.missingMandatorySlots.map(s => s.slotKey), ['fat_attenuation']);

  const errMsg = buildPhotoEvidenceIncompleteErrorMessage(missingMandatory3WithOptionals);
  assert.match(errMsg, /Bukti Foto Fisik No\. 3/);
  assert.match(errMsg, /Foto Redaman FAT/);
  assert.match(errMsg, /2\/3/);
  assert.match(errMsg, /tidak dapat menggantikan slot foto wajib/i);
});

test('evaluatePhotoEvidenceCompleteness excludes failed/uploading slots even when card holds local data URI preview', () => {
  const mixed = evaluatePhotoEvidenceCompleteness(
    {
      customer_house: makeSlot('customer_house'),
      fat_pole: makeSlot('fat_pole', { uploadStatus: 'failed', url: 'data:image/jpeg;base64,localpreview' }),
      fat_attenuation: makeSlot('fat_attenuation', { uploadStatus: 'uploading', url: 'data:image/jpeg;base64,localpreview' })
    },
    {
      fat_pole: { status: 'failed' },
      fat_attenuation: { status: 'uploading' }
    }
  );
  assert.equal(mixed.mandatoryCount, 1);
  assert.equal(mixed.verifiedTotalCount, 1);
  assert.equal(mixed.isMandatoryComplete, false);
});
