import {
  HeaderMapping,
  ImportTemplateType,
  TextToTableResult,
  Contractor,
  CoverageArea
} from '../types/index.ts';
import {
  processRawImportWithEngine,
  MASTER_CANONICAL_FIELDS,
  parseExcelWorkbook
} from './woFieldMappingEngine.ts';

export interface ParseOptions {
  customMappings?: HeaderMapping[];
  existingWoNumbers?: string[];
  contractors?: Contractor[];
  coverageAreas?: CoverageArea[];
}

export type DetectedSourceFormat = 'xlsx' | 'csv' | 'tsv' | 'markdown' | 'key_value' | 'json' | 'txt';

/**
 * Detect official MoraJaws Excel/Table template signature without mutating header order.
 * Reference templates:
 * - BASE_DATA_WO.xlsx (Sheet1, 46 headers)
 * - WO_KORLAP.xlsx (Sheet1, 40 headers)
 * - INSTALLER_WO.xlsx (Sheet1, 36 headers)
 * - ASSIGNED_TEKNISI.xlsx (Sheet1, 5 headers)
 */
export function detectTemplateSignature(detectedHeaders: string[]): ImportTemplateType {
  const count = detectedHeaders.length;
  const lowerSet = new Set(detectedHeaders.map(h => h.toLowerCase().trim()));
  const hasWo = lowerSet.has('wo number') || lowerSet.has('no wo') || lowerSet.has('wonumber');
  const hasInstaller = lowerSet.has('installer name') || lowerSet.has('teknisi') || lowerSet.has('nama teknisi');
  const hasLeader = lowerSet.has('corlap name') || lowerSet.has('leader name');

  if (count >= 44) return 'BASE_DATA_WO';
  if (count >= 38 && count <= 43) return 'WO_KORLAP';
  if (count >= 33 && count <= 37) return 'INSTALLER_WO';
  if (count >= 4 && count <= 8 && hasWo && hasInstaller) return 'ASSIGNED_TEKNISI';
  if (hasLeader && count >= 12 && count <= 16) return 'WO_KORLAP';
  return 'CUSTOM';
}

/**
 * Normalize JSON records (array of objects or wrapped payload) into raw string records
 * preserving every key/column and empty cell value cleanly.
 */
function parseJsonInputRecords(rawText: string): { rawRows: Record<string, string>[]; detectedHeaders: string[] } | null {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    let rows: any[] | null = null;
    if (Array.isArray(parsed)) {
      rows = parsed;
    } else if (parsed && typeof parsed === 'object') {
      const candidate = parsed.rows || parsed.data || parsed.workOrders || parsed.tickets || parsed.records;
      if (Array.isArray(candidate)) {
        rows = candidate;
      } else {
        rows = [parsed];
      }
    }
    if (!rows || rows.length === 0) return { rawRows: [], detectedHeaders: [] };

    const headerOrder: string[] = [];
    const headerSeen = new Set<string>();
    for (const r of rows) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) continue;
      for (const k of Object.keys(r)) {
        if (!headerSeen.has(k)) {
          headerSeen.add(k);
          headerOrder.push(k);
        }
      }
    }

    const rawRows: Record<string, string>[] = rows
      .filter(r => r && typeof r === 'object' && !Array.isArray(r))
      .map(r => {
        const rec: Record<string, string> = {};
        for (const h of headerOrder) {
          const val = r[h];
          rec[h] = val === undefined || val === null ? '' : (typeof val === 'object' ? JSON.stringify(val) : String(val).trim());
        }
        return rec;
      });

    return { rawRows, detectedHeaders: headerOrder };
  } catch {
    return null;
  }
}

/**
 * Auto-detect input format from content and/or file name.
 */
export function detectImportFormat(rawText: string, fileName?: string): DetectedSourceFormat {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  const trimmed = (rawText || '').trim();
  if (lower.endsWith('.json') || ((trimmed.startsWith('[') || trimmed.startsWith('{')) && parseJsonInputRecords(trimmed) !== null)) {
    return 'json';
  }
  const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return lower.endsWith('.csv') ? 'csv' : 'txt';
  if (isKeyValueFormat(lines)) return 'key_value';
  if (lines[0].includes('|')) return 'markdown';
  if (lines[0].includes('\t')) return 'tsv';
  if (lower.endsWith('.csv') || lines[0].includes(',') || lines[0].includes(';')) return 'csv';
  return 'txt';
}

