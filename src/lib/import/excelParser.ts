import type { ParsedOfferLine } from "./types";
import { normalizeDecimalString } from "./normalize";
import { resolveProductGroup } from "./productGroups";

/** A generic in-memory table (rows of raw cell values), independent of the Excel library used. */
export type SheetTable = unknown[][];

const HEADER_SYNONYMS: Record<string, string[]> = {
  product: ["product", "productgroup", "product group", "flower"],
  color: ["color", "colour"],
  variety: ["variety", "varieties"],
  grade: ["grade", "quality", "grado"],
  boxesAvailable: ["availability (qb)", "availability", "qb", "available", "boxes"],
  stemsPerBox: ["stems x qb", "stems per box", "stems/box", "stemsxqb", "stems x box"],
  fobPrice: ["fob bta", "fob", "fob price", "fob usd", "fob per stem"],
};

/**
 * Tries to find a header row in the sheet and map its columns directly to
 * known fields, per section 24: "Voor Excel-bestanden moet eerst geprobeerd
 * worden kolommen rechtstreeks uit te lezen voordat AI wordt gebruikt."
 * Returns null if no usable header row is found (caller should fall back to
 * flattening rows to text and running them through the line parser).
 */
export function findHeaderRow(table: SheetTable, maxScanRows = 10): number | null {
  const limit = Math.min(maxScanRows, table.length);
  for (let i = 0; i < limit; i++) {
    const row = table[i].map((cell) => String(cell ?? "").trim().toLowerCase());
    const hasProduct = row.some((cell) => HEADER_SYNONYMS.product.includes(cell));
    const hasFob = row.some((cell) => HEADER_SYNONYMS.fobPrice.includes(cell));
    if (hasProduct && hasFob) return i;
  }
  return null;
}

function buildColumnIndex(headerRow: unknown[]): Partial<Record<keyof typeof HEADER_SYNONYMS, number>> {
  const normalized = headerRow.map((cell) => String(cell ?? "").trim().toLowerCase());
  const index: Partial<Record<keyof typeof HEADER_SYNONYMS, number>> = {};
  for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
    const colIndex = normalized.findIndex((cell) => synonyms.includes(cell));
    if (colIndex !== -1) index[field as keyof typeof HEADER_SYNONYMS] = colIndex;
  }
  return index;
}

/**
 * Column-based parser for structured Excel farm offers, e.g. the "Open
 * Market" sheet: Product | Color | Variety | Grade | ... | FOB BTA | ... |
 * STEMS X QB. Every recognized row gets high confidence for the columns that
 * were directly mapped.
 */
export function parseExcelTable(table: SheetTable): ParsedOfferLine[] {
  const headerRowIndex = findHeaderRow(table);
  if (headerRowIndex === null) return [];

  const columns = buildColumnIndex(table[headerRowIndex]);
  const lines: ParsedOfferLine[] = [];

  for (let r = headerRowIndex + 1; r < table.length; r++) {
    const row = table[r];
    if (!row || row.every((cell) => cell === null || cell === undefined || cell === "")) continue;

    const cell = (field: keyof typeof HEADER_SYNONYMS): unknown =>
      columns[field] !== undefined ? row[columns[field]!] : undefined;

    const productRaw = cell("product");
    const fobRaw = cell("fobPrice");
    if (productRaw === undefined || productRaw === null || String(productRaw).trim() === "") continue;

    const { name: productGroupRaw, recognized } = resolveProductGroup(String(productRaw));
    const fobNormalized =
      fobRaw !== undefined && fobRaw !== null ? normalizeDecimalString(String(fobRaw)) : null;

    const stemsPerBoxRaw = cell("stemsPerBox");
    const boxesAvailableRaw = cell("boxesAvailable");

    const fieldConfidence: ParsedOfferLine["fieldConfidence"] = {
      productGroupRaw: recognized ? "high" : "medium",
    };
    const parserWarnings: string[] = [];

    if (fobNormalized) {
      fieldConfidence.fobPricePerStem = "high";
    } else {
      parserWarnings.push("FOB-prijs kolom leeg of niet interpreteerbaar");
    }
    if (stemsPerBoxRaw !== undefined) fieldConfidence.stemsPerBox = "high";
    if (boxesAvailableRaw !== undefined) fieldConfidence.boxesAvailable = "high";

    const stemsPerBox = toInt(stemsPerBoxRaw);
    const needsReview = !fobNormalized || !stemsPerBox || !recognized;

    lines.push({
      rawText: row.map((c) => String(c ?? "")).join(" | "),
      productGroupRaw,
      colorRaw: strOrUndefined(cell("color")),
      varietyRaw: strOrUndefined(cell("variety")),
      gradeRaw: strOrUndefined(cell("grade")),
      treatmentRaw: "normal",
      boxType: "QB",
      boxesAvailable: toInt(boxesAvailableRaw),
      stemsPerBox,
      fobPricePerStem: fobNormalized ?? undefined,
      currency: "USD",
      confidence: !fobNormalized || !stemsPerBox ? "low" : recognized ? "high" : "medium",
      fieldConfidence,
      needsReview,
      parserWarnings,
    });
  }

  return lines;
}

function toInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : parseInt(String(value).replace(/[^\d.-]/g, ""), 10);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function strOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}
