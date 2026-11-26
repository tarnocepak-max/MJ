import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDeltaTickets } from './woSyncEngine.ts';
import type { Ticket } from '../types/index.ts';

test('mergeDeltaTickets preserves technicalReport.photoSlots when incoming delta is partial critical snapshot', () => {
  const existingTicket = {
    id: 'wo-100',
    woNumber: 'WO-100',
    status: 'In Progress',
    technicalReport: {
      id: 'rep-100',
      ticketId: 'wo-100',
      mainCategory: 'COMPLETE',
      workResult: 'Installed',
      technicalDescription: 'Done',
      submittedBy: 'Andi',
      submittedAt: '2026-11-26T01:00:00.000Z',
      photoSlots: [
        {
          slotKey: 'customer_house',
          title: 'Foto Lokasi Rumah',
          url: '/api/storage/adapter/download?storagePath=p1&category=technical-reports',
          storagePath: 'p1',
          uploadedAt: '2026-11-26T01:00:00.000Z',
          uploadStatus: 'uploaded'
        },
        {
          slotKey: 'fat_pole',
          title: 'Foto Lokasi FAT',
          url: '/api/storage/adapter/download?storagePath=p2&category=technical-reports',
          storagePath: 'p2',
          uploadedAt: '2026-11-26T01:01:00.000Z',
          uploadStatus: 'uploaded'
        },
        {
          slotKey: 'fat_attenuation',
          title: 'Foto Redaman FAT',
          url: '/api/storage/adapter/download?storagePath=p3&category=technical-reports',
          storagePath: 'p3',
          uploadedAt: '2026-11-26T01:02:00.000Z',
          uploadStatus: 'uploaded'
        }
      ],
      photos: ['u1', 'u2', 'u3']
    }
  } as unknown as Ticket;

  const incomingCriticalDelta = {
    id: 'wo-100',
    woNumber: 'WO-100',
    status: 'In Progress',
    updatedAt: '2026-11-26T01:05:00.000Z',
    _isCriticalPartial: true
  } as unknown as Ticket;

  const merged = mergeDeltaTickets([existingTicket], [incomingCriticalDelta], [], new Set());
  assert.equal(merged.tickets.length, 1);
  assert.equal(merged.tickets[0].technicalReport?.photoSlots?.length, 3);
  assert.equal((merged.tickets[0] as any)._isCriticalPartial, false);
});
