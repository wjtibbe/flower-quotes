import ExcelJS from "exceljs";
import type { SheetTable } from "../excelParser";

/** Reads every worksheet of an .xlsx/.xls/.csv file into plain row/column arrays. */
export async function extractExcelTables(buffer: Buffer): Promise<{ sheetName: string; table: SheetTable }[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  return workbook.worksheets.map((sheet) => {
    const table: SheetTable = [];
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const values = row.values as unknown[];
      // ExcelJS row.values is 1-indexed with a leading empty slot - drop it.
      table.push(values.slice(1).map(cellToPrimitive));
    });
    return { sheetName: sheet.name, table };
  });
}

/**
 * ExcelJS returns plain values for simple cells, but formula cells, rich text
 * and hyperlinks come back as objects (e.g. `{ formula, result }`). Normalize
 * everything to a plain primitive so downstream parsing/display never sees
 * "[object Object]". Exported so `csv.ts` can apply the exact same
 * normalization to rows read via ExcelJS's CSV reader.
 */
export function cellToPrimitive(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== "object") return value;

  const obj = value as Record<string, unknown>;
  if ("result" in obj) return cellToPrimitive(obj.result); // formula cell
  if ("richText" in obj && Array.isArray(obj.richText)) {
    return (obj.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
  }
  if ("text" in obj) return obj.text; // hyperlink cell
  if ("error" in obj) return null;
  if ("formula" in obj) {
    // The "master" cell of a shared formula range has no cached result in
    // ExcelJS - there is no cheap way to recompute it here. Leave it blank
    // rather than showing a misleading value.
    return null;
  }

  return null;
}
