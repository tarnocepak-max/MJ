import { TechnicalPhotoSlot, TechnicalPhotoSlotKey } from '../../../types/index.ts';
import { CapturedPhotoPayload } from '../../camera/GeoTagCameraModal';

export type PhotoSlotKey = TechnicalPhotoSlotKey;

export interface PhotoSlotDefinition {
  slotNumber: string;
  codeLabel: string;
  slotKey: PhotoSlotKey;
  title: string;
  defaultTag: string;
  verifiedTag: string;
  validLabel: string;
  emptyHint: string;
  mandatoryOrder?: 1 | 2 | 3;
  mandatoryLabel?: string;
}

export interface SlotUploadMeta {
  status: 'uploading' | 'failed';
  error?: string;
  pendingPayload?: CapturedPhotoPayload;
}

/**
 * 7-slot ordered SOP Bukti Foto Fisik (Minimal 3 foto bukti fisik wajib untuk Check-out):
 * 1. Foto Lokasi Rumah (customer_house) — Bukti Foto Fisik No. 1 (Wajib)
 * 2. Foto Lokasi FAT (fat_pole) — Bukti Foto Fisik No. 2 (Wajib)
 * 3. Foto Redaman FAT (fat_attenuation) — Bukti Foto Fisik No. 3 (Wajib)
 * 4. Foto Port FAT (fat_port)
 * 5. Foto Instalasi Pelanggan (customer_install)
 * 6. Foto SN & MAC ONT (barcode_sn)
 * 7. Foto Redaman OPM (opm)
 */
export const PHOTO_SLOT_DEFINITIONS: PhotoSlotDefinition[] = [
  {
    slotNumber: '01',
    codeLabel: 'LOKASI RUMAH',
    slotKey: 'customer_house',
    title: 'Foto Lokasi Rumah',
    defaultTag: 'Lokasi Rumah',
    verifiedTag: 'LOKASI RUMAH',
    validLabel: 'Berhasil Diunggah',
    emptyHint: 'Ambil foto tampak depan rumah pelanggan (GPS Check-In)',
    mandatoryOrder: 1,
    mandatoryLabel: 'Bukti Foto Fisik No. 1'
  },
  {
    slotNumber: '02',
    codeLabel: 'LOKASI FAT',
    slotKey: 'fat_pole',
    title: 'Foto Lokasi FAT',
    defaultTag: 'Tiang FAT',
    verifiedTag: 'GPS OK',
    validLabel: 'Berhasil Diunggah',
    emptyHint: 'Foto tiang & kotak label FAT yang digunakan',
    mandatoryOrder: 2,
    mandatoryLabel: 'Bukti Foto Fisik No. 2'
  },
  {
    slotNumber: '03',
    codeLabel: 'REDAMAN FAT',
    slotKey: 'fat_attenuation',
    title: 'Foto Redaman FAT',
    defaultTag: 'Redaman FAT',
    verifiedTag: 'LOKASI FAT',
    validLabel: 'Berhasil Diunggah',
    emptyHint: 'Foto hasil ukur OPM di titik FAT (Set Lokasi FAT)',
    mandatoryOrder: 3,
    mandatoryLabel: 'Bukti Foto Fisik No. 3'
  },
  {
    slotNumber: '04',
    codeLabel: 'PORT FAT',
    slotKey: 'fat_port',
    title: 'Foto Port FAT',
    defaultTag: 'Port FAT',
    verifiedTag: 'GPS OK',
    validLabel: 'Terkunci',
    emptyHint: 'Foto adaptor SC-UPC & nomor port aktif di dalam box FAT'
  },
  {
    slotNumber: '05',
    codeLabel: 'INSTALASI',
    slotKey: 'customer_install',
    title: 'Foto Instalasi Pelanggan',
    defaultTag: 'Routing Rapi SOP',
    verifiedTag: 'GPS OK',
    validLabel: 'Rapi & Tertutup',
    emptyHint: 'Foto jalur kabel dropcore, roset & lampu ONT menyala'
  },
  {
    slotNumber: '06',
    codeLabel: 'SN & MAC ONT',
    slotKey: 'barcode_sn',
    title: 'Foto SN & MAC ONT',
    defaultTag: 'SN ONT',
    verifiedTag: 'GPS OK',
    validLabel: 'Terbaca Tajam',
    emptyHint: 'Pindai stiker barcode SN & MAC Address ONT via kamera barcode'
  },
  {
    slotNumber: '07',
    codeLabel: 'REDAMAN OPM',
    slotKey: 'opm',
    title: 'Foto Redaman OPM',
    defaultTag: 'OPM',
    verifiedTag: 'GPS OK',
    validLabel: 'SOP Valid',
    emptyHint: 'Foto hasil ukur redaman OPM di sisi roset pelanggan'
  }
];

export type PhotoSlotsRecord = Record<PhotoSlotKey, TechnicalPhotoSlot | null>;

export function createEmptyPhotoSlotsMap(): PhotoSlotsRecord {
  return {
    customer_house: null,
    fat_pole: null,
    fat_attenuation: null,
    fat_port: null,
    customer_install: null,
    barcode_sn: null,
    opm: null
  };
}
