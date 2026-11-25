import type { DeletionItemRow, DeletionMode, DeletionSubEntity } from '../services/deletionManagementService';

export type DeletionSortBy = 'default' | 'appointment_date' | 'created_at';
export type DeletionSortDir = 'asc' | 'desc';

export interface DeletionSortState {
  by: DeletionSortBy;
  dir: DeletionSortDir;
}

export interface DeletionHeaderFilters {
  woNumber: string;
  customerId: string;
  customerName: string;
  contractor: string;
  area: string;
  assignmentStatus: string;
  appointmentDate: string;
  appointmentDateFrom: string;
  appointmentDateTo: string;
  deletionStatus: 'all' | 'active' | 'soft_deleted';
  recordIdQuery: string;
  summaryQuery: string;
  actorQuery: string;
  subEntity: DeletionSubEntity;
}

export interface DeletionHistoryHeaderFilters {
  txIdQuery: string;
  woOrRecordQuery: string;
  actor: string;
  reasonQuery: string;
  category: string;
  deletionType: string;
  status: string;
  dateFrom: string;
  dateTo: string;
  sortDir: 'asc' | 'desc';
}

export function getDefaultDeletionStatusForTab(mode: DeletionMode): 'all' | 'active' | 'soft_deleted' {
  if (mode === 'soft_delete') return 'active';
  if (mode === 'restore') return 'soft_deleted';
  return 'all';
}

export function createInitialDeletionFilters(mode: DeletionMode, initialSearch = ''): DeletionHeaderFilters {
  return {
    woNumber: initialSearch,
    customerId: '',
    customerName: '',
    contractor: 'all',
    area: 'all',
    assignmentStatus: 'all',
    appointmentDate: '',
    appointmentDateFrom: '',
    appointmentDateTo: '',
    deletionStatus: getDefaultDeletionStatusForTab(mode),
    recordIdQuery: '',
    summaryQuery: '',
    actorQuery: '',
    subEntity: 'all'
  };
}

export function createInitialHistoryFilters(): DeletionHistoryHeaderFilters {
  return {
    txIdQuery: '',
    woOrRecordQuery: '',
    actor: '',
    reasonQuery: '',
    category: 'all',
    deletionType: 'all',
    status: 'all',
    dateFrom: '',
    dateTo: '',
    sortDir: 'desc'
  };
}

/**
 * 3-state Appointment Date sort toggle:
 * Click 1 (from default) -> asc (oldest -> newest)
 * Click 2 (from asc)     -> desc (newest -> oldest)
 * Click 3 (from desc)    -> default
 */
export function cycleAppointmentDateSort(prev: DeletionSortState): DeletionSortState {
  if (prev.by !== 'appointment_date') {
    return { by: 'appointment_date', dir: 'asc' };
  }
  if (prev.dir === 'asc') {
    return { by: 'appointment_date', dir: 'desc' };
  }
  return { by: 'default', dir: 'desc' };
}

/**
 * 3-state Created/Timestamp sort toggle for non-WO tables
 */
export function cycleCreatedAtSort(prev: DeletionSortState): DeletionSortState {
  if (prev.by !== 'created_at') {
    return { by: 'created_at', dir: 'asc' };
  }
  if (prev.dir === 'asc') {
    return { by: 'created_at', dir: 'desc' };
  }
  return { by: 'default', dir: 'desc' };
}

/**
 * Determines whether a row can be selected by checkbox on the given operational tab.
 * All three operational tabs (soft_delete, permanent_delete, restore) allow contextual selection
 * within their role/safety boundaries.
 */
export function isRowSelectableForTab(row: DeletionItemRow, tab: DeletionMode, isSuperAdmin: boolean): boolean {
  if (!row || row.isProtected || row.isLockedActive) return false;
  if (tab === 'soft_delete') return !row.isDeleted;
  if (tab === 'restore') return isSuperAdmin && row.isDeleted;
  if (tab === 'permanent_delete') return isSuperAdmin;
  return false;
}

/**
 * Reconciles checkbox selection against currently visible rows after search/filter/sort updates.
 * Guarantees that rows hidden by a filter or pagination can NEVER remain selected for deletion,
 * while preserving selection across sorting if the rows remain in view.
 */
export function reconcileSelectionWithVisibleRows(
  prevSelectedIds: string[],
  visibleRows: DeletionItemRow[],
  tab: DeletionMode,
  isSuperAdmin: boolean
): string[] {
  if (prevSelectedIds.length === 0 || visibleRows.length === 0) return [];
  const selectableSet = new Set(
    visibleRows.filter(r => isRowSelectableForTab(r, tab, isSuperAdmin)).map(r => r.id)
  );
  return prevSelectedIds.filter(id => selectableSet.has(id));
}

export function countActiveDeletionFilters(
  filters: DeletionHeaderFilters,
  sort: DeletionSortState,
  tab: DeletionMode
): number {
  let count = 0;
  if (filters.woNumber.trim()) count++;
  if (filters.customerId.trim()) count++;
  if (filters.customerName.trim()) count++;
  if (filters.contractor !== 'all') count++;
  if (filters.area !== 'all') count++;
  if (filters.assignmentStatus !== 'all') count++;
  if (filters.appointmentDate || filters.appointmentDateFrom || filters.appointmentDateTo) count++;
  if (filters.deletionStatus !== getDefaultDeletionStatusForTab(tab)) count++;
  if (filters.recordIdQuery.trim()) count++;
  if (filters.summaryQuery.trim()) count++;
  if (filters.actorQuery.trim()) count++;
  if (filters.subEntity !== 'all') count++;
  if (sort.by !== 'default') count++;
  return count;
}

export function countActiveHistoryFilters(filters: DeletionHistoryHeaderFilters): number {
  let count = 0;
  if (filters.txIdQuery.trim()) count++;
  if (filters.woOrRecordQuery.trim()) count++;
  if (filters.actor.trim()) count++;
  if (filters.reasonQuery.trim()) count++;
  if (filters.category !== 'all') count++;
  if (filters.deletionType !== 'all') count++;
  if (filters.status !== 'all') count++;
  if (filters.dateFrom || filters.dateTo) count++;
  if (filters.sortDir !== 'desc') count++;
  return count;
}

export function resolveExpectedPermanentConfirmText(targets: DeletionItemRow[]): string {
  if (targets.length === 0) return '';
  if (targets.length === 1) {
    const t = targets[0];
    return t.category === 'work_orders' ? String(t.woNumber || t.id) : String(t.id);
  }
  return `HAPUS PERMANEN ${targets.length} DATA`;
}

export function doesPermanentConfirmMatch(targets: DeletionItemRow[], typedText: string): boolean {
  if (targets.length === 0) return false;
  const typed = typedText.trim();
  if (!typed) return false;
  const expected = resolveExpectedPermanentConfirmText(targets);
  if (targets.length > 1) {
    return typed.toUpperCase() === expected.toUpperCase();
  }
  const t = targets[0];
  if (t.category === 'work_orders') {
    return typed.toUpperCase() === expected.toUpperCase();
  }
  return typed === expected || (Boolean(t.label) && typed === String(t.label).trim());
}
