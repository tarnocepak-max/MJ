import type { HierarchicalReason, HierarchicalStatus } from '../types/index.ts';

export interface HierarchicalValidationInput {
  statuses: readonly HierarchicalStatus[];
  reportStatusId?: string | null;
  reportStatusLabel?: string | null;
  reasonReportId?: string | null;
  reasonReportLabel?: string | null;
}

export type HierarchicalValidationResult =
  | {
      valid: true;
      matchedStatus: HierarchicalStatus;
      matchedReason: HierarchicalReason;
    }
  | {
      valid: false;
      code:
        | 'STATUS_REQUIRED'
        | 'REASON_REQUIRED'
        | 'INVALID_REPORT_STATUS'
        | 'INACTIVE_REPORT_STATUS'
        | 'INVALID_REASON_PARENT_CHILD'
        | 'INACTIVE_REASON';
      error: string;
    };

export function validateHierarchicalDroplistSelection(
  input: HierarchicalValidationInput
): HierarchicalValidationResult {
  const statuses = Array.isArray(input.statuses) ? input.statuses : [];
  const rawStatusId = String(input.reportStatusId || '').trim();
  const rawStatusLabel = String(input.reportStatusLabel || '').trim();
  const rawReasonId = String(input.reasonReportId || '').trim();
  const rawReasonLabel = String(input.reasonReportLabel || '').trim();

  if (!rawStatusId && !rawStatusLabel) {
    return {
      valid: false,
      code: 'STATUS_REQUIRED',
      error: 'Status WO (Level 1) wajib dipilih.'
    };
  }
  if (!rawReasonId && !rawReasonLabel) {
    return {
      valid: false,
      code: 'REASON_REQUIRED',
      error: 'Reason WO (Level 2) wajib dipilih.'
    };
  }

  let matchedStatus: HierarchicalStatus | undefined;
  if (rawStatusId) {
    matchedStatus = statuses.find(s => s && String(s.id || '').trim() === rawStatusId);
  }
  if (!matchedStatus && rawStatusLabel && !rawStatusId) {
    const normStatus = rawStatusLabel.toLowerCase();
    matchedStatus = statuses.find(
      s =>
        s &&
        (String(s.name || '').trim().toLowerCase() === normStatus ||
          (s.code && String(s.code).trim().toLowerCase() === normStatus))
    );
  }

  if (!matchedStatus) {
    return {
      valid: false,
      code: 'INVALID_REPORT_STATUS',
      error: `Validasi Gagal: Status WO "${rawStatusLabel || rawStatusId}" tidak terdaftar dalam konfigurasi Setting Droplist.`
    };
  }

  const isStatusActive =
    matchedStatus.active !== false && (matchedStatus as { isActive?: boolean }).isActive !== false;
  if (!isStatusActive) {
    return {
      valid: false,
      code: 'INACTIVE_REPORT_STATUS',
      error: `Validasi Gagal: Status WO "${matchedStatus.name}" sedang dinonaktifkan oleh Admin.`
    };
  }

  const childReasons = Array.isArray(matchedStatus.reasons) ? matchedStatus.reasons : [];
  let matchedReason: HierarchicalReason | undefined;
  if (rawReasonId) {
    matchedReason = childReasons.find(r => r && String(r.id || '').trim() === rawReasonId);
  }
  if (!matchedReason && rawReasonLabel && !rawReasonId) {
    const normReason = rawReasonLabel.toLowerCase();
    matchedReason = childReasons.find(
      r =>
        r &&
        (String(r.name || '').trim().toLowerCase() === normReason ||
          (r.code && String(r.code).trim().toLowerCase() === normReason))
    );
  }

  if (!matchedReason) {
    return {
      valid: false,
      code: 'INVALID_REASON_PARENT_CHILD',
      error: `Validasi Gagal: Reason WO "${rawReasonLabel || rawReasonId}" tidak valid atau bukan turunan sah dari Status "${matchedStatus.name}".`
    };
  }

  const isReasonActive =
    matchedReason.active !== false && (matchedReason as { isActive?: boolean }).isActive !== false;
  if (!isReasonActive) {
    return {
      valid: false,
      code: 'INACTIVE_REASON',
      error: `Validasi Gagal: Reason WO "${matchedReason.name}" sedang dinonaktifkan oleh Admin.`
    };
  }

  return {
    valid: true,
    matchedStatus,
    matchedReason
  };
}
