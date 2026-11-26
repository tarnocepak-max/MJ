import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatWorkOrderAddress,
  buildTicketAddressSearchHaystack,
  isMeaningfulAddressValue
} from './addressFormatter.ts';

describe('formatWorkOrderAddress', () => {
  it('Case 1: formats complete address cleanly into 4 ordered lines without duplication', () => {
    const res = formatWorkOrderAddress({
      streetName:
        'JL. KEMANG TIMUR, BLOK A15, NO. 5, RT 002/RW 005, KEL. PAKU JAYA, KEC. SERPONG UTARA, KOTA TANGERANG SELATAN, BANTEN 15220',
      address:
        'Jl. Kemang Timur Blok A15 No. 5, RT 02 RW 05, Paku Jaya, Serpong Utara, Tangerang Selatan, Banten 15220',
      area: 'Tangerang Selatan',
      city: 'Kota Tangerang Selatan',
      postalCode: '15220'
    });

    assert.equal(res.line1, 'Jl. Kemang Timur, Blok A15, No. 5');
    assert.equal(res.line2, 'RT 002/RW 005, Kel. Paku Jaya');
    assert.equal(res.line3, 'Kec. Serpong Utara, Kota Tangerang Selatan');
    assert.equal(res.line4, 'Banten 15220');
    assert.deepEqual(res.lines, [
      'Jl. Kemang Timur, Blok A15, No. 5',
      'RT 002/RW 005, Kel. Paku Jaya',
      'Kec. Serpong Utara, Kota Tangerang Selatan',
      'Banten 15220'
    ]);

    assert.equal(res.formattedPrimaryText.match(/15220/g)?.length, 1);
    assert.equal(res.formattedPrimaryText.match(/Tangerang Selatan/gi)?.length, 1);
    assert.equal(res.formattedPrimaryText.match(/Serpong Utara/gi)?.length, 1);
  });

  it('Case 2: deduplicates RT/RW across multiple formats (RT 002/RW 005, RT 02/05, RT 2 RW 5)', () => {
    const res = formatWorkOrderAddress({
      streetName: 'Jl. Anggrek No. 10, RT 002 / RW 005, Kel. Pondok Jagung',
      address: 'Jl. Anggrek No. 10, RT 2 RW 5, Kel. Pondok Jagung',
      rawColumns: {
        rt: '02',
        rw: '05'
      }
    });

    assert.equal(res.line1, 'Jl. Anggrek No. 10');
    assert.equal(res.line2, 'RT 002/RW 005, Kel. Pondok Jagung');
    assert.equal(res.formattedPrimaryText.match(/RT/gi)?.length, 1);
    assert.equal(res.formattedPrimaryText.match(/RW/gi)?.length, 1);

    const compactSlashRes = formatWorkOrderAddress({
      streetName: 'Jl. Anggrek No. 10, RT 02/05, Kel. Pondok Jagung',
      rawColumns: { rw: '05' }
    });
    assert.equal(compactSlashRes.line1, 'Jl. Anggrek No. 10');
    assert.equal(compactSlashRes.line2, 'RT 02/RW 05, Kel. Pondok Jagung');
    assert.doesNotMatch(compactSlashRes.line1, /05/);
  });

  it('Case 3: handles address without RT/RW cleanly without empty labels or stray commas', () => {
    const res = formatWorkOrderAddress({
      streetName: 'Jl. Melati Indah Blok B2 No. 12',
      rawColumns: {
        kelurahan: 'Jelupang',
        kecamatan: 'Serpong Utara',
        provinsi: 'Banten'
      },
      city: 'Tangerang Selatan',
      postalCode: '15323'
    });

    assert.equal(res.line1, 'Jl. Melati Indah Blok B2 No. 12');
    assert.equal(res.line2, 'Kel. Jelupang');
    assert.equal(res.line3, 'Kec. Serpong Utara, Tangerang Selatan');
    assert.equal(res.line4, 'Banten 15323');
    assert.doesNotMatch(res.formattedPrimaryText, /RT|RW|undefined|null|^,|,\s*,/i);
  });

  it('Case 4: formats address with kelurahan/desa and kecamatan properly', () => {
    const res = formatWorkOrderAddress({
      streetName: 'Gg. Haji Misan No. 8, Desa Sukamaju, Kec. Cilodong, Kota Depok, Jawa Barat 16415',
      area: 'Depok'
    });

    assert.equal(res.line1, 'Gg. Haji Misan No. 8');
    assert.equal(res.line2, 'Desa Sukamaju');
    assert.equal(res.line3, 'Kec. Cilodong, Kota Depok');
    assert.equal(res.line4, 'Jawa Barat 16415');
  });

  it('Case 5: strips empty, null, placeholder ("-", "N/A") values without inventing fake data', () => {
    const emptyRes = formatWorkOrderAddress({
      streetName: '-',
      address: 'null',
      clusterName: 'N/A',
      area: '   ',
      city: 'undefined',
      postalCode: '-'
    });

    assert.equal(emptyRes.hasAddress, false);
    assert.deepEqual(emptyRes.lines, []);
    assert.deepEqual(emptyRes.additionalLocations, []);
    assert.equal(emptyRes.formattedPrimaryText, '');
    assert.equal(isMeaningfulAddressValue('N/A'), false);

    const partialRes = formatWorkOrderAddress({
      streetName: 'Jl. Kenanga No. 4',
      clusterName: '-',
      area: 'Bekasi',
      postalCode: 'N/A'
    });
    assert.deepEqual(partialRes.lines, ['Jl. Kenanga No. 4', 'Bekasi']);
    assert.deepEqual(partialRes.additionalLocations, []);
  });

  it('Case 6: normalizes existing HTML <br>, <br/>, \\r\\n, and \\n line breaks cleanly', () => {
    const res = formatWorkOrderAddress({
      streetName:
        'JL. BOULEVARD GRAHA RAYA<br/>BLOK G2<br>NO. 18\r\nRT 004 / RW 009<br />KEL. PAKU JAYA\nKEC. SERPONG UTARA, KOTA TANGERANG SELATAN<br/>BANTEN 15220',
      area: 'Tangerang Selatan',
      postalCode: '15220'
    });

    assert.equal(res.line1, 'Jl. Boulevard Graha Raya, Blok G2, No. 18');
    assert.equal(res.line2, 'RT 004/RW 009, Kel. Paku Jaya');
    assert.equal(res.line3, 'Kec. Serpong Utara, Kota Tangerang Selatan');
    assert.equal(res.line4, 'Banten 15220');
    assert.doesNotMatch(res.formattedPrimaryText, /<br|\r/i);
  });

  it('Case 7: preserves long address completely without truncation or silent data loss', () => {
    const longStreet =
      'Jl. Raya Boulevard Perumahan Alam Sutera Sektor 7 Barat Blok Magnolia Residence A15 Nomor 128B';
    const res = formatWorkOrderAddress({
      streetName: `${longStreet}, RT 011/RW 003, Kel. Pakualam, Kec. Serpong Utara, Kota Tangerang Selatan, Banten 15320`,
      clusterName: 'Alam Sutera Magnolia',
      streetAlternatif: 'Sebelah Taman Bermain Anak Gerbang Barat'
    });

    assert.ok(res.line1.includes('Magnolia Residence A15 Nomor 128B'));
    assert.equal(res.line2, 'RT 011/RW 003, Kel. Pakualam');
    assert.equal(res.line3, 'Kec. Serpong Utara, Kota Tangerang Selatan');
    assert.equal(res.line4, 'Banten 15320');
    assert.deepEqual(res.additionalLocations, [
      'Alam Sutera Magnolia',
      'Sebelah Taman Bermain Anak Gerbang Barat'
    ]);
  });

  it('Case 8: separates cluster, FDT landmark, and patokan into additionalLocations cleanly without mixing into primary lines', () => {
    const res = formatWorkOrderAddress({
      streetName:
        'JL. MAWAR INDAH<br/>BLOK A15<br/>NO. 5<br/>RT 002/RW 005 KEL. PAKU JAYA<br/>KEC. SERPONG UTARA, KOTA TANGERANG SELATAN, BANTEN 15220<br/>PAKU JAYA PERMAI FDT 2',
      clusterName: 'PAKU JAYA PERMAI',
      area: 'Tangerang Selatan',
      city: 'Kota Tangerang Selatan',
      postalCode: '15220',
      streetAlternatif: 'Dekat Gerbang Timur / Depan Masjid'
    });

    assert.deepEqual(res.lines, [
      'Jl. Mawar Indah, Blok A15, No. 5',
      'RT 002/RW 005, Kel. Paku Jaya',
      'Kec. Serpong Utara, Kota Tangerang Selatan',
      'Banten 15220'
    ]);

    assert.doesNotMatch(res.formattedPrimaryText, /PAKU JAYA PERMAI|FDT 2/i);

    assert.deepEqual(res.additionalLocations, [
      'Paku Jaya Permai',
      'Dekat Gerbang Timur',
      'Depan Masjid',
      'FDT 2'
    ]);

    const haystack = buildTicketAddressSearchHaystack({
      streetName: 'JL. MAWAR INDAH',
      clusterName: 'PAKU JAYA PERMAI',
      area: 'Tangerang Selatan',
      postalCode: '15220'
    });
    assert.ok(haystack.includes('paku jaya permai'));
    assert.ok(haystack.includes('15220'));
  });

  it('handles unprefixed Kecamatan & embedded cluster + FDT 2 even when clusterName is omitted', () => {
    const res = formatWorkOrderAddress({
      streetName:
        'Jalan Kemang Timur, Blok A15, No. 5\nSerpong Utara, Tangerang Selatan\nBanten 15220\nPAKU JAYA PERMAI FDT 2',
      area: 'Tangerang Selatan',
      postalCode: '15220'
    });

    assert.equal(res.line1, 'Jalan Kemang Timur, Blok A15, No. 5');
    assert.equal(res.line3, 'Kec. Serpong Utara, Tangerang Selatan');
    assert.equal(res.line4, 'Banten 15220');
    assert.doesNotMatch(res.line1, /Serpong Utara|PAKU JAYA PERMAI|FDT 2/i);
    assert.deepEqual(res.additionalLocations, ['FDT 2', 'Paku Jaya Permai']);
  });

  it('deduplicates Jalan vs Jl. / Nomor vs No. and strips duplicated leading cluster prefix in streetName', () => {
    const res = formatWorkOrderAddress({
      streetName: 'Jalan Mawar, Blok A15, No. 5',
      address: 'Jl. Mawar Blok A15 Nomor 5, Tangerang Selatan',
      area: 'Tangerang Selatan'
    });
    assert.equal(res.line1, 'Jalan Mawar, Blok A15, No. 5');
    assert.equal(res.line3, 'Tangerang Selatan');

    const clusterPrefixedRes = formatWorkOrderAddress({
      clusterName: 'Permata Hijau 2',
      streetName: 'Permata Hijau 2 Blok C No. 5',
      area: 'Jakarta Barat'
    });
    assert.equal(clusterPrefixedRes.line1, 'Blok C No. 5');
    assert.equal(clusterPrefixedRes.line3, 'Jakarta Barat');
    assert.deepEqual(clusterPrefixedRes.additionalLocations, ['Permata Hijau 2']);
  });

  it('deduplicates composite city/area strings containing province, kecamatan, or postal code', () => {
    const res = formatWorkOrderAddress({
      streetName: 'Jl. Kenanga No. 12',
      area: 'Serpong Utara, Tangerang Selatan, Banten',
      city: 'Kota Tangerang Selatan, Banten 15220',
      postalCode: '15220'
    });

    assert.equal(res.line1, 'Jl. Kenanga No. 12');
    assert.equal(res.line3, 'Kec. Serpong Utara, Kota Tangerang Selatan');
    assert.equal(res.line4, 'Banten 15220');
    assert.equal(res.formattedPrimaryText.match(/Banten/gi)?.length, 1);
    assert.equal(res.formattedPrimaryText.match(/15220/g)?.length, 1);
    assert.equal(res.formattedPrimaryText.match(/Tangerang Selatan/gi)?.length, 1);
  });

  it('handles abbreviations missing space after period (JL.MAWAR NO.5, KEL.PAKU JAYA, KEC.SERPONG UTARA)', () => {
    const res = formatWorkOrderAddress({
      streetName: 'JL.MAWAR NO.5, RT.01/RW.02, KEL.PAKU JAYA, KEC.SERPONG UTARA, TANGERANG SELATAN, BANTEN 15220'
    });

    assert.equal(res.line1, 'Jl. Mawar No. 5');
    assert.equal(res.line2, 'RT 01/RW 02, Kel. Paku Jaya');
    assert.equal(res.line3, 'Kec. Serpong Utara, Tangerang Selatan');
    assert.equal(res.line4, 'Banten 15220');
  });

  it('supports direct top-level rt/rw/kelurahan/kecamatan/province fields and keeps FDT inside descriptive landmark sentences', () => {
    const res = formatWorkOrderAddress({
      streetName: 'Blok C No. 5',
      clusterName: 'PAKU JAYA PERMAI',
      rt: '02',
      rw: '05',
      kelurahan: 'Pela Mampang',
      kecamatan: 'Mampang Prapatan',
      city: 'Jakarta Selatan',
      province: 'DKI Jakarta',
      postalCode: '12730',
      streetAlternatif: 'Patokan: Seberang Gerbang FDT 2'
    });

    assert.equal(res.line1, 'Blok C No. 5');
    assert.equal(res.line2, 'RT 02/RW 05, Kel. Pela Mampang');
    assert.equal(res.line3, 'Kec. Mampang Prapatan, Jakarta Selatan');
    assert.equal(res.line4, 'DKI Jakarta 12730');
    assert.deepEqual(res.additionalLocations, [
      'Paku Jaya Permai',
      'Patokan: Seberang Gerbang FDT 2'
    ]);
  });
});

