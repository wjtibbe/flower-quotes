import type { FieldConfidence, OfferUnitLike, ParsedOfferLine } from "./types";
import { normalizeRoseProductLabel } from "./matching/assortmentMatch";
import { normalizeBoxTypeForImport } from "./offerLineFilters";

/**
 * Plain JSON-serializable value - deliberately not `Prisma.InputJsonValue`
 * (which would require importing `@prisma/client` into this otherwise
 * database-independent module) since every value here already comes from
 * `ParsedOfferLine`, whose own fields are all plain strings/numbers/booleans
 * (never a Prisma `Decimal` instance) - see the module doc below.
 */
export type JsonSerializable = string | number | boolean | null | JsonSerializable[] | { [key: string]: JsonSerializable };

// ---------------------------------------------------------------------------
// Section 4: totalStems
// ---------------------------------------------------------------------------

export interface CalculateTotalStemsInput {
  quantity: number | null;
  unit: OfferUnitLike | null;
  /** Only meaningful for unit BOXES. */
  stemsPerBox?: number | null;
  /** Only meaningful for unit BUNCHES - there is no schema column for this yet, so it is currently always absent/undefined from a real import; kept as a parameter so the calculation itself is fully testable and ready for when a provider does supply it. */
  stemsPerBunch?: number | null;
}

/**
 * Computes the total individual stem count a line represents, but ONLY when
 * that is actually derivable without guessing (section 4: "Nooit gokken."):
 * - STEMS: the quantity already IS a stem count.
 * - BOXES: quantity x stemsPerBox, but only for a WHOLE number of boxes - a
 *   fractional box count (e.g. 2.5 boxes) has no reliable stem total, since a
 *   "half box" isn't guaranteed to contain exactly half the stems.
 * - BUNCHES: quantity x stemsPerBunch, only when stemsPerBunch is known.
 * - KILOGRAMS: never derivable from a weight alone -> always null.
 * Returns null whenever quantity, unit, or the relevant per-unit count is
 * missing - never a fallback/estimated value.
 */
