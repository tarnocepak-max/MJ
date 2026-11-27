import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractCustomerContacts,
  extractLocationExtraMeta,
  formatFullviewTimeValue,
  resolveCompletedStatusHierarchy,
  resolveUnsuccessCategories
} from '../src/utils/fullviewWorkflow.ts';
import { INITIAL_HIERARCHICAL_DROPLISTS } from '../src/services/supabaseConfigService.ts';
import { formatInstallerStatusDisplay } from '../src/components/common/Badge.tsx';
import { evaluatePhotoEvidenceCompleteness } from '../src/utils/photoEvidenceValidation.ts';
import type { HierarchicalStatus, Ticket } from '../src/types/index.ts';
import { createEmptyPhotoSlotsMap } from '../src/components/portals/fullview/types.ts';

test('extractCustomerContacts deduplicates real customer numbers and ignores placeholders', () => {
  const ticket: Partial<Ticket> = {
    woNumber: 'WO-2026-0001',
    customerName: 'Budi Santoso',
    customerPhone: '0812-3456-7890',
    customerContact1: '+62 812 3456 7890', // duplicate of customerPhone
    customerContact2: '081398765432',
    customerContact3: 'N/A'
  };

  const contacts = extractCustomerContacts(ticket);
  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].raw, '0812-3456-7890');
  assert.equal(contacts[0].telHref, 'tel:081234567890');
  assert.ok(contacts[0].waUrl.includes('https://wa.me/'));
  assert.equal(contacts[1].raw, '081398765432');
  assert.equal(contacts[1].label, 'Kontak 2');

  assert.deepEqual(extractCustomerContacts({ customerPhone: '-', customerContact1: 'kosong' }), []);
  assert.deepEqual(extractCustomerContacts(null), []);
});

test('resolveCompletedStatusHierarchy resolves active COMPLETE statuses from INITIAL_HIERARCHICAL_DROPLISTS without inventing IDs', () => {
  const res = resolveCompletedStatusHierarchy(INITIAL_HIERARCHICAL_DROPLISTS);
  assert.equal(res.isConfigured, true);
  assert.equal(res.hasAnyReasons, true);
  assert.equal(res.defaultStatus?.id, 'hs-complete');
  assert.equal(res.defaultStatus?.name, 'COMPLETE');
  assert.ok((res.defaultStatus?.reasons || []).length >= 1);
});

test('resolveCompletedStatusHierarchy supports custom Completed/Done configs and skips inactive entries', () => {
  const customStatuses: HierarchicalStatus[] = [
    {
      id: 'st-inactive',
      name: 'Completed',
      code: 'COMPLETED',
      order: 1,
      active: false,
      reasons: [{ id: 'r-old', name: 'Old', order: 1, active: true, remarks: [] }]
    },
    {
      id: 'st-done',
      name: 'Done',
      code: 'DONE',
      order: 2,
      active: true,
      reasons: [
        { id: 'r-1', name: 'Aktivasi Sukses', order: 1, active: true, remarks: [] },
        { id: 'r-2', name: 'Disabled Reason', order: 2, active: false, remarks: [] }
      ]
    }
  ];

  const res = resolveCompletedStatusHierarchy(customStatuses);
  assert.equal(res.availableStatuses.length, 1);
  assert.equal(res.defaultStatus?.id, 'st-done');
  assert.equal(res.defaultStatus?.reasons.filter(r => r.active !== false).length, 1);
});

