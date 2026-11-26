import { Ticket } from '../types/index.ts';

export interface AddressInput {
  streetName?: string | null;
  address?: string | null;
  streetAlternatif?: string | null;
  clusterName?: string | null;
  area?: string | null;
  city?: string | null;
  postalCode?: string | null;
  regionName?: string | null;
  rt?: string | null;
  rw?: string | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  province?: string | null;
  rawColumns?: Record<string, string | number | null | undefined>;
  additionalFields?: Record<string, string | number | null | undefined>;
}

export interface FormattedWorkOrderAddress {
  /** Baris 1: Jalan, blok, nomor rumah */
  line1: string;
  /** Baris 2: RT/RW, kelurahan/desa */
  line2: string;
  /** Baris 3: Kecamatan, kota/kabupaten */
  line3: string;
  /** Baris 4: Provinsi dan kode pos */
  line4: string;
  /** Non-empty primary address lines in exact order (Baris 1..4) */
  lines: string[];
  /** Separated landmark / cluster / FDT / patokan metadata */
  additionalLocations: string[];
  /** Multi-line formatted primary address (Baris 1..4) */
  formattedPrimaryText: string;
  /** Compact single-line representation without duplication */
  formattedSingleLine: string;
  /** Clean clipboard-ready text including additionalLocations */
  copyText: string;
  /** Clean deduplicated query string suitable for Google Maps search */
  mapsQueryText: string;
  /** True if at least one primary line or additional location exists */
  hasAddress: boolean;
}

const EMPTY_PLACEHOLDER_SET = new Set([
  '-',
  '--',
  '---',
  '.',
  '..',
  ',',
  '/',
  '|',
  'null',
  'undefined',
  'n/a',
  'na',
  'none',
  'nil',
  'kosong',
  'tidak ada',
  'belum ada',
  'belum tersedia',
  'alamat belum tersedia',
  'alamat tidak tersedia'
]);

const INDONESIAN_PROVINCES: ReadonlyArray<{ pattern: RegExp; canonical: string }> = [
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?D\.?K\.?I\.?\s+JAKARTA\b/i, canonical: 'DKI Jakarta' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?(?:DI|D\.I\.?)\s+YOGYAKARTA\b/i, canonical: 'DI Yogyakarta' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?JAWA\s+BARAT\b/i, canonical: 'Jawa Barat' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?JAWA\s+TENGAH\b/i, canonical: 'Jawa Tengah' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?JAWA\s+TIMUR\b/i, canonical: 'Jawa Timur' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?BANTEN\b/i, canonical: 'Banten' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?BALI\b/i, canonical: 'Bali' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?ACEH\b/i, canonical: 'Aceh' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?SUMATERA\s+UTARA\b/i, canonical: 'Sumatera Utara' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?SUMATERA\s+BARAT\b/i, canonical: 'Sumatera Barat' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?SUMATERA\s+SELATAN\b/i, canonical: 'Sumatera Selatan' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?KEP(?:ULAUAN)?\.?\s+RIAU\b/i, canonical: 'Kepulauan Riau' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?RIAU\b/i, canonical: 'Riau' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?JAMBI\b/i, canonical: 'Jambi' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?BENGKULU\b/i, canonical: 'Bengkulu' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?LAMPUNG\b/i, canonical: 'Lampung' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?KEP(?:ULAUAN)?\.?\s+BANGKA\s+BELITUNG\b/i, canonical: 'Kepulauan Bangka Belitung' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?BANGKA\s+BELITUNG\b/i, canonical: 'Kepulauan Bangka Belitung' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?KALIMANTAN\s+BARAT\b/i, canonical: 'Kalimantan Barat' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?KALIMANTAN\s+TENGAH\b/i, canonical: 'Kalimantan Tengah' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?KALIMANTAN\s+SELATAN\b/i, canonical: 'Kalimantan Selatan' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?KALIMANTAN\s+TIMUR\b/i, canonical: 'Kalimantan Timur' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?KALIMANTAN\s+UTARA\b/i, canonical: 'Kalimantan Utara' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?SULAWESI\s+UTARA\b/i, canonical: 'Sulawesi Utara' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?SULAWESI\s+TENGAH\b/i, canonical: 'Sulawesi Tengah' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?SULAWESI\s+SELATAN\b/i, canonical: 'Sulawesi Selatan' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?SULAWESI\s+TENGGARA\b/i, canonical: 'Sulawesi Tenggara' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?SULAWESI\s+BARAT\b/i, canonical: 'Sulawesi Barat' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?GORONTALO\b/i, canonical: 'Gorontalo' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?NUSA\s+TENGGARA\s+BARAT\b/i, canonical: 'Nusa Tenggara Barat' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?NUSA\s+TENGGARA\s+TIMUR\b/i, canonical: 'Nusa Tenggara Timur' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?MALUKU\s+UTARA\b/i, canonical: 'Maluku Utara' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?MALUKU\b/i, canonical: 'Maluku' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?PAPUA\s+BARAT\s+DAYA\b/i, canonical: 'Papua Barat Daya' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?PAPUA\s+BARAT\b/i, canonical: 'Papua Barat' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?PAPUA\s+SELATAN\b/i, canonical: 'Papua Selatan' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?PAPUA\s+TENGAH\b/i, canonical: 'Papua Tengah' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?PAPUA\s+PEGUNUNGAN\b/i, canonical: 'Papua Pegunungan' },
  { pattern: /\b(?:PROV(?:INSI)?\.?\s+)?PAPUA\b/i, canonical: 'Papua' }
];

