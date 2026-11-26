import type { TechnicalPhotoSlot, TechnicalPhotoSlotKey } from '../types/index.ts';

export const MANDATORY_PHOTO_SLOT_KEYS = [
  'customer_house',
  'fat_pole',
  'fat_attenuation'
] as const satisfies readonly TechnicalPhotoSlotKey[];

export const OPTIONAL_PHOTO_SLOT_KEYS = [
  'fat_port',
  'customer_install',
  'barcode_sn',
  'opm'
] as const satisfies readonly TechnicalPhotoSlotKey[];

export const ALL_PHOTO_SLOT_KEYS = [
  ...MANDATORY_PHOTO_SLOT_KEYS,
  ...OPTIONAL_PHOTO_SLOT_KEYS
] as const satisfies readonly TechnicalPhotoSlotKey[];

export interface MandatoryPhotoSlotDescriptor {
  slotKey: (typeof MANDATORY_PHOTO_SLOT_KEYS)[number];
  order: 1 | 2 | 3;
  label: string;
  title: string;
}

export const MANDATORY_PHOTO_SLOT_DESCRIPTORS: readonly MandatoryPhotoSlotDescriptor[] = [
  {
    slotKey: 'customer_house',
    order: 1,
    label: 'Bukti Foto Fisik No. 1',
    title: 'Foto Lokasi Rumah'
  },
  {
    slotKey: 'fat_pole',
    order: 2,
    label: 'Bukti Foto Fisik No. 2',
    title: 'Foto Lokasi FAT'
  },
  {
    slotKey: 'fat_attenuation',
    order: 3,
    label: 'Bukti Foto Fisik No. 3',
    title: 'Foto Redaman FAT'
  }
] as const;

const ALLOWED_SLOT_KEY_SET = new Set<string>(ALL_PHOTO_SLOT_KEYS);
const MANDATORY_SLOT_KEY_SET = new Set<string>(MANDATORY_PHOTO_SLOT_KEYS);

export interface SlotUploadStateInput {
  status?: 'uploading' | 'failed' | string;
}

export interface PhotoEvidenceEvaluation {
  mandatoryCount: number;
  requiredMandatoryCount: 3;
  optionalCount: number;
  verifiedTotalCount: number;
  totalSlotCount: 7;
  isMandatoryComplete: boolean;
  mandatorySlots: TechnicalPhotoSlot[];
  optionalSlots: TechnicalPhotoSlot[];
  verifiedSlots: TechnicalPhotoSlot[];
  missingMandatorySlots: MandatoryPhotoSlotDescriptor[];
  missingMandatorySummary: string;
  verifiedByKey: Partial<Record<TechnicalPhotoSlotKey, boolean>>;
}

/**
 * Validates that a photo URL points to an actual persisted storage endpoint or HTTP(S) object URL,
 * never a local data URI, blob URI, or empty placeholder.
 */
export function isPersistedStoragePhotoUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== 'string') return false;
  const url = rawUrl.trim();
  if (!url) return false;
  const lower = url.toLowerCase();
  if (lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('javascript:')) {
    return false;
  }
  return (
    url.startsWith('/api/storage/') ||
    url.includes('/api/storage/public/') ||
    url.startsWith('/uploads/') ||
    lower.startsWith('https://') ||
    lower.startsWith('http://')
  );
}

/**
 * Authoritative single-source check determining whether a photo slot represents
 * a successfully uploaded and server-persisted evidence photo.
 */
export function isVerifiedPersistedPhotoSlot(
  slot: unknown,
  runtimeUploadState?: SlotUploadStateInput | null
): slot is TechnicalPhotoSlot {
  if (!slot || typeof slot !== 'object') return false;
  const s = slot as Partial<TechnicalPhotoSlot> & Record<string, any>;
  const slotKey = typeof s.slotKey === 'string' ? s.slotKey.trim() : '';
  if (!slotKey || !ALLOWED_SLOT_KEY_SET.has(slotKey)) return false;

  if (
    runtimeUploadState?.status === 'uploading' ||
    runtimeUploadState?.status === 'failed' ||
    runtimeUploadState?.status === 'pending_offline'
  ) {
    return false;
  }

  if (
    s.uploadStatus === 'uploading' ||
    s.uploadStatus === 'failed' ||
    s.uploadStatus === 'pending_offline'
  ) {
    return false;
  }

  if (!isPersistedStoragePhotoUrl(s.url)) {
    return false;
  }

  const hasStoragePath = typeof s.storagePath === 'string' && s.storagePath.trim().length > 0;
  const hasUploadedAt = typeof s.uploadedAt === 'string' && s.uploadedAt.trim().length > 0;
  return hasStoragePath || hasUploadedAt;
}

/**
 * Normalizes either a photoSlots array or a Record<PhotoSlotKey, TechnicalPhotoSlot | null>
 * into a deduplicated map keyed by canonical slotKey, then evaluates mandatory (#1, #2, #3)
 * and optional (#4-#7) completion strictly using server-persisted evidence rules.
 */
