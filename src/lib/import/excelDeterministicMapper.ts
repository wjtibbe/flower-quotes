import type { SheetTable } from "./excelParser";
import { safeStringifyCell, type DetectedTableRegion } from "./excelTableAdapter";
import { resolveProductGroup } from "./productGroups";
import { normalizeDecimalString, parseLengthCm } from "./normalize";
import type { ParsedOfferLine } from "./types";

/**
 * Deterministic Excel header -> field mapping (per explicit supplier-import
 * spec: "Do not use AI reasoning for column mapping when the Excel headers
 * are known"). Every one of these is an EXACT, case-insensitive/trimmed
 * header text this codebase has actually seen (Nikita's sheet) - not a fuzzy
 * synonym dictionary like `excelParser.ts`'s HEADER_SYNONYMS. When a sheet's
 * header row matches enough of these, the numeric/structural fields below
 * are read directly from the cells and NEVER handed to the AI provider to
 * infer - only the free-text "Product description" column is sent to Claude,
 * and only for product/variety recognition (see `buildDescriptionListText`/
 * `mergeDeterministicRowsWithDescriptionLines` below).
 */
export type DeterministicField =
  | "quantity"
  | "stemsPerBox"
  | "stemsPerBunch"
  | "weightPerBoxKg"
  | "fobPricePerStem"
  | "boxType"
  | "lengthCm"
  | "sourceDescription";

const KNOWN_HEADER_FIELD_MAP: Record<string, DeterministicField> = {
  "packs left": "quantity",
  "pack quantity": "stemsPerBox",
  "fust code": "boxType",
  "product description": "sourceDescription",
  "stem length": "lengthCm",
  "stems per bunch": "stemsPerBunch",
  "box weight": "weightPerBoxKg",
  "fob price usd": "fobPricePerStem",
};

// Description + at least this many of the remaining 7 known numeric/
// structural headers must be recognized before deterministic mode activates
// - a sheet that only happens to share ONE header name with this dictionary
// (e.g. a totally different supplier sheet with a "Description" column)
// should still go through the general AI table pipeline, not a partial,
// unreliable deterministic mapping.
const MIN_OTHER_FIELDS_FOR_DETERMINISTIC_MODE = 4;

function normalizeHeaderCell(value: unknown): string {
  return safeStringifyCell(value).toLowerCase();
}

/** Maps each recognized header cell in `headerRow` to its column index. Unrecognized headers are simply absent from the result - never an error. */
export function detectDeterministicColumns(headerRow: unknown[]): Partial<Record<DeterministicField, number>> {
  const columns: Partial<Record<DeterministicField, number>> = {};
  headerRow.forEach((cell, index) => {
    const field = KNOWN_HEADER_FIELD_MAP[normalizeHeaderCell(cell)];
    if (field && columns[field] === undefined) columns[field] = index;
  });
  return columns;
}

/** Whether the recognized columns are enough to trust the deterministic path (description column plus a strong majority of the known numeric/structural headers). */
export function hasSufficientDeterministicCoverage(columns: Partial<Record<DeterministicField, number>>): boolean {
  if (columns.sourceDescription === undefined) return false;
  const otherFieldsFound = Object.keys(columns).filter((f) => f !== "sourceDescription").length;
  return otherFieldsFound >= MIN_OTHER_FIELDS_FOR_DETERMINISTIC_MODE;
}

export interface DeterministicRow {
  /** Stable 1-based index used to round-trip this row through the description-only AI call - never a database id. */
  rowIndex: number;
  rawText: string;
  sourceDescription: string;
  quantity?: number;
  stemsPerBox?: number;
  stemsPerBunch?: number;
  weightPerBoxKg?: string;
  fobPricePerStem?: string;
  boxType?: string;
  lengthCm?: number;
}

function toSafeInt(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : parseInt(safeStringifyCell(value).replace(/[^\d.-]/g, ""), 10);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function toSafeDecimalString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return normalizeDecimalString(safeStringifyCell(value)) ?? undefined;
}

/**
 * Extracts one `DeterministicRow` per non-blank data row in the detected
 * region, reading every recognized column directly - `quantity`,
 * `stemsPerBox`, `stemsPerBunch`, `weightPerBoxKg`, `fobPricePerStem`,
 * `boxType`, `lengthCm` are all sourced from the exact column the header
 * mapping says they belong to, never inferred. A row missing its
 * `sourceDescription` cell is skipped (nothing to send for product/variety
 * recognition, and no description means the row can't be reviewed either).
 */
export function extractDeterministicRows(
  table: SheetTable,
  region: DetectedTableRegion,
  columns: Partial<Record<DeterministicField, number>>,
): DeterministicRow[] {
  const rows: DeterministicRow[] = [];
  let rowIndex = 0;

  for (let r = region.headerRowIndex + 1; r <= region.lastDataRowIndex; r++) {
    const row = table[r];
    if (!row || row.every((cell) => cell === null || cell === undefined || cell === "")) continue;

    const cell = (field: DeterministicField): unknown =>
      columns[field] !== undefined ? row[columns[field]!] : undefined;

    const sourceDescription = safeStringifyCell(cell("sourceDescription"));
    if (!sourceDescription) continue;

    rowIndex++;
    const lengthRaw = cell("lengthCm");
    rows.push({
      rowIndex,
      rawText: row.map(safeStringifyCell).join(" | "),
      sourceDescription,
      quantity: toSafeInt(cell("quantity")),
      stemsPerBox: toSafeInt(cell("stemsPerBox")),
      stemsPerBunch: toSafeInt(cell("stemsPerBunch")),
      weightPerBoxKg: toSafeDecimalString(cell("weightPerBoxKg")),
      fobPricePerStem: toSafeDecimalString(cell("fobPricePerStem")),
      boxType: safeStringifyCell(cell("boxType")) || undefined,
      lengthCm: lengthRaw !== undefined ? (parseLengthCm(safeStringifyCell(lengthRaw)) ?? undefined) : undefined,
    });
  }

  return rows;
}

