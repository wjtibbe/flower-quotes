import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import type { SheetTable } from "../excelParser";
import { cellToPrimitive } from "./excelTable";

/**
 * Counts occurrences of `delimiter` in `line`, ignoring anything inside a
 * double-quoted field (so a comma inside a quoted product description never
 * counts towards comma-delimiter detection) and handling the `""` escaped-
 * quote convention. Pure and side-effect-free.
 */
function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++; // escaped quote ("") - stay inside the quoted field
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && ch === delimiter) count++;
  }
  return count;
}

/**
 * Detects whether a CSV uses a comma or a semicolon as its field delimiter,
 * by counting each candidate delimiter (outside quoted fields) on the first
 * non-empty line only - real header lines never contain a decimal number, so
 * this avoids the classic ambiguity between "," as a delimiter and "," as a
 * decimal separator (which only ever shows up in data rows, not headers).
 * Defaults to comma, the far more common delimiter, whenever semicolons
 * aren't clearly more frequent. Deliberately NOT a naive `split(',')` -
 * that would miscount commas inside quoted values.
 */
export function detectCsvDelimiter(text: string): "," | ";" {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = withoutBom.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const commaCount = countDelimiterOutsideQuotes(firstLine, ",");
  const semicolonCount = countDelimiterOutsideQuotes(firstLine, ";");
  return semicolonCount > commaCount ? ";" : ",";
}

/**
 * Reads a CSV buffer into the same `{ sheetName, table }[]` shape as
 * `extractExcelTables`, using ExcelJS's own CSV reader (`workbook.csv.read`,
 * backed by `fast-csv` - see node_modules/exceljs/lib/csv/csv.js) instead of
 * the XLSX/OOXML reader, which cannot parse CSV at all. Handles UTF-8
 * (including a leading BOM, stripped by fast-csv's parser - see
 * `Parser.removeBOM` in @fast-csv/parse) and quoted values containing the
 * delimiter. The delimiter itself is detected once per file via
 * `detectCsvDelimiter`, then applied consistently to every row.
 */
export async function extractCsvTables(buffer: Buffer): Promise<{ sheetName: string; table: SheetTable }[]> {
  const delimiter = detectCsvDelimiter(buffer.toString("utf-8"));

  const workbook = new ExcelJS.Workbook();
  const stream = Readable.from(buffer);
  const worksheet = await workbook.csv.read(stream, { parserOptions: { delimiter } });

  const table: SheetTable = [];
  worksheet.eachRow({ includeEmpty: true }, (row) => {
    const values = row.values as unknown[];
    table.push(values.slice(1).map(cellToPrimitive));
  });

  return [{ sheetName: "CSV", table }];
}
