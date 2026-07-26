import * as XLSX from 'xlsx';

export type SheetTable = {
  sheetName: string;
  headers: string[];
  rows: string[][];
  truncated: boolean;
};

const MAX_ROWS = 400;
const MAX_COLS = 20;

/**
 * Turn an uploaded spreadsheet/CSV into plain tables the model can read.
 * Keeps it text-only: no formulas, no styling, no external refs.
 */
export function parseSpreadsheet(buffer: Buffer, filename: string): SheetTable[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellFormula: false, cellHTML: false });
  const tables: SheetTable[] = [];

  for (const sheetName of workbook.SheetNames.slice(0, 5)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, raw: false, defval: '' });
    const cleaned = matrix
      .map((row) => (Array.isArray(row) ? row.slice(0, MAX_COLS).map(cellToText) : []))
      .filter((row) => row.some((cell) => cell.trim().length > 0));
    if (!cleaned.length) continue;

    const headerIndex = pickHeaderRow(cleaned);
    const headers = cleaned[headerIndex].map((cell, i) => cell.trim() || `列${i + 1}`);
    const body = cleaned.slice(headerIndex + 1);

    tables.push({
      sheetName: sheetName || filename,
      headers,
      rows: body.slice(0, MAX_ROWS),
      truncated: body.length > MAX_ROWS
    });
  }

  return tables;
}

export function tablesToText(tables: SheetTable[], maxChars = 24000): string {
  const blocks = tables.map((table) => {
    const lines = [
      `# 工作表：${table.sheetName}`,
      table.headers.join(' | '),
      ...table.rows.map((row) => row.join(' | '))
    ];
    if (table.truncated) lines.push(`（后续行已截断，共读取 ${table.rows.length} 行）`);
    return lines.join('\n');
  });
  return blocks.join('\n\n').slice(0, maxChars);
}

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Real exports often start with a title/metadata block, so the first
 * non-empty row is frequently not the header. Pick the widest early row.
 */
function pickHeaderRow(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 8); i += 1) {
    const filled = rows[i].filter((cell) => cell.trim().length > 0).length;
    const score = filled * 2 - i;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}
