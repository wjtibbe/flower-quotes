import type { SheetTable } from "./excelParser";
import { findHeaderRow } from "./excelParser";
import type { ExcelDefinedTable } from "./extract/excelTable";

/**
 * Detects which region of a raw Excel/CSV sheet is the actual offer table
 * (header row + data rows), so a title row (e.g. "Nikita"), blank rows above
 * the header, and anything below the table are never sent to the AI provider
 * as if they were product data. Preference order (per spec):
 *  1. An Excel-defined Table (ListObject, e.g. "OffersTable" A4:H153) - the
 *     most reliable signal, since the sheet author explicitly marked it.
 *  2. A generic scan of the first `maxScanRows` rows for a row that looks
 *     like a header (mostly text, followed by rows that look like data).
 *  3. The existing exact-match anchor/commercial header dictionary
 *     (`findHeaderRow`) as one more attempt, kept for its known-good
 *     recognition of common supplier sheets.
 * Returns null when no plausible header row can be found at all.
 */
export interface DetectedTableRegion {
  headerRowIndex: number;
  /** Inclusive last data row index (0-indexed into `table`). */
  lastDataRowIndex: number;
  source: "excel-table" | "scanned-header" | "synonym-header";
}

const MAX_HEADER_SCAN_ROWS = 15;

export function detectTableRegion(
  table: SheetTable,
  definedTables: ExcelDefinedTable[] = [],
): DetectedTableRegion | null {
  const fromDefinedTable = detectFromDefinedTables(table, definedTables);
  if (fromDefinedTable) return fromDefinedTable;

  const scanned = scanForHeaderRow(table);
  if (scanned !== null) {
    return { headerRowIndex: scanned, lastDataRowIndex: table.length - 1, source: "scanned-header" };
  }

  const synonymHeaderIndex = findHeaderRow(table, MAX_HEADER_SCAN_ROWS);
  if (synonymHeaderIndex !== null) {
    return { headerRowIndex: synonymHeaderIndex, lastDataRowIndex: table.length - 1, source: "synonym-header" };
  }

  return null;
}

function detectFromDefinedTables(table: SheetTable, definedTables: ExcelDefinedTable[]): DetectedTableRegion | null {
  for (const defined of definedTables) {
    const range = parseRangeRef(defined.ref);
    if (!range) continue;
    const headerRowIndex = range.startRow - 1; // Excel rows are 1-indexed
    const lastDataRowIndex = Math.min(range.endRow - 1, table.length - 1);
    if (headerRowIndex < 0 || headerRowIndex >= table.length || lastDataRowIndex < headerRowIndex) continue;
    return { headerRowIndex, lastDataRowIndex, source: "excel-table" };
  }
  return null;
}

/** Parses an Excel range ref like "A4:H153" into 1-indexed row/column bounds. Returns null for anything else (single-cell ref, malformed string). */
export function parseRangeRef(ref: string): { startRow: number; endRow: number } | null {
  const match = /^\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)$/i.exec(ref.trim());
  if (!match) return null;
  const startRow = parseInt(match[1], 10);
  const endRow = parseInt(match[2], 10);
  if (!Number.isFinite(startRow) || !Number.isFinite(endRow) || startRow < 1 || endRow < startRow) return null;
  return { startRow, endRow };
}

/**
 * Generic (dictionary-free) header-row heuristic: a row counts as a header
 * when it has at least two non-empty cells, most of them look like text
 * labels (not raw numbers/dates), and at least one of the next few rows
 * looks like actual data (contains a numeric-looking cell). This is
 * deliberately independent of any known field-name dictionary, so it works
 * for whatever column names a supplier happens to use.
 */
function scanForHeaderRow(table: SheetTable): number | null {
  const limit = Math.min(MAX_HEADER_SCAN_ROWS, table.length);
  for (let i = 0; i < limit; i++) {
    const row = table[i];
    if (!looksLikeHeaderRow(row)) continue;
    if (hasDataLikeRowWithin(table, i + 1, Math.min(i + 4, table.length))) {
      return i;
    }
  }
  return null;
}

function looksLikeHeaderRow(row: unknown[]): boolean {
  const nonEmpty = row.filter((cell) => !isBlankCell(cell));
  if (nonEmpty.length < 2) return false;
  const textLike = nonEmpty.filter((cell) => typeof cell === "string" && !looksNumeric(cell));
  return textLike.length / nonEmpty.length >= 0.6;
}

function hasDataLikeRowWithin(table: SheetTable, fromIndex: number, toIndexExclusive: number): boolean {
  for (let i = fromIndex; i < toIndexExclusive; i++) {
    const row = table[i];
    if (!row) continue;
    const nonEmpty = row.filter((cell) => !isBlankCell(cell));
    if (nonEmpty.length === 0) continue;
    const hasNumeric = nonEmpty.some((cell) => typeof cell === "number" || (typeof cell === "string" && looksNumeric(cell)));
    if (hasNumeric) return true;
  }
  return false;
}

function looksNumeric(value: string): boolean {
  return /^-?\d+([.,]\d+)?$/.test(value.trim());
}

function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/**
 * Cell safety (Task 4): converts any raw cell value - number, string, Date,
 * decimal, blank, or anything else ExcelJS handed back - into a safe display
 * string. Never calls a string-only method (trim/toLowerCase/...) directly
 * on a non-string cell.
 */
export function safeStringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return String(value);
  return String(value);
}

function isRowBlank(row: unknown[]): boolean {
  return row.every((cell) => isBlankCell(cell));
}

/**
 * Builds deterministic, pipe-delimited tabular text from a detected header +
 * data region - header row first, then every non-blank data row in original
 * order, one row per line. This is the clean, structured source handed to
 * the existing Anthropic import pipeline (Task 3): no title/blank rows, no
 * garbled whitespace-joined columns, headers preserved so the model can read
 * column meaning directly instead of guessing.
 */
export function buildTabularText(table: SheetTable, region: DetectedTableRegion): string {
  const headerRow = table[region.headerRowIndex] ?? [];
  const lines: string[] = [headerRow.map(safeStringifyCell).join(" | ")];

  for (let r = region.headerRowIndex + 1; r <= region.lastDataRowIndex; r++) {
    const row = table[r];
    if (!row || isRowBlank(row)) continue;
    lines.push(row.map(safeStringifyCell).join(" | "));
  }

  return lines.join("\n");
}
