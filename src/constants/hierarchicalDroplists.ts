import type { HierarchicalStatus } from '../types/index.ts';

export const INITIAL_HIERARCHICAL_DROPLISTS: HierarchicalStatus[] = [
  {
    id: 'hs-complete',
    name: 'COMPLETE',
    code: 'COMPLETE',
    color: '#10B981',
    order: 1,
    active: true,
    reasons: [
      {
        id: 'hr-c1',
        statusId: 'hs-complete',
        name: 'Ganti Drop Wire Baru',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-c1-1', reasonId: 'hr-c1', name: 'Ter tabrak Truk', order: 1, active: true },
          { id: 'hrm-c1-2', reasonId: 'hr-c1', name: 'Tergigit Tikus / Hewan', order: 2, active: true },
          { id: 'hrm-c1-3', reasonId: 'hr-c1', name: 'Kabel Lapuk / Usia', order: 3, active: true },
          { id: 'hrm-1793539959739', reasonId: 'hr-c1', name: 'Kabel Bending', text: 'Kabel Bending', order: 4, active: true, isActive: true },
          { id: 'hrm-1793540022430', reasonId: 'hr-c1', name: 'Kabel Digigit Hewan', text: 'Kabel Digigit Hewan', order: 5, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-c2',
        statusId: 'hs-complete',
        name: 'Ganti Precon Baru',
        order: 2,
        active: true,
        remarks: [
          { id: 'hrm-c2-1', reasonId: 'hr-c2', name: 'Ter tabrak Truk', order: 1, active: true },
          { id: 'hrm-c2-2', reasonId: 'hr-c2', name: 'Konektor SC Rusak / Kotor', order: 2, active: true },
          { id: 'hrm-c2-3', reasonId: 'hr-c2', name: 'Macro Bend Jalur Tiang', order: 3, active: true },
          { id: 'hrm-1793540054485', reasonId: 'hr-c2', name: 'Precone Di Gigit Hewan', text: 'Precone Di Gigit Hewan', order: 4, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-1793540108354',
        statusId: 'hs-complete',
        name: 'Replace ONT',
        code: 'REP_ONT',
        order: 3,
        active: true,
        isActive: true,
        remarks: [
          { id: 'hrm-1793540131976', reasonId: 'hr-1793540108354', name: 'ONT BAD', text: 'ONT BAD', order: 1, active: true, isActive: true },
          { id: 'hrm-1793540165269', reasonId: 'hr-1793540108354', name: 'ONT SLOW SPEED', text: 'ONT SLOW SPEED', order: 2, active: true, isActive: true },
          { id: 'hrm-1793540181440', reasonId: 'hr-1793540108354', name: 'ONT MATI TOTAL', text: 'ONT MATI TOTAL', order: 3, active: true, isActive: true },
          { id: 'hrm-1793540203825', reasonId: 'hr-1793540108354', name: 'SN/MAC TIDAK TERDAFTAR', text: 'SN/MAC TIDAK TERDAFTAR', order: 4, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-1793540232023',
        statusId: 'hs-complete',
        name: 'Ganti Pigtail',
        code: 'REP_PIG',
        order: 4,
        active: true,
        isActive: true,
        remarks: [
          { id: 'hrm-1793540265068', reasonId: 'hr-1793540232023', name: 'PIGTAIL RUSAK', text: 'PIGTAIL RUSAK', order: 1, active: true, isActive: true },
          { id: 'hrm-1793540274510', reasonId: 'hr-1793540232023', name: 'PIGTAIL PUTUS', text: 'PIGTAIL PUTUS', order: 2, active: true, isActive: true },
          { id: 'hrm-1793540294558', reasonId: 'hr-1793540232023', name: 'PIGTAIL BENDING', text: 'PIGTAIL BENDING', order: 3, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-1793540322448',
        statusId: 'hs-complete',
        name: 'Ganti Barrel SC',
        code: 'REp_sc',
        order: 5,
        active: true,
        isActive: true,
        remarks: [
          { id: 'hrm-1793540343037', reasonId: 'hr-1793540322448', name: 'CONNECTOR RUSAK', text: 'CONNECTOR RUSAK', order: 1, active: true, isActive: true },
          { id: 'hrm-1793540364679', reasonId: 'hr-1793540322448', name: 'CONNECTOR TIDAK SESUAI', text: 'CONNECTOR TIDAK SESUAI', order: 2, active: true, isActive: true }
        ]
      },
      {
        id: 'hr-1793540421975',
        statusId: 'hs-complete',
        name: 'Re-splice Kabel',
        code: 'Rsplic',
        order: 6,
        active: true,
        isActive: true,
        remarks: [
          { id: 'hrm-1793540434825', reasonId: 'hr-1793540421975', name: 'KABEL PUTUS', text: 'KABEL PUTUS', order: 1, active: true, isActive: true },
          { id: 'hrm-1793540511910', reasonId: 'hr-1793540421975', name: 'HASIL SPLICE BAD', text: 'HASIL SPLICE BAD', order: 2, active: true, isActive: true }
        ]
      }
    ]
  },
  {
    id: 'hs-cancel',
    name: 'CANCEL',
    code: 'CANCEL',
    color: '#EF4444',
    order: 2,
    active: true,
    reasons: [
      {
        id: 'hr-can1',
        statusId: 'hs-cancel',
        name: 'Pelanggan Berhenti Berlangganan',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-can1-1', reasonId: 'hr-can1', name: 'Pelanggan Berhenti Berlangganan', order: 1, active: true },
          { id: 'hrm-can1-2', reasonId: 'hr-can1', name: 'Pindah Domisili / Lokasi', order: 2, active: true }
        ]
      },
      {
        id: 'hr-can2',
        statusId: 'hs-cancel',
        name: 'Re-Visit Berulang',
        order: 2,
        active: true,
        remarks: [
          { id: 'hrm-can2-1', reasonId: 'hr-can2', name: 'Re-Visit Berulang (tidak bertemu Customer)', order: 1, active: true },
          { id: 'hrm-can2-2', reasonId: 'hr-can2', name: 'Kontak Tidak Dapat Dihubungi', order: 2, active: true }
        ]
      },
      {
        id: 'hr-can3',
        statusId: 'hs-cancel',
        name: 'Pembatalan Request Upgrade',
        order: 3,
        active: true,
        remarks: [{ id: 'hrm-can3-1', reasonId: 'hr-can3', name: 'Pembatalan Request Upgrade', order: 1, active: true }]
      },
      {
        id: 'hr-can4',
        statusId: 'hs-cancel',
        name: 'Pembatalan Request Downgrade',
        order: 4,
        active: true,
        remarks: [{ id: 'hrm-can4-1', reasonId: 'hr-can4', name: 'Pembatalan Request Downgrade', order: 1, active: true }]
      },
      {
        id: 'hr-can5',
        statusId: 'hs-cancel',
        name: 'Dibatalkan Pelanggan Saat Kunjungan',
        order: 5,
        active: true,
        remarks: [
          { id: 'hrm-can5-1', reasonId: 'hr-can5', name: 'Pelanggan Menolak Biaya Pemasangan', order: 1, active: true },
          { id: 'hrm-can5-2', reasonId: 'hr-can5', name: 'Menolak Jalur Tarikan Kabel Rumah', order: 2, active: true }
        ]
      }
    ]
  },
  {
    id: 'hs-pending',
    name: 'PENDING',
    code: 'PENDING',
    color: '#F59E0B',
    order: 3,
    active: true,
    reasons: [
      {
        id: 'hr-p1',
        statusId: 'hs-pending',
        name: 'Kendala Redaman Tinggi / LOS',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-p1-1', reasonId: 'hr-p1', name: 'Loss Signal dari FAT / ODP', order: 1, active: true },
          { id: 'hrm-p1-2', reasonId: 'hr-p1', name: 'Kabel Dropcore Putus di Jalur Utama', order: 2, active: true }
        ]
      },
      {
        id: 'hr-p3',
        statusId: 'hs-pending',
        name: 'Akses Rumah / Lokasi Terkendala',
        order: 3,
        active: true,
        remarks: [
          { id: 'hrm-p3-1', reasonId: 'hr-p3', name: 'Portal Komplek / Cluster Terkunci', order: 1, active: true },
          { id: 'hrm-p3-2', reasonId: 'hr-p3', name: 'Izin Pengelola Gedung Belum Terbit', order: 2, active: true }
        ]
      },
      {
        id: 'hr-p4',
        statusId: 'hs-pending',
        name: 'Menunggu Material / Tim Tambahan',
        order: 4,
        active: true,
        remarks: [
          { id: 'hrm-p4-1', reasonId: 'hr-p4', name: 'Butuh Dropcore Panjang >150 Meter', order: 1, active: true },
          { id: 'hrm-p4-2', reasonId: 'hr-p4', name: 'Memerlukan Tiang Sisipan Tambahan', order: 2, active: true }
        ]
      },
      {
        id: 'hr-1793540563196',
        statusId: 'hs-pending',
        name: 'Power Fat Unstandart',
        code: 'POWER_FAT_UNSTANDART',
        order: 4,
        active: true,
        isActive: true,
        remarks: [{ id: 'hrm-1793540596369', reasonId: 'hr-1793540563196', name: 'Fat Loss', text: 'Fat Loss', order: 1, active: true, isActive: true }]
      },
      {
        id: 'hr-1793540611146',
        statusId: 'hs-pending',
        name: 'Fat Loss',
        code: 'FAT_LOSS',
        order: 5,
        active: true,
        isActive: true,
        remarks: []
      }
    ]
  },
  {
    id: 'hs-enroute',
    name: 'RESCHEDULE',
    code: 'RESCH',
    color: '#3B82F6',
    order: 4,
    active: true,
    reasons: [
      {
        id: 'hr-er1',
        statusId: 'hs-enroute',
        name: 'Teknisi Sedang Menuju Lokasi',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-er1-1', reasonId: 'hr-er1', name: 'Estimasi Tiba Sesuai Slot Waktu', order: 1, active: true },
          { id: 'hrm-er1-2', reasonId: 'hr-er1', name: 'Kendala Lalu Lintas / Cuaca Hujan', order: 2, active: true }
        ]
      }
    ]
  },
  {
    id: 'hs-onsite',
    name: 'ON SITE',
    code: 'ON_SITE',
    color: '#8B5CF6',
    order: 5,
    active: false,
    isActive: false,
    reasons: [
      {
        id: 'hr-os1',
        statusId: 'hs-onsite',
        name: 'Pemeriksaan Lapangan Berlangsung',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-os1-1', reasonId: 'hr-os1', name: 'Pengecekan Jalur FAT & Penarikan Kabel', order: 1, active: true },
          { id: 'hrm-os1-2', reasonId: 'hr-os1', name: 'Pemasangan Roset & Uji Redaman OPM', order: 2, active: true }
        ]
      }
    ]
  },
  {
    id: 'hs-installed',
    name: 'INSTALLED',
    code: 'INSTALLED',
    color: '#059669',
    order: 6,
    active: false,
    isActive: false,
    reasons: [
      {
        id: 'hr-inst1',
        statusId: 'hs-installed',
        name: 'Perangkat Baru Terpasang & Aktif',
        order: 1,
        active: true,
        remarks: [
          { id: 'hrm-inst1-1', reasonId: 'hr-inst1', name: 'ONT & WiFi Berfungsi Normal', order: 1, active: true },
          { id: 'hrm-inst1-2', reasonId: 'hr-inst1', name: 'Speedtest Sesuai Paket Layanan', order: 2, active: true }
        ]
      }
    ]
  },
  {
    id: 'hs-assigned',
    name: 'ASSIGNED',
    code: 'ASSIGNED',
    color: '#6366F1',
    order: 7,
    active: false,
    isActive: false,
    reasons: [
      {
        id: 'hr-as1',
        statusId: 'hs-assigned',
        name: 'Menunggu Keberangkatan Teknisi',
        order: 1,
        active: true,
        remarks: [{ id: 'hrm-as1-1', reasonId: 'hr-as1', name: 'Jadwal Sesuai Slot Waktu Pelanggan', order: 1, active: true }]
      }
    ]
  }
];
