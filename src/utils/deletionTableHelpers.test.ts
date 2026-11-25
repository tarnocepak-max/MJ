import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleAppointmentDateSort,
  cycleCreatedAtSort,
  reconcileSelectionWithVisibleRows,
  countActiveDeletionFilters,
  createInitialDeletionFilters,
  resolveExpectedPermanentConfirmText,
  doesPermanentConfirmMatch,
  isRowSelectableForTab
} from './deletionTableHelpers';
import type { DeletionItemRow } from '../services/deletionManagementService';

const makeRow = (id: string, overrides: Partial<DeletionItemRow> = {}): DeletionItemRow => ({
  id,
  category: 'work_orders',
  woNumber: `WO-${id}`,
  customerId: `100000${id}`.slice(0, 7),
  customerName: `Customer ${id}`,
  appointmentDate: '2026-11-25',
  contractor: 'PT Mora',
  area: 'Jakarta',
  isDeleted: false,
  deletionStatus: 'ACTIVE',
  ...overrides
});

test('Appointment Date sort cycles Default -> Asc -> Desc -> Default cleanly', () => {
  const s0 = { by: 'default' as const, dir: 'desc' as const };
  const s1 = cycleAppointmentDateSort(s0);
  assert.deepEqual(s1, { by: 'appointment_date', dir: 'asc' });

  const s2 = cycleAppointmentDateSort(s1);
  assert.deepEqual(s2, { by: 'appointment_date', dir: 'desc' });

  const s3 = cycleAppointmentDateSort(s2);
  assert.deepEqual(s3, { by: 'default', dir: 'desc' });
});

test('CreatedAt sort cycles Default -> Asc -> Desc -> Default cleanly', () => {
  const s1 = cycleCreatedAtSort({ by: 'default', dir: 'desc' });
  assert.deepEqual(s1, { by: 'created_at', dir: 'asc' });
  const s2 = cycleCreatedAtSort(s1);
  assert.deepEqual(s2, { by: 'created_at', dir: 'desc' });
  const s3 = cycleCreatedAtSort(s2);
  assert.deepEqual(s3, { by: 'default', dir: 'desc' });
});

test('Selection reconciliation drops hidden rows when search/filter changes while preserving visible rows after sort', () => {
  const r1 = makeRow('1', { appointmentDate: '2026-11-20' });
  const r2 = makeRow('2', { appointmentDate: '2026-11-22' });
  const r3 = makeRow('3', { appointmentDate: '2026-11-21', isProtected: true });

  // Selecting r1 and r2
  const initialSelected = ['1', '2', '3'];
  // Reconcile on full visible page -> r3 is protected so excluded
  const afterInitial = reconcileSelectionWithVisibleRows(initialSelected, [r1, r2, r3], 'soft_delete', true);
  assert.deepEqual(afterInitial, ['1', '2']);

  // Sorting changes order -> both r2 and r1 still visible, selection preserved
  const afterSort = reconcileSelectionWithVisibleRows(afterInitial, [r2, r1], 'soft_delete', true);
  assert.deepEqual(afterSort, ['1', '2']);

  // Search narrows to only r2 -> r1 becomes invisible and MUST be removed from selection
  const afterFilter = reconcileSelectionWithVisibleRows(afterSort, [r2], 'soft_delete', true);
  assert.deepEqual(afterFilter, ['2']);
});

test('Role & tab eligibility checks protect Dispatch from permanent_delete and restore', () => {
  const activeWo = makeRow('1', { isDeleted: false });
  const deletedWo = makeRow('2', { isDeleted: true });

  assert.equal(isRowSelectableForTab(activeWo, 'soft_delete', false), true);
  assert.equal(isRowSelectableForTab(activeWo, 'permanent_delete', false), false);
  assert.equal(isRowSelectableForTab(deletedWo, 'restore', false), false);

  assert.equal(isRowSelectableForTab(activeWo, 'permanent_delete', true), true);
  assert.equal(isRowSelectableForTab(deletedWo, 'permanent_delete', true), true);
  assert.equal(isRowSelectableForTab(deletedWo, 'restore', true), true);
});

test('Active header filter counter accurately counts combined filters and sort state', () => {
  const base = createInitialDeletionFilters('soft_delete');
  assert.equal(countActiveDeletionFilters(base, { by: 'default', dir: 'desc' }, 'soft_delete'), 0);

  const modified = {
    ...base,
    woNumber: 'WO-123',
    contractor: 'PT Alpha',
    appointmentDateFrom: '2026-11-01',
    deletionStatus: 'all' as const
  };
  assert.equal(
    countActiveDeletionFilters(modified, { by: 'appointment_date', dir: 'asc' }, 'soft_delete'),
    5
  );
});

test('Permanent delete typed confirmation enforces WO Number for single WO, ID for single non-WO, and batch phrase for multi-select', () => {
  const singleWo = [makeRow('wo-1', { woNumber: 'WO-998877' })];
  assert.equal(resolveExpectedPermanentConfirmText(singleWo), 'WO-998877');
  assert.equal(doesPermanentConfirmMatch(singleWo, 'wo-998877'), true);
  assert.equal(doesPermanentConfirmMatch(singleWo, 'WO-OTHER'), false);

  const singleMsg = [makeRow('msg-42', { category: 'ticket_messages', woNumber: undefined, label: 'Hello' })];
  assert.equal(resolveExpectedPermanentConfirmText(singleMsg), 'msg-42');
  assert.equal(doesPermanentConfirmMatch(singleMsg, 'msg-42'), true);

  const multi = [makeRow('1'), makeRow('2'), makeRow('3')];
  assert.equal(resolveExpectedPermanentConfirmText(multi), 'HAPUS PERMANEN 3 DATA');
  assert.equal(doesPermanentConfirmMatch(multi, 'hapus permanen 3 data'), true);
  assert.equal(doesPermanentConfirmMatch(multi, 'HAPUS PERMANEN 2 DATA'), false);
});
