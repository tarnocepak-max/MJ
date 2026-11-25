import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortDataArray,
  getNextSortDirection,
  parseDateToTimestamp,
  isEmptySortValue
} from './tableSorting';

test('getNextSortDirection cycles asc -> desc -> null -> asc cleanly', () => {
  assert.equal(getNextSortDirection(null), 'asc');
  assert.equal(getNextSortDirection('asc'), 'desc');
  assert.equal(getNextSortDirection('desc'), null);

  assert.equal(getNextSortDirection('wo', 'asc', 'date'), 'asc');
  assert.equal(getNextSortDirection('date', 'asc', 'date'), 'desc');
  assert.equal(getNextSortDirection('date', 'desc', 'date'), null);
});

test('sortDataArray keeps NULL/empty/invalid dates LAST in both asc and desc', () => {
  const rows = [
    { id: 'empty', date: '' },
    { id: 'late', date: '2026-11-28' },
    { id: 'nullish', date: null as string | null },
    { id: 'early', date: '2026-11-20' },
    { id: 'invalid', date: 'not-a-date' },
    { id: 'mid', date: '24/11/2026' }
  ];

  const ascIds = sortDataArray(rows, 'date', 'asc', { date: 'date' }).map(r => r.id);
  assert.deepEqual(ascIds.slice(0, 3), ['early', 'mid', 'late']);
  assert.deepEqual(new Set(ascIds.slice(3)), new Set(['empty', 'nullish', 'invalid']));

  const descIds = sortDataArray(rows, 'date', 'desc', { date: 'date' }).map(r => r.id);
  assert.deepEqual(descIds.slice(0, 3), ['late', 'mid', 'early']);
  assert.deepEqual(new Set(descIds.slice(3)), new Set(['empty', 'nullish', 'invalid']));
});

test('sortDataArray keeps empty text, numbers, and time slots LAST in both asc and desc', () => {
  const rows = [
    { id: 'blank', name: '', num: null as number | null, slot: '-' },
    { id: 'b', name: 'Budi', num: 20, slot: '13:00 - 15:00 WIB' },
    { id: 'a', name: 'Andi', num: 5, slot: '09:00 - 11:00 WIB' }
  ];

  assert.deepEqual(
    sortDataArray(rows, 'name', 'asc', { name: 'text' }).map(r => r.id),
    ['a', 'b', 'blank']
  );
  assert.deepEqual(
    sortDataArray(rows, 'name', 'desc', { name: 'text' }).map(r => r.id),
    ['b', 'a', 'blank']
  );

  assert.deepEqual(
    sortDataArray(rows, 'num', 'asc', { num: 'number' }).map(r => r.id),
    ['a', 'b', 'blank']
  );
  assert.deepEqual(
    sortDataArray(rows, 'num', 'desc', { num: 'number' }).map(r => r.id),
    ['b', 'a', 'blank']
  );

  assert.deepEqual(
    sortDataArray(rows, 'slot', 'asc', { slot: 'time_slot' }).map(r => r.id),
    ['a', 'b', 'blank']
  );
  assert.deepEqual(
    sortDataArray(rows, 'slot', 'desc', { slot: 'time_slot' }).map(r => r.id),
    ['b', 'a', 'blank']
  );
});

test('parseDateToTimestamp and isEmptySortValue handle valid and invalid inputs', () => {
  assert.ok(parseDateToTimestamp('2026-11-25') > 0);
  assert.ok(parseDateToTimestamp('25/11/2026') > 0);
  assert.equal(parseDateToTimestamp(''), 0);
  assert.equal(parseDateToTimestamp('31/02/2026'), 0);
  assert.equal(isEmptySortValue('31/02/2026', 'date'), true);
  assert.equal(isEmptySortValue(0, 'number'), false);
});