export function evaluatePhotoEvidenceCompleteness(
  slotsInput:
    | ReadonlyArray<TechnicalPhotoSlot | null | undefined>
    | Partial<Record<string, TechnicalPhotoSlot | null | undefined>>
    | null
    | undefined,
  runtimeUploadState?: Partial<Record<string, SlotUploadStateInput | undefined>> | null
): PhotoEvidenceEvaluation {
  const verifiedMap = new Map<TechnicalPhotoSlotKey, TechnicalPhotoSlot>();

  const considerSlot = (candidate: unknown, fallbackKey?: string) => {
    if (!candidate || typeof candidate !== 'object') return;
    const raw = candidate as TechnicalPhotoSlot & Record<string, any>;
    const key = (typeof raw.slotKey === 'string' && raw.slotKey.trim() ? raw.slotKey.trim() : fallbackKey || '') as TechnicalPhotoSlotKey;
    if (!key || !ALLOWED_SLOT_KEY_SET.has(key)) return;
    const normalizedSlot: TechnicalPhotoSlot = raw.slotKey === key ? raw : { ...raw, slotKey: key };
    const runtimeState = runtimeUploadState ? runtimeUploadState[key] : undefined;
    if (!isVerifiedPersistedPhotoSlot(normalizedSlot, runtimeState)) {
      return;
    }
    const existing = verifiedMap.get(key);
    if (!existing) {
      verifiedMap.set(key, normalizedSlot);
      return;
    }
    // Prefer newer uploadedAt timestamp if duplicates exist
    const existingTs = existing.uploadedAt ? Date.parse(existing.uploadedAt) : 0;
    const nextTs = normalizedSlot.uploadedAt ? Date.parse(normalizedSlot.uploadedAt) : 0;
    if (Number.isFinite(nextTs) && (!Number.isFinite(existingTs) || nextTs >= existingTs)) {
      verifiedMap.set(key, normalizedSlot);
    }
  };

  if (Array.isArray(slotsInput)) {
    for (const item of slotsInput) {
      considerSlot(item);
    }
  } else if (slotsInput && typeof slotsInput === 'object') {
    for (const [k, v] of Object.entries(slotsInput)) {
      considerSlot(v, k);
    }
  }

  const mandatorySlots: TechnicalPhotoSlot[] = [];
  const missingMandatorySlots: MandatoryPhotoSlotDescriptor[] = [];
  const verifiedByKey: Partial<Record<TechnicalPhotoSlotKey, boolean>> = {};

  for (const desc of MANDATORY_PHOTO_SLOT_DESCRIPTORS) {
    const slot = verifiedMap.get(desc.slotKey);
    if (slot) {
      mandatorySlots.push(slot);
      verifiedByKey[desc.slotKey] = true;
    } else {
      missingMandatorySlots.push(desc);
      verifiedByKey[desc.slotKey] = false;
    }
  }

  const optionalSlots: TechnicalPhotoSlot[] = [];
  for (const optKey of OPTIONAL_PHOTO_SLOT_KEYS) {
    const slot = verifiedMap.get(optKey);
    if (slot) {
      optionalSlots.push(slot);
      verifiedByKey[optKey] = true;
    } else {
      verifiedByKey[optKey] = false;
    }
  }

  const verifiedSlots = [...mandatorySlots, ...optionalSlots];
  const missingMandatorySummary = missingMandatorySlots
    .map(m => `${m.label} (${m.title})`)
    .join(', ');

  return {
    mandatoryCount: mandatorySlots.length,
    requiredMandatoryCount: 3,
    optionalCount: optionalSlots.length,
    verifiedTotalCount: verifiedSlots.length,
    totalSlotCount: 7,
    isMandatoryComplete: mandatorySlots.length === MANDATORY_PHOTO_SLOT_KEYS.length,
    mandatorySlots,
    optionalSlots,
    verifiedSlots,
    missingMandatorySlots,
    missingMandatorySummary,
    verifiedByKey
  };
}

export function isMandatoryPhotoSlotKey(slotKey: unknown): boolean {
  return typeof slotKey === 'string' && MANDATORY_SLOT_KEY_SET.has(slotKey.trim());
}

export function buildPhotoEvidenceIncompleteErrorMessage(evaluation: PhotoEvidenceEvaluation): string {
  if (evaluation.isMandatoryComplete) {
    return '';
  }
  const missingText = evaluation.missingMandatorySummary || 'Foto Wajib #1, #2, dan #3';
  const extraHint =
    evaluation.optionalCount > 0
      ? ' Catatan: foto tambahan (slot #4-#7) tidak dapat menggantikan slot foto wajib.'
      : '';
  return `Check-Out ditolak: Wajib mengunggah 3 foto bukti wajib (${missingText} belum terunggah & terverifikasi di server; saat ini Wajib ${evaluation.mandatoryCount}/3, Total ${evaluation.verifiedTotalCount}/7).${extraHint}`;
}