const KNOWN_INDONESIAN_CITIES_RE =
  /^(?:kota\s+(?:adm(?:\.|inistrasi)?\s+)?|kab(?:\.|upaten)?\s+|kodya\s+|kotamadya\s+)?(?:jakarta\s+(?:pusat|utara|barat|selatan|timur)|kepulauan\s+seribu|tangerang\s+selatan|tangsel|tangerang|serang|cilegon|lebak|pandeglang|bekasi|depok|bogor|karawang|purwakarta|subang|bandung(?:\s+barat)?|cimahi|sumedang|garut|tasikmalaya|cirebon|indramayu|sukabumi|cianjur|semarang|yogyakarta|sleman|bantul|surakarta|solo|magelang|salatiga|pekalongan|tegal|cilacap|banyumas|purwokerto|surabaya|sidoarjo|gresik|malang|batu|mojokerto|kediri|madiun|pasuruan|probolinggo|jember|banyuwangi|medan|binjai|deli\s+serdang|pematangsiantar|pekanbaru|dumai|batam|tanjungpinang|padang|bukittinggi|palembang|prabumulih|jambi|bengkulu|bandar\s+lampung|metro|pangkalpinang|denpasar|badung|gianyar|tabanan|mataram|kupang|pontianak|singkawang|banjarmasin|banjarbaru|palangkaraya|samarinda|balikpapan|bontang|tarakan|makassar|gowa|maros|parepare|palopo|manado|bitung|palu|kendari|gorontalo|mamuju|ambon|ternate|jayapura|sorong|manokwari)$/i;

const KNOWN_INDONESIAN_KECAMATAN_RE =
  /^(?:serpong\s+utara|serpong|pondok\s+aren|ciputat\s+timur|ciputat|pamulang|setu|kelapa\s+dua|cisauk|pagedangan|curug|cikupa|balaraja|karawaci|ciledug|cipondoh|pinang|larangan|batuceper|benda|neglasari|periuk|jatiuwung|cibodas|karang\s+tengah|kebayoran\s+baru|kebayoran\s+lama|cilandak|pasar\s+minggu|jagakarsa|mampang\s+prapatan|pancoran|tebet|setiabudi|pesanggrahan|kembangan|kebon\s+jeruk|palmerah|grogol\s+petamburan|tambora|taman\s+sari|cengkareng|kalideres|menteng|tanah\s+abang|gambir|sawah\s+besar|kemayoran|senen|cempaka\s+putih|johar\s+baru|penjaringan|pademangan|tanjung\s+priok|koja|kelapa\s+gading|cilincing|matraman|pulo\s+gadung|jatinegara|duren\s+sawit|kramat\s+jati|makasar|pasar\s+rebo|ciracas|cipayung|cakung|beji|pancoran\s+mas|sukmajaya|cilodong|cimanggis|tapos|sawangan|bojongsari|limo|cinere|bekasi\s+barat|bekasi\s+timur|bekasi\s+selatan|bekasi\s+utara|medan\s+satria|rawalumbu|bantargebang|pondok\s+gede|pondok\s+melati|jatiasih|jatisampurna|mustika\s+jaya|tambun\s+selatan|tambun\s+utara|cikarang\s+barat|cikarang\s+utara|cikarang\s+selatan|cikarang\s+timur|cikarang\s+pusat|cibitung|cibinong|gunung\s+putri|citeureup|babakan\s+madang|bojonggede|parung|cileungsi|bogor\s+tengah|bogor\s+utara|bogor\s+selatan|bogor\s+timur|bogor\s+barat|tanah\s+sareal)$/i;

const RESIDENTIAL_COMPLEX_SUFFIX_RE =
  /\b(?:permai|residence|residences|estate|gardens?|regency|village|park|hills?|terrace|townhouse|mansion|heights|clust(?:er)?|perum(?:ahan)?|komp(?:lek)?|villa|sektor\s*\d+)\b/i;

const RESIDENTIAL_COMPLEX_PREFIX_RE =
  /^(?:cluster|perum(?:ahan)?|komp(?:lek)?|residence|townhouse|villa|graha|puri|taman|bukit)\s+/i;

const UPPERCASE_PRESERVE = new Set([
  'RT',
  'RW',
  'FDT',
  'FAT',
  'ODP',
  'ONT',
  'FTTH',
  'DKI',
  'DI',
  'BSD',
  'PIK',
  'BINTARO',
  'KM',
  'II',
  'III',
  'IV',
  'VI',
  'VII',
  'VIII',
  'IX',
  'XI',
  'XII'
]);

const LOWERCASE_CONNECTORS = new Set(['dan', 'di', 'ke', 'dari', 'atau']);

export function decodeHtmlAndBreaks(raw?: unknown): string {
  if (raw === null || raw === undefined) return '';
  let str = String(raw);
  str = str
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|li)[^>]*>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  return str
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function isMeaningfulAddressValue(value?: unknown): value is string {
  if (value === null || value === undefined) return false;
  const cleaned = decodeHtmlAndBreaks(value)
    .replace(/^[,;:\-\s/|]+|[,;:\-\s/|]+$/g, '')
    .trim();
  if (!cleaned) return false;
  return !EMPTY_PLACEHOLDER_SET.has(cleaned.toLowerCase());
}

function normalizeComparisonKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStreetCompareKey(value: string): string {
  return normalizeComparisonKey(value)
    .replace(/\b(?:jalan|jln)\b/g, 'jl')
    .replace(/\b(?:nomor|nomer)\b/g, 'no')
    .replace(/\b(?:block|blk)\b/g, 'blok')
    .replace(/\bgang\b/g, 'gg')
    .replace(/\bkavling\b/g, 'kav')
    .replace(/\blantai\b/g, 'lt')
    .replace(/\bkelurahan\b/g, 'kel')
    .replace(/\bkecamatan\b/g, 'kec')
    .replace(/\bkabupaten\b/g, 'kab')
    .replace(/\bprovinsi\b/g, 'prov')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripAdminPrefixKey(value: string): string {
  return normalizeComparisonKey(value)
    .replace(
      /^(?:kelurahan|kel|desa|ds|kecamatan|kec|kota administrasi|kota adm|kotamadya|kodya|kota|kabupaten|kab|provinsi|prov)\s+/i,
      ''
    )
    .trim();
}

function smartCapitalizeSegment(raw: string): string {
  const cleaned = raw
    .replace(/\b(jl|jln|no|kel|kec|kab|ds|gg|rt|rw|blok)\.([A-Za-z0-9])/gi, '$1. $2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,{2,}/g, ',')
    .replace(/^[,.\s/|]+|[,.\s/|]+$/g, '')
    .trim();
  if (!cleaned) return '';

  const letters = cleaned.replace(/[^A-Za-z]/g, '');
  const isMostlyAllCaps = letters.length >= 3 && letters === letters.toUpperCase();
  const isAllLower = letters.length >= 3 && letters === letters.toLowerCase();

  if (!isMostlyAllCaps && !isAllLower) {
    return cleaned
      .replace(/\b(?:jl|jln)\.?(?=\s|$)/gi, 'Jl.')
      .replace(/\bno\.?\s*(?=\d)/gi, 'No. ')
      .replace(/\b(?:blok|block)\b/gi, 'Blok')
      .replace(/\bkel\.?(?=\s|$)/gi, 'Kel.')
      .replace(/\bkec\.?(?=\s|$)/gi, 'Kec.')
      .replace(/\bkab\.?(?=\s|$)/gi, 'Kab.')
      .replace(/\b(?:rt)\b/gi, 'RT')
      .replace(/\b(?:rw)\b/gi, 'RW')
      .replace(/\b(fdt|fat|odp)\b/gi, (_, code: string) => code.toUpperCase())
      .replace(/\.{2,}/g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const tokens = cleaned.split(' ');
  return tokens
    .map((token, idx) => {
      const bare = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      const upperBare = bare.toUpperCase();
      if (!bare) return token;

      if (UPPERCASE_PRESERVE.has(upperBare)) {
        return token.replace(bare, upperBare);
      }
      // Alphanumeric unit/block codes like A15, B2, 5A, 12B, A15/5, B-12, AA-03
      if (
        /^(?:[A-Za-z]{1,2}\d+[A-Za-z0-9/-]*|\d+[A-Za-z]{1,2}(?:[/-]\d+)?)$/.test(bare) &&
        bare.length <= 12
      ) {
        return token.replace(bare, upperBare);
      }
      if (/^(?:jl|jln)\.?$/i.test(token)) return 'Jl.';
      if (/^no\.?$/i.test(token)) return 'No.';
      if (/^kel\.?$/i.test(token)) return 'Kel.';
      if (/^kec\.?$/i.test(token)) return 'Kec.';
      if (/^kab\.?$/i.test(token)) return 'Kab.';
      if (/^gg\.?$/i.test(token)) return 'Gg.';
      if (/^(?:blok|block)\.?$/i.test(token)) return 'Blok';

      const lower = bare.toLowerCase();
      if (idx > 0 && LOWERCASE_CONNECTORS.has(lower)) {
        return token.replace(bare, lower);
      }
      const titled = lower.charAt(0).toUpperCase() + lower.slice(1);
      return token.replace(bare, titled);
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFieldFromRecord(
  record: Record<string, unknown> | undefined,
  candidateKeys: string[]
): string {
  if (!record || typeof record !== 'object') return '';
  for (const [rawKey, rawVal] of Object.entries(record)) {
    const normKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (candidateKeys.includes(normKey) && isMeaningfulAddressValue(rawVal)) {
      return decodeHtmlAndBreaks(rawVal);
    }
  }
  return '';
}

function matchIndonesianProvince(segment: string): string {
  for (const prov of INDONESIAN_PROVINCES) {
    if (prov.pattern.test(segment)) {
      return prov.canonical;
    }
  }
  return '';
}

function isCityOrAreaString(segment: string, knownCity?: string, knownArea?: string): boolean {
  const normSeg = stripAdminPrefixKey(segment);
  if (!normSeg) return false;
  if (knownCity && stripAdminPrefixKey(knownCity) === normSeg) return true;
  if (knownArea && stripAdminPrefixKey(knownArea) === normSeg) return true;
  if (/^(?:kota(?:\s+adm(?:inistrasi)?\.?)?|kab(?:upaten)?\.?|kodya|kotamadya)\s+[a-z]/i.test(segment.trim())) {
    return true;
  }
  return KNOWN_INDONESIAN_CITIES_RE.test(segment.trim());
}

function formatRtRwPair(rtRaw: string, rwRaw: string): { key: string; label: string } {
  const rtNum = parseInt(rtRaw, 10);
  const rwNum = parseInt(rwRaw, 10);
  const targetLen = rtRaw.length >= 3 || rwRaw.length >= 3 ? 3 : 2;
  const rtStr = String(rtNum).padStart(targetLen, '0');
  const rwStr = String(rwNum).padStart(targetLen, '0');
  return {
    key: `rt:${rtNum}-rw:${rwNum}`,
    label: `RT ${rtStr}/RW ${rwStr}`
  };
}

function isStreetLikeChunk(chunk: string): boolean {
  return /\b(?:jl\.?|jalan|jln\.?|gg\.?|gang|blok|block|no\.?|nomor|nomer|kav\.?|kavling|ruko|tower|apartemen|lantai|lt\.?)\b/i.test(
    chunk
  );
}

function isBareLocationPhrase(chunk: string): boolean {
  if (!chunk) return false;
  if (isStreetLikeChunk(chunk)) return false;
  if (/\d/.test(chunk)) return false;
  if (/\b(?:dekat|depan|samping|sebelah|belakang|seberang|patokan|landmark)\b/i.test(chunk)) return false;
  const words = chunk.trim().split(/\s+/);
  return words.length >= 1 && words.length <= 4;
}

function normalizeLine1CommaSegments(rawStreetSegments: string[]): string {
  const flatParts: string[] = [];

  for (const seg of rawStreetSegments) {
    const subParts = seg
      .split(',')
      .map(p => smartCapitalizeSegment(p))
      .filter(p => isMeaningfulAddressValue(p));

    for (const part of subParts) {
      const key = normalizeStreetCompareKey(part);
      if (!key) continue;

      const joinedExisting = normalizeStreetCompareKey(flatParts.join(' '));
      const alreadyContained =
        joinedExisting === key ||
        (joinedExisting.length >= key.length && joinedExisting.includes(key)) ||
        flatParts.some(existing => {
          const existingKey = normalizeStreetCompareKey(existing);
          return (
            existingKey === key ||
            (existingKey.length >= key.length && existingKey.includes(key))
          );
        });
      if (alreadyContained) continue;

      // If the new part strictly supersedes a shorter already-added segment (e.g. "Jl. Mawar" -> "Jl. Mawar Blok A15 No. 5"),
      // upgrade the shorter segment in-place instead of repeating the street name.
      const supersededIdx = flatParts.findIndex(existing => {
        const existingKey = normalizeStreetCompareKey(existing);
        return key.length > existingKey.length + 2 && key.includes(existingKey);
      });
      if (supersededIdx >= 0) {
        flatParts[supersededIdx] = part;
        continue;
      }

      flatParts.push(part);
    }
  }

  if (flatParts.length === 0) return '';

  return flatParts
    .map(p => p.replace(/,\s*$/g, '').trim())
    .filter(Boolean)
    .join(', ');
}

export function formatWorkOrderAddress(
  input?: Partial<Ticket> | AddressInput | null
): FormattedWorkOrderAddress {
  if (!input) {
    return {
      line1: '',
      line2: '',
      line3: '',
      line4: '',
      lines: [],
      additionalLocations: [],
      formattedPrimaryText: '',
      formattedSingleLine: '',
      copyText: '',
      mapsQueryText: '',
      hasAddress: false
    };
  }

  const rawColumns = ('rawColumns' in input ? input.rawColumns : undefined) as
    | Record<string, unknown>
    | undefined;
  const additionalFields = ('additionalFields' in input ? input.additionalFields : undefined) as
    | Record<string, unknown>
    | undefined;

  const extraStreet =
    getFieldFromRecord(rawColumns, ['streetname', 'street', 'jalan', 'namajalan', 'alamatjalan', 'addressline1']) ||
    getFieldFromRecord(additionalFields, ['streetname', 'street', 'jalan', 'namajalan', 'alamatjalan', 'addressline1']);
  const extraBlok =
    getFieldFromRecord(rawColumns, ['blok', 'block']) ||
    getFieldFromRecord(additionalFields, ['blok', 'block']);
  const extraHouseNo =
    getFieldFromRecord(rawColumns, ['norumah', 'nomorrumah', 'housenumber', 'no', 'nomor']) ||
    getFieldFromRecord(additionalFields, ['norumah', 'nomorrumah', 'housenumber']);
  const extraCluster =
    getFieldFromRecord(rawColumns, ['cluster', 'clustername', 'perumahan', 'komplek']) ||
    getFieldFromRecord(additionalFields, ['cluster', 'clustername', 'perumahan', 'komplek']);
  const extraCity =
    getFieldFromRecord(rawColumns, ['kota', 'city', 'kabupaten', 'kab']) ||
    getFieldFromRecord(additionalFields, ['kota', 'city', 'kabupaten', 'kab']);
  const extraArea =
    getFieldFromRecord(rawColumns, ['area', 'wilayah', 'region']) ||
    getFieldFromRecord(additionalFields, ['area', 'wilayah', 'region']);

  const rawStreetName = isMeaningfulAddressValue(input.streetName)
    ? decodeHtmlAndBreaks(input.streetName)
    : extraStreet;
  const rawAddressFallback = isMeaningfulAddressValue(input.address)
    ? decodeHtmlAndBreaks(input.address)
    : '';

  const structuredClusterRaw = isMeaningfulAddressValue(input.clusterName)
    ? decodeHtmlAndBreaks(input.clusterName)
    : extraCluster;
  const structuredCluster = structuredClusterRaw ? smartCapitalizeSegment(structuredClusterRaw) : '';

  const structuredAreaRaw = isMeaningfulAddressValue(input.area)
    ? decodeHtmlAndBreaks(input.area)
    : extraArea;
  const structuredCityRaw = isMeaningfulAddressValue(input.city)
    ? decodeHtmlAndBreaks(input.city)
    : extraCity;
  const structuredRegionRaw = isMeaningfulAddressValue(input.regionName)
    ? decodeHtmlAndBreaks(input.regionName)
    : '';

  const structuredPostalRaw = isMeaningfulAddressValue(input.postalCode)
    ? decodeHtmlAndBreaks(input.postalCode).match(/[1-9]\d{4}/)?.[0] || ''
    : '';
  const structuredAlt = isMeaningfulAddressValue(input.streetAlternatif)
    ? decodeHtmlAndBreaks(input.streetAlternatif)
    : '';

  const directRt = 'rt' in input && isMeaningfulAddressValue(input.rt) ? decodeHtmlAndBreaks(input.rt) : '';
  const directRw = 'rw' in input && isMeaningfulAddressValue(input.rw) ? decodeHtmlAndBreaks(input.rw) : '';
  const directKelurahan =
    'kelurahan' in input && isMeaningfulAddressValue(input.kelurahan)
      ? decodeHtmlAndBreaks(input.kelurahan)
      : '';
  const directKecamatan =
    'kecamatan' in input && isMeaningfulAddressValue(input.kecamatan)
      ? decodeHtmlAndBreaks(input.kecamatan)
      : '';
  const directProvince =
    'province' in input && isMeaningfulAddressValue(input.province)
      ? decodeHtmlAndBreaks(input.province)
      : '';

  const extraRt =
    directRt ||
    getFieldFromRecord(rawColumns, ['rt']) ||
    getFieldFromRecord(additionalFields, ['rt']);
  const extraRw =
    directRw ||
    getFieldFromRecord(rawColumns, ['rw']) ||
    getFieldFromRecord(additionalFields, ['rw']);
  const extraRtRw =
    getFieldFromRecord(rawColumns, ['rtrw']) || getFieldFromRecord(additionalFields, ['rtrw']);
  const extraKelurahan =
    directKelurahan ||
    getFieldFromRecord(rawColumns, ['kelurahan', 'desa', 'subdistrict', 'village']) ||
    getFieldFromRecord(additionalFields, ['kelurahan', 'desa', 'subdistrict', 'village']);
  const extraKecamatan =
    directKecamatan ||
    getFieldFromRecord(rawColumns, ['kecamatan', 'district']) ||
    getFieldFromRecord(additionalFields, ['kecamatan', 'district']);
  const extraProvince =
    directProvince ||
    getFieldFromRecord(rawColumns, ['provinsi', 'province', 'propinsi']) ||
    getFieldFromRecord(additionalFields, ['provinsi', 'province', 'propinsi']);
  const extraPostal =
    getFieldFromRecord(rawColumns, ['postalcode', 'kodepos', 'zipcode']) ||
    getFieldFromRecord(additionalFields, ['postalcode', 'kodepos', 'zipcode']);
  const extraPatokan =
    getFieldFromRecord(rawColumns, ['patokan', 'landmark', 'referensi']) ||
    getFieldFromRecord(additionalFields, ['patokan', 'landmark', 'referensi']);

  let rtVal = extraRt.match(/\d{1,3}/)?.[0] || '';
  let rwVal = extraRw.match(/\d{1,3}/)?.[0] || '';
  if (extraRtRw) {
    const m = extraRtRw.match(/(\d{1,3})\s*[/\-,\s]+\s*(\d{1,3})/);
    if (m) {
      rtVal = rtVal || m[1];
      rwVal = rwVal || m[2];
    }
  }

  let kelurahanLabel = extraKelurahan
    ? (() => {
        const prefixMatch = extraKelurahan.match(/^(kel\.?|kelurahan|desa|ds\.?)\s+(.+)$/i);
        if (prefixMatch) {
          const p = /^(?:desa|ds\.?)$/i.test(prefixMatch[1]) ? 'Desa' : 'Kel.';
          return `${p} ${smartCapitalizeSegment(prefixMatch[2])}`;
        }
        return `Kel. ${smartCapitalizeSegment(extraKelurahan)}`;
      })()
    : '';
  let kecamatanLabel = extraKecamatan
    ? (() => {
        const prefixMatch = extraKecamatan.match(/^(kec\.?|kecamatan)\s+(.+)$/i);
        const core = prefixMatch ? prefixMatch[2] : extraKecamatan;
        return `Kec. ${smartCapitalizeSegment(core)}`;
      })()
    : '';

  let provinceLabel = extraProvince
    ? smartCapitalizeSegment(extraProvince.replace(/^prov(?:insi)?\.?\s+/i, ''))
    : '';
  let postalCode = structuredPostalRaw || extraPostal.match(/[1-9]\d{4}/)?.[0] || '';

  // Parse composite city/area/region fields cleanly so embedded province/postal/kecamatan never duplicate
  const sanitizeAdminCompositeField = (rawField: string): string => {
    if (!rawField) return '';
    let working = rawField.trim();
    working = working.replace(/\b(?:kode\s*pos|zip\s*code)?\s*([1-9]\d{4})\b/gi, (_f, zip: string) => {
      if (!postalCode) postalCode = zip;
      return ', ';
    });
    for (const prov of INDONESIAN_PROVINCES) {
      if (prov.pattern.test(working)) {
        if (!provinceLabel) provinceLabel = prov.canonical;
        working = working.replace(prov.pattern, ', ');
      }
    }
    working = working.replace(
      /\b(?:kec\.?|kecamatan)\s+([^,;\n]+?)(?=(?:\s+\b(?:kota|kab\.?|kabupaten)\b|[,;\n]|$))/gi,
      (_f, name: string) => {
        const trimmed = name.trim();
        if (isMeaningfulAddressValue(trimmed) && !kecamatanLabel) {
          kecamatanLabel = `Kec. ${smartCapitalizeSegment(trimmed)}`;
        }
        return ', ';
      }
    );
    working = working.replace(
      /\b(?:kel\.?|kelurahan|desa|ds\.?)\s+([^,;\n]+?)(?=(?:\s+\b(?:kec\.?|kecamatan|kota|kab\.?|kabupaten)\b|[,;\n]|$))/gi,
      (full, name: string) => {
        const prefix = /^\s*(?:desa|ds\.?)\b/i.test(full) ? 'Desa' : 'Kel.';
        const trimmed = name.trim();
        if (isMeaningfulAddressValue(trimmed) && !kelurahanLabel) {
          kelurahanLabel = `${prefix} ${smartCapitalizeSegment(trimmed)}`;
        }
        return ', ';
      }
    );

    const remaining: string[] = [];
    for (const part of working.split(/[,;]+/).map(s => s.trim()).filter(isMeaningfulAddressValue)) {
      if (KNOWN_INDONESIAN_KECAMATAN_RE.test(part)) {
        if (!kecamatanLabel) kecamatanLabel = `Kec. ${smartCapitalizeSegment(part)}`;
        continue;
      }
      remaining.push(smartCapitalizeSegment(part));
    }
    return remaining.join(', ');
  };

  let cityLabel = sanitizeAdminCompositeField(structuredCityRaw);
  const areaLabel = sanitizeAdminCompositeField(structuredAreaRaw);
  if (structuredRegionRaw) {
    sanitizeAdminCompositeField(structuredRegionRaw);
  }

  const streetSegments: string[] = [];
  const additionalLocations: string[] = [];
  const seenAdditionalKeys = new Set<string>();

  const addAdditionalLocation = (rawLoc: string) => {
    const cleaned = smartCapitalizeSegment(rawLoc);
    if (!isMeaningfulAddressValue(cleaned)) return;
    const isLandmarkSentence =
      /\b(?:patokan|landmark|ancer|dekat|depan|sebelah|belakang|samping|seberang|gerbang|pos|masjid|mushola|gereja|sekolah|indomaret|alfamart|titip|kunci|arah|masuk)\b/i.test(
        cleaned
      );
    const fdtSplit = cleaned.match(/^(.*?)\s*\b((?:FDT|FAT|ODP)\s*[-#:]?\s*[A-Z0-9\-]*\d[A-Z0-9\-]*)\b(.*)$/i);
    if (!isLandmarkSentence && fdtSplit && (fdtSplit[1].trim() || fdtSplit[3].trim())) {
      const before = `${fdtSplit[1]} ${fdtSplit[3]}`.trim();
      const code = fdtSplit[2].replace(/\s+/g, ' ').toUpperCase();
      if (before) addAdditionalLocation(before);
      addAdditionalLocation(code);
      return;
    }

    const key = normalizeComparisonKey(cleaned);
    if (!key) return;
    if (
      (cityLabel && stripAdminPrefixKey(cityLabel) === stripAdminPrefixKey(cleaned)) ||
      (areaLabel && stripAdminPrefixKey(areaLabel) === stripAdminPrefixKey(cleaned)) ||
      (provinceLabel && stripAdminPrefixKey(provinceLabel) === stripAdminPrefixKey(cleaned)) ||
      (kecamatanLabel && stripAdminPrefixKey(kecamatanLabel) === stripAdminPrefixKey(cleaned)) ||
      (kelurahanLabel && stripAdminPrefixKey(kelurahanLabel) === stripAdminPrefixKey(cleaned)) ||
      (postalCode && key === postalCode)
    ) {
      return;
    }
    if (seenAdditionalKeys.has(key)) return;
    seenAdditionalKeys.add(key);
    additionalLocations.push(cleaned);
  };

  if (structuredCluster) addAdditionalLocation(structuredCluster);
  if (structuredAlt) {
    for (const part of structuredAlt.split(/[\n;|/]+/)) {
      if (isMeaningfulAddressValue(part)) addAdditionalLocation(part);
    }
  }
  if (extraPatokan) addAdditionalLocation(extraPatokan);

  const rawLinesPool: string[] = [];
  if (rawStreetName) {
    rawLinesPool.push(...rawStreetName.split('\n'));
  }
  if (rawAddressFallback) {
    rawLinesPool.push(...rawAddressFallback.split('\n'));
  }

  const normalizedClusterKey = structuredCluster ? normalizeComparisonKey(structuredCluster) : '';
  const clusterBareKey = normalizedClusterKey
    .replace(/^(?:cluster|perumahan|perum|komplek|komp|villa)\s+/i, '')
    .trim();

  // Pass 1: Extract structured tokens (FDT/FAT/ODP, landmarks, RT/RW, postal code, province, kelurahan, kecamatan)
  // and preserve ordered candidate chunks along with whether FDT/landmark metadata was stripped from each chunk.
  const candidateChunks: Array<{ text: string; hadTechLandmark: boolean }> = [];

  for (const rawLine of rawLinesPool) {
    let working = rawLine
      .trim()
      .replace(/\b(jl|jln|no|kel|kec|kab|ds|gg|rt|rw|blok)\.([A-Za-z0-9])/gi, '$1. $2');
    if (!isMeaningfulAddressValue(working)) continue;

    // 1. Extract explicit FDT / FAT / ODP landmarks inside text line (requires digit in code)
    let lineHadTechLandmark = false;
    working = working.replace(
      /(?:^|[\s,(]+)(?:dekat\s+|area\s+)?((?:FDT|FAT|ODP)\s*[-#:]?\s*[A-Z0-9\-]*\d[A-Z0-9\-]*)(?=[\s,)]|$)/gi,
      (_full, code: string) => {
        lineHadTechLandmark = true;
        addAdditionalLocation(code.replace(/\s+/g, ' ').toUpperCase());
        return ', ';
      }
    );

    // 2. Extract explicit Patokan / Landmark clauses
    working = working.replace(
      /(?:^|[,;\s]+)(?:patokan|landmark|ancer[\s-]*ancer)\s*[:\-]?\s*([^,;\n]+)/gi,
      (_full, landmark: string) => {
        addAdditionalLocation(landmark);
        return ', ';
      }
    );

    // 3. Extract parenthetical landmarks e.g. "(Depan Masjid)" or "(Dekat Gerbang)"
    working = working.replace(/\(([^)]{3,60})\)/g, (full, inside: string) => {
      if (
        /\b(?:dekat|depan|sebelah|belakang|samping|masuk|gerbang|pos|masjid|mushola|indomaret|alfamart|fdt|fat|odp)\b/i.test(
          inside
        )
      ) {
        addAdditionalLocation(inside);
        return ', ';
      }
      return full;
    });

    // 4. Extract RT/RW pairs:
    //    a) Explicit "RT 002 / RW 005", "RT.02/RW.05", "RT 2 RW 5"
    //    b) Compact slash/dash without repeating RW: "RT 02/05", "RT.002/005", "RT 02-05"
    working = working.replace(
      /\bRT\.?\s*(\d{1,3})\s*[/\-,\s]*\s*RW\.?\s*(\d{1,3})\b/gi,
      (_full, r1: string, r2: string) => {
        if (!rtVal || r1.length > rtVal.length) rtVal = r1;
        if (!rwVal || r2.length > rwVal.length) rwVal = r2;
        return ', ';
      }
    );
    working = working.replace(
      /\bRT\.?\s*(\d{1,3})\s*[/\-]\s*(\d{1,3})\b/gi,
      (_full, r1: string, r2: string) => {
        if (!rtVal || r1.length > rtVal.length) rtVal = r1;
        if (!rwVal || r2.length > rwVal.length) rwVal = r2;
        return ', ';
      }
    );
    working = working.replace(/\bRT\.?\s*(\d{1,3})\b/gi, (_full, r1: string) => {
      if (!rtVal || r1.length > rtVal.length) rtVal = r1;
      return ', ';
    });
    working = working.replace(/\bRW\.?\s*(\d{1,3})\b/gi, (_full, r2: string) => {
      if (!rwVal || r2.length > rwVal.length) rwVal = r2;
      return ', ';
    });

    // 5. Extract Kode Pos
    working = working.replace(
      /\b(?:kode\s*pos|zip\s*code)\s*[:\-]?\s*([1-9]\d{4})\b/gi,
      (_full, zip: string) => {
        if (!postalCode) postalCode = zip;
        return ', ';
      }
    );
    working = working.replace(/\b([1-9]\d{4})\b/g, (full, zip: string, offset: number, source: string) => {
      const prefix = source.slice(Math.max(0, offset - 14), offset);
      if (/(?:no|nomor|nomer|blok|block|kav|lt|lantai|rt|rw|fdt|fat)[.\s#:]*$/i.test(prefix)) {
        return full;
      }
      if (!postalCode) postalCode = zip;
      return ', ';
    });

    // 6. Extract explicit Province
    for (const prov of INDONESIAN_PROVINCES) {
      if (prov.pattern.test(working)) {
        if (!provinceLabel) provinceLabel = prov.canonical;
        working = working.replace(prov.pattern, ', ');
      }
    }

    // 7. Extract explicit Kelurahan / Desa
    working = working.replace(
      /\b(?:kel\.?|kelurahan|desa|ds\.?)\s+([^,;\n]+?)(?=(?:\s+\b(?:kec\.?|kecamatan|kota|kab\.?|kabupaten)\b|[,;\n]|$))/gi,
      (full, name: string) => {
        const prefix = /^\s*(?:desa|ds\.?)\b/i.test(full) ? 'Desa' : 'Kel.';
        const trimmedName = name.trim();
        if (isMeaningfulAddressValue(trimmedName) && !kelurahanLabel) {
          kelurahanLabel = `${prefix} ${smartCapitalizeSegment(trimmedName)}`;
        }
        return ', ';
      }
    );

    // 8. Extract explicit Kecamatan
    working = working.replace(
      /\b(?:kec\.?|kecamatan)\s+([^,;\n]+?)(?=(?:\s+\b(?:kota|kab\.?|kabupaten)\b|[,;\n]|$))/gi,
      (_full, name: string) => {
        const trimmedName = name.trim();
        if (isMeaningfulAddressValue(trimmedName) && !kecamatanLabel) {
          kecamatanLabel = `Kec. ${smartCapitalizeSegment(trimmedName)}`;
        }
        return ', ';
      }
    );

    const chunks = working
      .split(/[,;]+/)
      .map(c => c.replace(/[ \t]+/g, ' ').trim())
      .filter(c => isMeaningfulAddressValue(c));

    for (let i = 0; i < chunks.length; i++) {
      candidateChunks.push({
        text: chunks[i],
        hadTechLandmark: lineHadTechLandmark && chunks.length === 1
      });
    }
  }

  // Pass 2: Classify chunks cleanly (including unprefixed Kecamatan, City, Cluster, Landmark, and Street)
  const chunkRoles = candidateChunks.map(c => ({
    chunk: c.text,
    hadTechLandmark: c.hadTechLandmark,
    role: 'unknown' as 'skip' | 'city' | 'kecamatan' | 'kelurahan' | 'additional' | 'street' | 'unknown'
  }));

  for (let i = 0; i < chunkRoles.length; i++) {
    const item = chunkRoles[i];
    const chunk = item.chunk;
    const normChunk = normalizeComparisonKey(chunk);
    const adminNormChunk = stripAdminPrefixKey(chunk);
    if (!normChunk) {
      item.role = 'skip';
      continue;
    }

    if (postalCode && normChunk === postalCode) {
      item.role = 'skip';
      continue;
    }
    if (provinceLabel && stripAdminPrefixKey(provinceLabel) === adminNormChunk) {
      item.role = 'skip';
      continue;
    }
    const maybeProv = matchIndonesianProvince(chunk);
    if (maybeProv && stripAdminPrefixKey(chunk) === normalizeComparisonKey(maybeProv)) {
      if (!provinceLabel) provinceLabel = maybeProv;
      item.role = 'skip';
      continue;
    }
    if (kelurahanLabel && stripAdminPrefixKey(kelurahanLabel) === adminNormChunk) {
      item.role = 'skip';
      continue;
    }
    if (kecamatanLabel && stripAdminPrefixKey(kecamatanLabel) === adminNormChunk) {
      item.role = 'skip';
      continue;
    }

    if (isCityOrAreaString(chunk, cityLabel, areaLabel)) {
      item.role = 'city';
      if (/^(?:kota|kab)/i.test(chunk) || !cityLabel) {
        if (
          !cityLabel ||
          (/^(?:kota|kab)/i.test(chunk) &&
            stripAdminPrefixKey(cityLabel) === adminNormChunk &&
            !/^(?:kota|kab)/i.test(cityLabel))
        ) {
          cityLabel = smartCapitalizeSegment(chunk);
        }
      }
      continue;
    }

    if (KNOWN_INDONESIAN_KECAMATAN_RE.test(chunk)) {
      item.role = 'kecamatan';
      if (!kecamatanLabel) {
        kecamatanLabel = `Kec. ${smartCapitalizeSegment(chunk)}`;
      }
      continue;
    }

    const isClusterTextMatch =
      Boolean(clusterBareKey) &&
      (normChunk === normalizedClusterKey ||
        normChunk === clusterBareKey ||
        normChunk.replace(/^(?:cluster|perumahan|perum|komplek|komp|villa)\s+/i, '').trim() ===
          clusterBareKey);

    const isExplicitComplexOnly =
      (RESIDENTIAL_COMPLEX_PREFIX_RE.test(chunk) || RESIDENTIAL_COMPLEX_SUFFIX_RE.test(chunk)) &&
      !isStreetLikeChunk(chunk) &&
      !/\b(?:rt|rw|kel\.?|kec\.?)\b/i.test(chunk);

    if (
      (isClusterTextMatch && !/\b(?:blok|block|no\.?|nomor|nomer)\b/i.test(chunk)) ||
      isExplicitComplexOnly ||
      (item.hadTechLandmark && !isStreetLikeChunk(chunk))
    ) {
      item.role = 'additional';
      addAdditionalLocation(chunk);
      continue;
    }

    if (
      /^(?:dekat|depan|samping|sebelah|belakang|seberang)\s+/i.test(chunk) &&
      !isStreetLikeChunk(chunk)
    ) {
      item.role = 'additional';
      addAdditionalLocation(chunk);
      continue;
    }
  }

  // Pass 2B: Positional tail inference for unprefixed Kecamatan immediately preceding a City chunk
  // (e.g. "Jalan Anggrek, Blok A15, No. 5\nSome Kec, Tangerang Selatan" when kecamatan is not in static dictionary)
  for (let i = chunkRoles.length - 2; i >= 0; i--) {
    const curr = chunkRoles[i];
    const next = chunkRoles[i + 1];
    if (
      curr.role === 'unknown' &&
      (next.role === 'city' || next.role === 'kecamatan') &&
      isBareLocationPhrase(curr.chunk)
    ) {
      if (next.role === 'city' && !kecamatanLabel) {
        curr.role = 'kecamatan';
        kecamatanLabel = `Kec. ${smartCapitalizeSegment(curr.chunk)}`;
      } else if (next.role === 'kecamatan' && !kelurahanLabel && i > 0) {
        // Only infer unprefixed kelurahan if preceded by at least one street/block chunk
        const hasPriorStreet = chunkRoles.slice(0, i).some(p => p.role === 'unknown' || p.role === 'street');
        if (hasPriorStreet) {
          curr.role = 'kelurahan';
          kelurahanLabel = `Kel. ${smartCapitalizeSegment(curr.chunk)}`;
        }
      }
    }
  }

  for (const item of chunkRoles) {
    if (item.role === 'unknown' || item.role === 'street') {
      let streetText = item.chunk;
      // If chunk starts with clusterName immediately followed by street/blok/no (e.g. "Permata Hijau 2 Blok C No. 5"),
      // strip the duplicated leading clusterName since cluster is already separated into additionalLocations.
      if (structuredClusterRaw) {
        const escapedCluster = structuredClusterRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const prefixRegex = new RegExp(
          `^${escapedCluster}[,\\s\\-]+((?:jl\\.?|jalan|jln\\.?|gg\\.?|gang|blok|block|no\\.?|nomor|kav\\.?)\\b.+)$`,
          'i'
        );
        const strippedMatch = streetText.match(prefixRegex);
        if (strippedMatch && isMeaningfulAddressValue(strippedMatch[1])) {
          streetText = strippedMatch[1].trim();
        }
      }
      streetSegments.push(streetText);
    }
  }

  // Merge extra structured blok / house number from rawColumns only if not already in streetSegments
  const existingStreetKey = normalizeStreetCompareKey(streetSegments.join(' '));
  if (extraBlok) {
    const blokVal = /^blok\b/i.test(extraBlok) ? extraBlok : `Blok ${extraBlok}`;
    const blokKey = normalizeStreetCompareKey(blokVal);
    if (blokKey && !existingStreetKey.includes(blokKey)) {
      streetSegments.push(blokVal);
    }
  }
  if (extraHouseNo) {
    const noVal = /^no\.?\b/i.test(extraHouseNo) ? extraHouseNo : `No. ${extraHouseNo}`;
    const noKey = normalizeStreetCompareKey(noVal);
    if (noKey && !normalizeStreetCompareKey(streetSegments.join(' ')).includes(noKey)) {
      streetSegments.push(noVal);
    }
  }

  // Baris 1: Jalan, blok, nomor rumah
  const line1 = normalizeLine1CommaSegments(streetSegments);

  // Baris 2: RT/RW, kelurahan/desa
  const line2Parts: string[] = [];
  if (rtVal && rwVal) {
    line2Parts.push(formatRtRwPair(rtVal, rwVal).label);
  } else if (rtVal) {
    line2Parts.push(`RT ${rtVal.padStart(2, '0')}`);
  } else if (rwVal) {
    line2Parts.push(`RW ${rwVal.padStart(2, '0')}`);
  }
  if (kelurahanLabel) {
    line2Parts.push(kelurahanLabel);
  }
  const line2 = line2Parts.join(', ');

  // Baris 3: Kecamatan, kota/kabupaten (strictly deduplicated and excluding province/kelurahan)
  const line3Parts: string[] = [];
  const line3Seen = new Set<string>();
  const pushLine3 = (val: string) => {
    const clean = smartCapitalizeSegment(val);
    if (!isMeaningfulAddressValue(clean)) return;
    const key = stripAdminPrefixKey(clean);
    if (!key || line3Seen.has(key)) return;
    if (provinceLabel && stripAdminPrefixKey(provinceLabel) === key) return;
    if (kelurahanLabel && stripAdminPrefixKey(kelurahanLabel) === key) return;
    if (postalCode && key === postalCode) return;
    line3Seen.add(key);
    line3Parts.push(clean);
  };

  if (kecamatanLabel) pushLine3(kecamatanLabel);
  if (
    areaLabel &&
    (!kecamatanLabel || stripAdminPrefixKey(areaLabel) !== stripAdminPrefixKey(kecamatanLabel)) &&
    (!cityLabel || stripAdminPrefixKey(areaLabel) !== stripAdminPrefixKey(cityLabel))
  ) {
    pushLine3(areaLabel);
  }
  if (cityLabel) {
    pushLine3(cityLabel);
  } else if (areaLabel) {
    pushLine3(areaLabel);
  }
  const line3 = line3Parts.join(', ');

  // Baris 4: Provinsi dan kode pos (e.g. "Banten 15220")
  const line4Parts: string[] = [];
  if (provinceLabel) line4Parts.push(provinceLabel);
  if (postalCode) line4Parts.push(postalCode);
  const line4 = line4Parts.join(' ');

  const lines = [line1, line2, line3, line4].filter(Boolean);

  // Filter additionalLocations so nothing duplicates primary lines
  const primaryLineKeys = new Set(lines.map(l => normalizeStreetCompareKey(l)));
  const filteredAdditional = additionalLocations.filter(loc => {
    const locKey = normalizeStreetCompareKey(loc);
    if (!locKey) return false;
    if (primaryLineKeys.has(locKey)) return false;
    if (line1 && normalizeStreetCompareKey(line1) === locKey) return false;
    return true;
  });

  const formattedPrimaryText = lines.join('\n');
  const formattedSingleLine = lines.join(', ');

  const copyChunks = [...lines];
  if (filteredAdditional.length > 0) {
    copyChunks.push(`Lokasi Tambahan: ${filteredAdditional.join(' · ')}`);
  }
  const copyText = copyChunks.join('\n');

  const mapClusterTags = filteredAdditional.filter(loc => !/^(?:FDT|FAT|ODP)\b/i.test(loc));
  const mapsParts: string[] = [];
  const mapsSeen = new Set<string>();
  for (const part of [...lines, ...mapClusterTags]) {
    const k = normalizeStreetCompareKey(part);
    if (!k || mapsSeen.has(k)) continue;
    mapsSeen.add(k);
    mapsParts.push(part);
  }
  const mapsQueryText = mapsParts.join(', ');

  return {
    line1,
    line2,
    line3,
    line4,
    lines,
    additionalLocations: filteredAdditional,
    formattedPrimaryText,
    formattedSingleLine,
    copyText,
    mapsQueryText,
    hasAddress: lines.length > 0 || filteredAdditional.length > 0
  };
}

/**
 * Helper for search inputs in Installer portals so searching by any address field
 * (street, cluster, area, city, postalCode, landmark) keeps working consistently.
 */
export function buildTicketAddressSearchHaystack(ticket?: Partial<Ticket> | null): string {
  if (!ticket) return '';
  const formatted = formatWorkOrderAddress(ticket);
  return [
    ticket.streetName,
    ticket.address,
    ticket.streetAlternatif,
    ticket.clusterName,
    ticket.area,
    ticket.city,
    ticket.postalCode,
    formatted.formattedSingleLine,
    ...formatted.additionalLocations
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