test('resolveUnsuccessCategories resolves Pending, Reschedule, Cancel strictly without standalone Kendala Lapangan', () => {
  const categories = resolveUnsuccessCategories(INITIAL_HIERARCHICAL_DROPLISTS);
  assert.equal(categories.length, 3);
  assert.deepEqual(categories.map(c => c.key), ['pending', 'reschedule', 'cancel']);

  const byKey = new Map(categories.map(c => [c.key, c]));
  assert.equal(byKey.get('pending')?.flowType, 'progress_report');
  assert.equal(byKey.get('pending')?.matchedStatus?.id, 'hs-pending');
  assert.equal(byKey.get('pending')?.isConfigured, true);

  assert.equal(byKey.get('reschedule')?.flowType, 'progress_report');
  assert.equal(byKey.get('reschedule')?.matchedStatus?.id, 'hs-enroute');
  assert.equal(byKey.get('reschedule')?.isConfigured, true);

  assert.equal(byKey.get('cancel')?.flowType, 'progress_report');
  assert.equal(byKey.get('cancel')?.matchedStatus?.id, 'hs-cancel');
  assert.equal(byKey.get('cancel')?.isConfigured, true);

  const emptyCfg = resolveUnsuccessCategories([]);
  assert.equal(emptyCfg.find(c => c.key === 'pending')?.isConfigured, false);
  assert.equal(emptyCfg.find(c => c.key === 'reschedule')?.isConfigured, false);
  assert.equal(emptyCfg.find(c => c.key === 'cancel')?.isConfigured, false);
});

test('formatInstallerStatusDisplay renders Assigned as REQUESTED only for installer view', () => {
  assert.equal(formatInstallerStatusDisplay('Assigned', 'installer'), 'REQUESTED');
  assert.equal(formatInstallerStatusDisplay('Pending Assignment', 'installer'), 'Pending Assignment');
  assert.equal(formatInstallerStatusDisplay('Completed', 'installer'), 'Completed');
  assert.equal(formatInstallerStatusDisplay('Assigned', 'dispatch'), 'Assigned');
  assert.equal(formatInstallerStatusDisplay('Assigned', 'leader'), 'Assigned');
});

test('extractLocationExtraMeta & formatFullviewTimeValue extract real optional location tags and WIB times', () => {
  const meta = extractLocationExtraMeta({
    clusterName: 'Cluster Melati',
    homepassDetailId: 'HP-9981',
    homepassType: 'Rumah',
    fatCode: 'FAT-BDG-01',
    additionalFields: { Blok: 'B3', NoRumah: '12', RT: '04', RW: '09' }
  });
  assert.equal(meta.cluster, 'Cluster Melati');
  assert.equal(meta.homepass, 'HP-9981 · Rumah');
  assert.equal(meta.fatCode, 'FAT-BDG-01');
  assert.equal(meta.blokNomor, 'Blok B3 No. 12');
  assert.equal(meta.rtRw, 'RT 04 / RW 09');

  assert.equal(formatFullviewTimeValue(undefined), '-');
  assert.equal(formatFullviewTimeValue(''), '-');
  const wib = formatFullviewTimeValue('2026-11-27T02:15:00.000Z');
  assert.ok(wib.endsWith(' WIB'));
  assert.match(wib, /09[.:]15/);
});

test('evaluatePhotoEvidenceCompleteness preserves 3 mandatory photos SOP enforcement', () => {
  const slots = createEmptyPhotoSlotsMap();
  const initialEval = evaluatePhotoEvidenceCompleteness(slots);
  assert.equal(initialEval.isMandatoryComplete, false);
  assert.equal(initialEval.mandatoryCount, 0);

  slots.customer_house = {
    slotKey: 'customer_house',
    title: 'Foto Rumah Pelanggan',
    url: 'https://example.supabase.co/storage/v1/object/public/wo/house.jpg',
    storagePath: 'wo/house.jpg',
    uploadStatus: 'uploaded',
    uploadedAt: '2026-11-27T03:00:00.000Z'
  };
  slots.fat_pole = {
    slotKey: 'fat_pole',
    title: 'Foto Tiang FAT',
    url: 'https://example.supabase.co/storage/v1/object/public/wo/fat.jpg',
    storagePath: 'wo/fat.jpg',
    uploadStatus: 'uploaded',
    uploadedAt: '2026-11-27T03:01:00.000Z'
  };
  slots.fat_attenuation = {
    slotKey: 'fat_attenuation',
    title: 'Foto Redaman FAT',
    url: 'https://example.supabase.co/storage/v1/object/public/wo/att.jpg',
    storagePath: 'wo/att.jpg',
    uploadStatus: 'uploaded',
    uploadedAt: '2026-11-27T03:02:00.000Z'
  };

  const readyEval = evaluatePhotoEvidenceCompleteness(slots);
  assert.equal(readyEval.isMandatoryComplete, true);
  assert.equal(readyEval.mandatoryCount, 3);
});
