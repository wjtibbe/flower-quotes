import type { ParsedOfferLine } from "./types";
import { normalizeDecimalString, parseLengthCm } from "./normalize";
import { resolveProductGroup } from "./productGroups";

/** A generic in-memory table (rows of raw cell values), independent of the Excel library used. */
export type SheetTable = unknown[][];

// Per-field synonyms used to map an already-detected header row's columns to
// actual ParsedOfferLine values (see `buildColumnIndex`/`parseExcelTable`).
// Extended with common English/Spanish variants a real supplier sheet might
// use, on top of the original "Open Market"-style column names.
const HEADER_SYNONYMS: Record<string, string[]> = {
  product: [
    "product",
    "productgroup",
    "product group",
    "flower",
    "item",
    "article",
    "artículo",
    "articulo",
    "producto",
    "description",
    "descripción",
    "descripcion",
  ],
  color: ["color", "colour"],
  variety: ["variety", "varieties", "varietal", "variedad", "cultivar"],
  grade: ["grade", "quality", "grado"],
  length: ["length", "stem length", "largo", "longitud"],
  boxesAvailable: ["availability (qb)", "availability", "qb", "available", "boxes", "qty", "quantity", "cantidad", "disponible"],
  stemsPerBox: ["stems x qb", "stems per box", "stems/box", "stemsxqb", "stems x box"],
  fobPrice: [
    "fob bta",
    "fob",
    "fob price",
    "fob usd",
    "fob per stem",
    "price",
    "unit price",
    "price per stem",
    "stem price",
    "precio",
    "precio tallo",
    "usd/stem",
  ],
};

// Header-row DETECTION is a separate, deliberately looser concern from the
// column-mapping above (section 6: "Maak dit minder fragiel ... Gebruik een
// score- of categorieaanpak in plaats van één te strenge exacte voorwaarde").
// A row counts as a header when it has at least one "anchor" column
// identifying what's being sold (product/variety/description) AND at least
// one "commercial" column with an actual sellable attribute (price, quantity,
// length or packaging) - requiring both avoids false positives on a plain
// title/metadata row that only names a product-ish word in passing.
const ANCHOR_HEADER_GROUPS: string[][] = [
  ["product", "productgroup", "product group", "flower", "item", "article", "artículo", "articulo", "producto"],
  ["variety", "varieties", "varietal", "variedad", "cultivar"],
  ["description", "descripción", "descripcion"],
];

const COMMERCIAL_HEADER_GROUPS: string[][] = [
  [
    "price",
    "fob",
    "fob bta",
    "fob price",
    "fob usd",
    "fob per stem",
    "unit price",
    "price per stem",
    "stem price",
    "precio",
    "precio tallo",
    "usd/stem",
  ],
  ["quantity", "qty", "available", "availability", "stems", "bunches", "boxes", "cantidad", "disponible"],
  ["length", "stem length", "largo", "longitud", "cm"],
  ["box", "box type", "packing", "pack", "qb", "hb", "fb", "stems per box", "weight", "kg"],
];

function rowMatchesAnyGroup(normalizedRow: string[], groups: string[][]): boolean {
  return groups.some((group) => normalizedRow.some((cell) => group.includes(cell)));
}

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
    const hasAnchor = rowMatchesAnyGroup(row, ANCHOR_HEADER_GROUPS);
    const hasCommercial = rowMatchesAnyGroup(row, COMMERCIAL_HEADER_GROUPS);
    if (hasAnchor && hasCommercial) return i;
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
    const lengthRaw = cell("length");
    const lengthCm =
      lengthRaw !== undefined && lengthRaw !== null && String(lengthRaw).trim() !== ""
        ? parseLengthCm(String(lengthRaw)) ?? undefined
        : undefined;

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
    if (lengthCm !== undefined) fieldConfidence.lengthCm = "high";

    const stemsPerBox = toInt(stemsPerBoxRaw);
    const needsReview = !fobNormalized || !stemsPerBox || !recognized;

    lines.push({
      rawText: row.map((c) => String(c ?? "")).join(" | "),
      productGroupRaw,
      colorRaw: strOrUndefined(cell("color")),
      varietyRaw: strOrUndefined(cell("variety")),
      gradeRaw: strOrUndefined(cell("grade")),
      treatmentRaw: "normal",
      lengthCm,
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