const ROW_TAG_RE = /^#(\d+)\s*\|/;

/** Builds the minimal, numeric-free text handed to the AI provider: a numbered list of ONLY the free-text product descriptions, so it is structurally impossible for the model to see (or guess at) the deterministic numeric columns. */
export function buildDescriptionListText(rows: DeterministicRow[]): string {
  return rows.map((r) => `#${r.rowIndex} | ${r.sourceDescription}`).join("\n");
}

/** Recovers the stable row index a description-only AI response line corresponds to, from its (verbatim-preserved) `#N | ...` rawText tag. Returns null when the tag can't be found (never guessed). */
export function parseRowIndexFromRawText(rawText: string | undefined): number | null {
  if (!rawText) return null;
  const match = ROW_TAG_RE.exec(rawText.trim());
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Merges the deterministically-extracted structural fields with the AI
 * provider's product/variety recognition, matched by the stable row-index
 * tag (never by array position, since the AI response's count/order isn't
 * guaranteed to exactly mirror the input). Every deterministic field always
 * wins - the AI's own boxType/stemsPerBox/price/etc. (present because the
 * shared `ImportParserProvider` schema always returns them, even though this
 * description-only call gives the model nothing to infer them from) are
 * never read here at all. A row the AI couldn't be matched back to still
 * gets a real line - `productGroupRaw` falls back to the whole raw
 * description (deterministic `resolveProductGroup`), flagged `needsReview`.
 */
export function mergeDeterministicRowsWithDescriptionLines(
  rows: DeterministicRow[],
  descriptionLines: ParsedOfferLine[],
): ParsedOfferLine[] {
  const byRowIndex = new Map<number, ParsedOfferLine>();
  for (const line of descriptionLines) {
    const idx = parseRowIndexFromRawText(line.rawText);
    if (idx !== null && !byRowIndex.has(idx)) byRowIndex.set(idx, line);
  }

  return rows.map((row) => {
    const aiLine = byRowIndex.get(row.rowIndex);
    const parserWarnings: string[] = [];
    let productGroupRaw: string | undefined;
    let varietyRaw: string | undefined;
    let colorRaw: string | undefined;
    let gradeRaw: string | undefined;
    let needsReview = false;

    if (aiLine) {
      productGroupRaw = aiLine.productGroupRaw;
      varietyRaw = aiLine.varietyRaw;
      colorRaw = aiLine.colorRaw;
      gradeRaw = aiLine.gradeRaw;
      // Deliberately NOT `aiLine.needsReview`: that flag comes from the
      // shared per-line schema, which the model sets whenever boxType/
      // stemsPerBox/price/currency looks null or uncertain to IT - fields
      // this description-only call never gives it any information about at
      // all, so it is always null from the model's point of view and the
      // flag would be true on every single line regardless of how confident
      // the product/variety recognition actually was. What's actually
      // relevant here is only whether product recognition itself succeeded;
      // the deterministic checks below (price/stemsPerBox) cover the rest.
      needsReview = !aiLine.productGroupRaw;
      parserWarnings.push(...aiLine.parserWarnings);
    } else {
      const { name, recognized } = resolveProductGroup(row.sourceDescription);
      productGroupRaw = name;
      needsReview = true;
      parserWarnings.push(
        `Product-/variëteitherkenning voor "${row.sourceDescription}" kon niet worden gekoppeld - volledige omschrijving gebruikt als productgroep.`,
      );
      void recognized;
    }

    if (row.stemsPerBunch !== undefined) {
      parserWarnings.push(`Stems per bunch: ${row.stemsPerBunch} (uit bronkolom "Stems per bunch", niet gelijk aan stemsPerBox).`);
    }
    if (!row.fobPricePerStem) {
      parserWarnings.push("FOB-prijs kolom leeg of niet interpreteerbaar");
      needsReview = true;
    }
    if (!row.stemsPerBox) needsReview = true;

    return {
      rawText: row.rawText,
      productGroupRaw,
      varietyRaw,
      colorRaw,
      gradeRaw,
      treatmentRaw: "normal",
      lengthCm: row.lengthCm,
      boxType: row.boxType,
      boxesAvailable: row.quantity,
      stemsPerBox: row.stemsPerBox,
      stemsPerBunch: row.stemsPerBunch,
      quantity: row.quantity !== undefined ? String(row.quantity) : undefined,
      unit: row.quantity !== undefined ? "BOXES" : undefined,
      fobPricePerStem: row.fobPricePerStem,
      currency: "USD",
      weightPerBoxKg: row.weightPerBoxKg,
      confidence: aiLine ? aiLine.confidence : "medium",
      fieldConfidence: {
        stemsPerBox: "high",
        fobPricePerStem: row.fobPricePerStem ? "high" : undefined,
        lengthCm: row.lengthCm !== undefined ? "high" : undefined,
        ...(aiLine?.fieldConfidence ?? {}),
      },
      needsReview,
      parserWarnings,
    };
  });
}