/**
 * Parse uploaded Excel or CSV file buffer
 */
export function parseWorkOrderFile(fileBuffer: ArrayBuffer, options: ParseOptions = {}): TextToTableResult {
  const rawRows = parseExcelWorkbook(fileBuffer);
  const existingWoNumbers = new Set(options.existingWoNumbers || []);

  const engineResult = processRawImportWithEngine(
    rawRows,
    existingWoNumbers,
    options.contractors || [],
    options.coverageAreas || [],
    MASTER_CANONICAL_FIELDS
  );

  return {
    totalDetected: engineResult.parsedRows.length,
    validCount: engineResult.validCount,
    problematicCount: engineResult.problematicCount,
    duplicateCount: engineResult.duplicateCount,
    readyToImportCount: engineResult.readyToImportCount,
    unrecognizedHeaders: engineResult.unrecognizedHeaders,
    detectedHeaders: engineResult.detectedHeaders,
    missingMandatoryHeaders: engineResult.missingMandatoryHeaders,
    headerCheckPassed: engineResult.headerCheckPassed,
    parsedRows: engineResult.parsedRows,
    detectedContractors: engineResult.detectedContractors,
    newCoverageAreas: engineResult.newCoverageAreas
  };
}

/**
 * Check if the text is structured as Key-Value pairs (e.g. "WO Number: WO123456")
 */
function isKeyValueFormat(lines: string[]): boolean {
  let colonCount = 0;
  const sampleLines = lines.slice(0, 8);
  for (const line of sampleLines) {
    if (line.includes(':') && !line.startsWith('|')) {
      const idx = line.indexOf(':');
      const keyPart = line.substring(0, idx).trim();
      // Key is typically short (1-4 words) and not JSON/URL
      if (keyPart.length > 0 && keyPart.length < 40 && !keyPart.includes('\t') && !keyPart.includes('"') && !keyPart.startsWith('{')) {
        colonCount++;
      }
    }
  }
  return colonCount >= 2;
}

/**
 * Parse Key-Value format text (e.g. copied from WebCC or ticketing portals):
 * Supports multiple records separated by blank lines, '---', '===', or repeated keys.
 */
function parseKeyValueText(rawText: string): Record<string, string>[] {
  const lines = rawText.split(/\r?\n/);
  const records: Record<string, string>[] = [];
  let currentRecord: Record<string, string> = {};

  const finishCurrentRecord = () => {
    if (Object.keys(currentRecord).length > 0) {
      records.push({ ...currentRecord });
      currentRecord = {};
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed === '---' || trimmed === '===' || trimmed.startsWith('***')) {
      finishCurrentRecord();
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.substring(0, colonIdx).trim();
      const val = trimmed.substring(colonIdx + 1).trim();

      const lowerKey = key.toLowerCase();
      if ((lowerKey.includes('wo number') || lowerKey.includes('no wo') || lowerKey === 'wo') && currentRecord[key]) {
        finishCurrentRecord();
      }

      currentRecord[key] = val;
    }
  }
  finishCurrentRecord();
  return records;
}

/**
 * Deterministic text parser supporting JSON, Markdown tables, TSV, CSV, and Key: Value colon formats,
 * powered by the central WOFieldMappingEngine.
 * Preserves blank cells without shifting values across columns.
 */