export function calculateTotalStems(input: CalculateTotalStemsInput): number | null {
  const { quantity, unit } = input;
  if (quantity === null || quantity === undefined || !Number.isFinite(quantity)) return null;
  if (!unit) return null;

  switch (unit) {
    case "STEMS":
      return Math.round(quantity);
    case "BOXES": {
      const stemsPerBox = input.stemsPerBox;
      if (!stemsPerBox || stemsPerBox <= 0) return null;
      if (!Number.isInteger(quantity)) return null;
      return Math.round(quantity * stemsPerBox);
    }
    case "BUNCHES": {
      const stemsPerBunch = input.stemsPerBunch;
      if (!stemsPerBunch || stemsPerBunch <= 0) return null;
      return Math.round(quantity * stemsPerBunch);
    }
    case "KILOGRAMS":
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Section 3: quantity/unit <-> legacy boxesAvailable compatibility
// ---------------------------------------------------------------------------

/**
 * Backward-compatibility mapping (section 3): when a line's unit is BOXES
 * and its quantity is a whole number, the legacy `boxesAvailable` field may
 * also be filled with that same number, so existing screens/code that still
 * read `boxesAvailable` keep working. Deliberately the ONLY place this
 * mapping happens, so it can't drift out of sync between call sites. Returns
 * null for any other unit, or a non-integer quantity - `boxesAvailable` is
 * never invented for stems/bunches/kilograms.
 */
export function mapQuantityToBoxesAvailable(quantity: number | null, unit: OfferUnitLike | null): number | null {
  if (unit !== "BOXES" || quantity === null || quantity === undefined) return null;
  if (!Number.isInteger(quantity)) return null;
  return quantity;
}

// ---------------------------------------------------------------------------
// Section 7/8: audit snapshot + validation message helpers
// ---------------------------------------------------------------------------

/**
 * Builds an immutable snapshot of the original structured parser output at
 * import time (section 7). Every value is copied out of `line` by value (or,
 * for the `parserWarnings` array, by a fresh copy) so a later mutation of the
 * `ParsedOfferLine` this snapshot was built from can never retroactively
 * change the snapshot - the whole point is to preserve the AI's original
 * extraction even after a human later corrects the row it produced.
 */
export function buildExtractedSnapshot(line: ParsedOfferLine): JsonSerializable {
  return {
    rawText: line.rawText,
    productGroupRaw: line.productGroupRaw ?? null,
    productNameRaw: line.productNameRaw ?? null,
    varietyRaw: line.varietyRaw ?? null,
    lengthCm: line.lengthCm ?? null,
    quantity: line.quantity ?? null,
    unit: line.unit ?? null,
    stemsPerBox: line.stemsPerBox ?? null,
    boxType: line.boxType ?? null,
    boxWeight: line.weightPerBoxKg ?? null,
    price: line.fobPricePerStem ?? null,
    currency: line.currency ?? null,
    parserWarnings: [...line.parserWarnings],
    confidence: line.confidence ?? null,
  };
}

/**
 * Normalizes a list of parser/validation messages to either a non-empty
 * string[] or null (never an empty array) - matching this codebase's
 * existing convention of using null rather than an empty collection to mean
 * "nothing here" (e.g. `ParsedOfferLine.fatalError` being `undefined` rather
 * than an empty string).
 */
export function normalizeValidationMessages(messages: readonly string[] | null | undefined): string[] | null {
  if (!messages || messages.length === 0) return null;
  const cleaned = messages.map((m) => m.trim()).filter((m) => m.length > 0);
  return cleaned.length > 0 ? cleaned : null;
}

/** Safely reads a `Json` column value back as a string[] - never throws on an unexpected shape (null, a stray object, ...), just returns an empty array. */
export function readValidationMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * There is only one `validationWarnings` column, but two genuinely different
 * kinds of warning feed into it (review-screen rebuild, section 18):
 *  A. the original parser's own warnings from import time - preserved in
 *     `extractedSnapshot.parserWarnings` and NEVER lost, even after a human
 *     edits the row (`extractedSnapshot` itself stays untouched).
 *  B. the CURRENT validation warnings (`validateOfferLineForFinalization`'s
 *     `warnings`), recomputed fresh every time the row is saved/rematched.
 * This merges the two deterministically - parser warnings first (in their
 * original order), then current warnings, exact-string deduplicated - so a
 * warning that was already true at import time and is still true today only
 * appears once, but nothing from either source is silently dropped.
 */
export function mergeValidationWarnings(
  parserWarnings: readonly string[] | null | undefined,
  currentWarnings: readonly string[] | null | undefined,
): string[] | null {
  const combined = [...(parserWarnings ?? []), ...(currentWarnings ?? [])];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const message of combined) {
    const trimmed = message.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    deduped.push(trimmed);
  }
  return deduped.length > 0 ? deduped : null;
}

// ---------------------------------------------------------------------------
// Section 10: ParsedOfferLine -> Prisma create-input mapping
// ---------------------------------------------------------------------------

/** The subset of `FarmOfferLine`'s create-input this helper is responsible for - everything a fresh import needs to persist, excluding `farmOfferId` (supplied by the caller's nested `create`) and the model's own defaulted id/timestamps. */
export interface OfferLineCreateInput {
  rawText: string;
  farmNameRaw?: string;
  countryOfOrigin?: string;
  productGroupRaw?: string;
  productNameRaw?: string;
  varietyRaw?: string;
  colorRaw?: string;
  gradeRaw?: string;
  treatmentRaw?: string;
  boxType?: string;
  boxesAvailable?: number;
  stemsPerBox?: number;
  stemLengthCm?: number;
  quantity?: string;
  unit?: OfferUnitLike;
  totalStems?: number;
  fobPricePerStem?: string;
  currency: "USD" | "EUR";
  priceUnit: "PER_STEM";
  weightPerBoxKg?: string;
  notes?: string;
  extraLeadTimeHrs?: number;
  matchStatus: "UNMATCHED";
  packagingWeightProfileId: null;
  /**
   * Not set by this mapping function - assortment matching is a separate
   * concern (see `src/lib/import/matching/`). Present here only so the
   * matching-integration layer (`uploadFarmOffer`) can overlay a match
   * result onto this same object shape before it reaches Prisma, without
   * needing a second, parallel create-input type.
   */
  productVariantId?: string;
  extractedSnapshot: JsonSerializable;
  validationWarnings: string[] | null;
  confidence: FieldConfidence;
  fieldConfidence: ParsedOfferLine["fieldConfidence"];
  needsReview: boolean;
}

/**
 * The single, central mapping from a parser's `ParsedOfferLine` to a
 * `FarmOfferLine` create-input (section 10) - the only place this mapping
 * happens, so it never has to be duplicated or kept in sync across the
 * server action and any future caller (e.g. a bulk-paste path).
 *
 * `rawText` is passed straight through, verbatim, and this function never
 * reads it back or rewrites it - a later correction to the created row (via
 * `updateOfferLine` or any future edit action) must never touch `rawText` or
 * `extractedSnapshot`; today that's simply enforced by neither field being
 * exposed by those actions at all.
 *
 * `line` is the (possibly deterministically ENRICHED - see
 * `farmOfferEnrichment.ts`) line whose fields become the CURRENT/persisted
 * columns. `originalForSnapshot` defaults to `line` itself (every existing
 * caller/test is unaffected), but a caller that enriched `line` after
 * matching (canonical packaging, currency default, quantity/unit backfill,
 * stale-warning cleanup) passes the PRE-enrichment line here instead, so
 * `extractedSnapshot` always keeps the original AI/supplier extraction -
 * HB included - independent of whatever the current, enriched columns say.
 */
export function mapParsedOfferLineToCreateInput(
  line: ParsedOfferLine,
  originalForSnapshot: ParsedOfferLine = line,
): OfferLineCreateInput {
  const quantityNumber = line.quantity !== undefined ? Number(line.quantity) : null;
  const unit = line.unit ?? null;

  const totalStems = calculateTotalStems({
    quantity: quantityNumber,
    unit,
    stemsPerBox: line.stemsPerBox ?? null,
  });

  // Backward compatibility (section 3): `boxesAvailable` already comes
  // straight from the parser for every existing provider today (none of them
  // populate quantity/unit yet) - only derive it from quantity/unit when the
  // parser didn't already give us a direct value, so an explicit
  // `boxesAvailable` is never silently overridden.
  const boxesAvailable = line.boxesAvailable ?? mapQuantityToBoxesAvailable(quantityNumber, unit) ?? undefined;

  const validationWarnings = normalizeValidationMessages(line.parserWarnings);

  return {
    rawText: line.rawText,
    farmNameRaw: line.farmNameRaw,
    countryOfOrigin: line.countryOfOrigin,
    // Deterministic rose-label normalization (global domain rule, never a
    // fuzzy match, never touching the variety) - only the CURRENT/editable
    // field is canonicalized; `extractedSnapshot` below is built from the
    // untouched `line` and always keeps the original AI/supplier wording.
    productGroupRaw: normalizeRoseProductLabel(line.productGroupRaw) ?? undefined,
    productNameRaw: normalizeRoseProductLabel(line.productNameRaw) ?? undefined,
    varietyRaw: line.varietyRaw,
    colorRaw: line.colorRaw,
    gradeRaw: line.gradeRaw,
    treatmentRaw: line.treatmentRaw,
    // Temporary global rule: "we only offer QB for now" - HB normalizes to
    // QB on the CURRENT/persisted field only; `extractedSnapshot` below is
    // built from the untouched `line` and always keeps the original "HB".
    boxType: normalizeBoxTypeForImport(line.boxType) ?? undefined,
    boxesAvailable,
    stemsPerBox: line.stemsPerBox,
    stemLengthCm: line.lengthCm,
    quantity: line.quantity,
    unit: line.unit,
    totalStems: totalStems ?? undefined,
    fobPricePerStem: line.fobPricePerStem,
    currency: line.currency ?? "USD",
    priceUnit: "PER_STEM",
    weightPerBoxKg: line.weightPerBoxKg,
    // Section 8: parserWarnings go to `validationWarnings` below, not here -
    // `notes` is reserved for genuine human-entered remarks (a field no
    // current provider populates), so a fresh import leaves it empty rather
    // than duplicating the warnings into a field meant for something else.
    notes: line.notes,
    extraLeadTimeHrs: line.extraLeadTimeHrs,
    matchStatus: "UNMATCHED",
    packagingWeightProfileId: null,
    extractedSnapshot: buildExtractedSnapshot(originalForSnapshot),
    validationWarnings,
    confidence: line.confidence,
    fieldConfidence: line.fieldConfidence,
    needsReview: line.needsReview,
  };
}