export function parseWorkOrderText(rawText: string, options: ParseOptions = {}): TextToTableResult {
  const existingWoNumbers = new Set(options.existingWoNumbers || []);

  if (!rawText || !rawText.trim()) {
    return {
      totalDetected: 0,
      validCount: 0,
      problematicCount: 0,
      duplicateCount: 0,
      unrecognizedHeaders: [],
      detectedHeaders: [],
      parsedRows: []
    };
  }

  let rawRows: Record<string, string>[] = [];
  let detectedHeaders: string[] = [];

  // 0. Auto-detect JSON array / object payload
  const jsonParsed = parseJsonInputRecords(rawText);
  if (jsonParsed !== null) {
    rawRows = jsonParsed.rawRows;
    detectedHeaders = jsonParsed.detectedHeaders;
  } else {
    // Split lines, normalize line endings
    const lines = rawText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      return {
        totalDetected: 0,
        validCount: 0,
        problematicCount: 0,
        duplicateCount: 0,
        unrecognizedHeaders: [],
        detectedHeaders: [],
        parsedRows: []
      };
    }

    // 1. Auto-detect Key: Value format (WebCC)
    if (isKeyValueFormat(lines)) {
      rawRows = parseKeyValueText(rawText);
      const headerSet = new Set<string>();
      rawRows.forEach(r => Object.keys(r).forEach(k => headerSet.add(k)));
      detectedHeaders = Array.from(headerSet);
      // Normalize missing keys across records so blank cells remain explicit blanks
      rawRows = rawRows.map(r => {
        const normalized: Record<string, string> = {};
        detectedHeaders.forEach(h => {
          normalized[h] = r[h] ?? '';
        });
        return normalized;
      });
    } else {
      // 2. Tabular format (Markdown pipe, Tab, Semicolon, Comma)
      const firstLine = lines[0];
      const isMarkdownTable = firstLine.includes('|');
      const delimiter = isMarkdownTable ? '|' : (firstLine.includes('\t') ? '\t' : (firstLine.includes(';') ? ';' : ','));

      let rawHeaders: string[] = [];
      let dataLinesStartIndex = 1;

      if (isMarkdownTable) {
        rawHeaders = splitMarkdownRow(firstLine);
        if (lines.length > 1 && isMarkdownSeparator(lines[1])) {
          dataLinesStartIndex = 2;
        }
      } else {
        rawHeaders = splitDelimitedRow(firstLine, delimiter);
      }

      // Clean and trim headers, handling blank headers without shifting
      detectedHeaders = rawHeaders.map((h, i) => h.trim() || `Unnamed_Column_${i + 1}`);

      for (let i = dataLinesStartIndex; i < lines.length; i++) {
        const line = lines[i];
        if (isMarkdownTable && isMarkdownSeparator(line)) {
          continue;
        }

        const cellValues = isMarkdownTable
          ? splitMarkdownRow(line)
          : splitDelimitedRow(line, delimiter);

        // Ensure cell count matches header count without shifting
        const targetLength = detectedHeaders.length;
        while (cellValues.length < targetLength) {
          cellValues.push('');
        }

        const rowObj: Record<string, string> = {};
        detectedHeaders.forEach((header, colIndex) => {
          rowObj[header] = (cellValues[colIndex] ?? '').trim();
        });

        rawRows.push(rowObj);
      }
    }
  }

  // Delegate to central WOFieldMappingEngine
  const engineResult = processRawImportWithEngine(
    rawRows,
    existingWoNumbers,
    options.contractors || [],
    options.coverageAreas || [],
    MASTER_CANONICAL_FIELDS
  );

  return {
    totalDetected: engineResult.parsedRows.length,
    validCount: engineResult.validCount,
    problematicCount: engineResult.problematicCount,
    duplicateCount: engineResult.duplicateCount,
    readyToImportCount: engineResult.readyToImportCount,
    unrecognizedHeaders: engineResult.unrecognizedHeaders,
    detectedHeaders: engineResult.detectedHeaders.length > 0 ? engineResult.detectedHeaders : detectedHeaders,
    missingMandatoryHeaders: engineResult.missingMandatoryHeaders,
    headerCheckPassed: engineResult.headerCheckPassed,
    parsedRows: engineResult.parsedRows,
    detectedContractors: engineResult.detectedContractors,
    newCoverageAreas: engineResult.newCoverageAreas
  };
}

/**
 * Splits a Markdown table row by pipe '|', correctly preserving empty cells between pipes.
 */
function splitMarkdownRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) {
    trimmed = trimmed.substring(1);
  }
  if (trimmed.endsWith('|')) {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }
  return trimmed.split('|').map(cell => cell.trim());
}

/**
 * Checks if a string line is a markdown separator (e.g., |---|---|:---:|)
 */
function isMarkdownSeparator(line: string): boolean {
  const stripped = line.replace(/[|\s\-:]/g, '');
  return stripped.length === 0 && line.includes('-');
}

/**
 * Splits delimited text handling RFC-4180 quoted cells and escaped double quotes.
 */
function splitDelimitedRow(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
