import { normalizeForMatching } from "../normalize";

/**
 * Deterministic assortment matching for a `FarmOfferLine` against a
 * supplier's existing assortment (`PackagingWeightProfile` rows). This
 * module is pure and database-independent - it never queries Prisma itself;
 * see `assortmentRepository.ts` for the one query that loads
 * `AssortmentCandidate[]`, and `matchFarmOfferLine.ts` for the thin
 * orchestration layer that wires the two together.
 *
 * The primary match combination is supplier + product + variety + length -
 * NEVER packaging (boxType/stemsPerBox/weight). Packaging only becomes
 * relevant to distinguish candidates when the primary combination alone
 * already narrows things down to more than one PackagingWeightProfile - and
 * even then, this engine deliberately does NOT pick among them automatically
 * (see the AMBIGUOUS branches below) - packaging is returned purely as
 * display metadata for a future review UI to let a human choose.
 *
 * No fuzzy/similarity matching is used anywhere in this module (by design -
 * see the module's originating spec, "Geen fuzzy auto-match"): every
 * comparison is either an exact match after normalization, or no match at
 * all - "Dallas" vs "Dalas" is UNMATCHED, not a low-confidence auto-link.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One `PackagingWeightProfile` row, pre-joined with its `ProductVariant` and
 * `Product`, in the flat shape the pure matcher needs. Built by
 * `assortmentRepository.ts` from a single Prisma query - never constructed
 * from more than one query per farm.
 */
export interface AssortmentCandidate {
  packagingWeightProfileId: string;
  farmId: string;
  productVariantId: string;
  productId: string;
  productName: string;
  /** Raw, as-stored `ProductVariant.variety` - normalized only at comparison time, never mutated here. */
  variety: string | null;
  /** Raw, as-stored `ProductVariant.stemLength` free text (e.g. "60 cm", "50-70 cm") - see `parseExactStemLengthCm`. */
  stemLength: string | null;
  boxType: string;
  stemsPerBox: number;
  /** Decimal string, e.g. "8.000". */
  boxWeight: string;
}

/** What a `FarmOfferLine` (or a not-yet-persisted `ParsedOfferLine`) contributes to a match attempt. */
export interface AssortmentMatchInput {
  /** The offer's supplier - candidates belonging to any other farm are never considered, even if mistakenly included in the candidate list passed in (defense in depth on top of `loadFarmAssortmentCandidates` already scoping by farm). */
  farmId: string;
  /** Resolved via `resolveImportedProductName()` - null when the source line has no usable product text at all. */
  productName: string | null;
  variety: string | null;
  /** Whole centimeters - `FarmOfferLine.stemLengthCm`/`ParsedOfferLine.lengthCm` is authoritative when present; null means "not stated", never a guessed/derived value. */
  stemLengthCm: number | null;
}

/** One candidate assortment article, shaped for direct UI display (a future review screen) - deliberately includes packaging fields even though they never drive the automatic decision. */
export interface AssortmentMatchOption {
  packagingWeightProfileId: string;
  productVariantId: string;
  productId: string;
  productName: string;
  variety: string | null;
  stemLength: string | null;
  boxType: string;
  stemsPerBox: number;
  boxWeight: string;
}

/**
 * `status` reuses the existing `LineMatchStatus` enum values as plain
 * strings (this module stays Prisma-independent, matching the rest of the
 * import layer's convention - see `OfferUnitLike` in `types.ts`). This
 * engine only ever produces UNMATCHED, AUTO_MATCHED, AMBIGUOUS or DERIVED -
 * never USER_LINKED (that status is reserved for an explicit future human
 * choice, not for anything this automatic engine decides).
 */
export type AssortmentMatchStatus = "UNMATCHED" | "AUTO_MATCHED" | "AMBIGUOUS" | "DERIVED";

export interface AssortmentMatchResult {
  status: AssortmentMatchStatus;
  /** Set only for AUTO_MATCHED and DERIVED (a single, safe-to-link profile). */
  packagingWeightProfileId: string | null;
  /** Set for AUTO_MATCHED/DERIVED, and also for AMBIGUOUS when every option shares the exact same ProductVariant (see section 16: packaging-only ambiguity). Never set from a fuzzy/global guess. */
  productVariantId: string | null;
  /** Only present for DERIVED (or an AMBIGUOUS case where the product itself was deterministically narrowed to one) - names which product the variety implied. Informational only; never written into `extractedSnapshot`. */
  derivedProductName?: string;
  /**
   * Every plausible candidate this match considered, UI-ready and
   * deterministically sorted (product -> variety -> length -> boxType ->
   * stemsPerBox) so a review UI/tests get a stable order. Populated for
   * AUTO_MATCHED/DERIVED too (so a caller can show "this is what matched"),
   * not just AMBIGUOUS.
   */
  options: AssortmentMatchOption[];
}

// ---------------------------------------------------------------------------
// Section 3: which raw field is "the" imported product name
// ---------------------------------------------------------------------------

/**
 * Resolves a single, consistent "imported product name" from a parsed/
 * persisted line (section 3). No current provider (rule-based, Excel or
 * Anthropic) ever populates `productNameRaw` yet - every one of them only
 * fills `productGroupRaw` (via `resolveProductGroup()`) - so in practice this
 * always falls through to `productGroupRaw` today. `productNameRaw` is
 * still checked first, and preferred, so a future, more specific source
 * doesn't need another change here. Never invents a name: returns null when
 * neither field has real text.
 */
export function resolveImportedProductName(line: {
  productNameRaw?: string | null;
  productGroupRaw?: string | null;
}): string | null {
  const nameRaw = line.productNameRaw?.trim();
  if (nameRaw) return nameRaw;
  const groupRaw = line.productGroupRaw?.trim();
  if (groupRaw) return groupRaw;
  return null;
}

// ---------------------------------------------------------------------------
// Section 2: length normalization
// ---------------------------------------------------------------------------

// Matches "50-70", "50 - 70", "50–70" (en dash), "50—70" (em dash) - any two
// numbers joined by a dash-like character, with or without surrounding
// spaces, anywhere in the string (e.g. before or after a "cm" suffix).
const LENGTH_RANGE_PATTERN = /\d+(?:[.,]\d+)?\s*[-–—]\s*\d+(?:[.,]\d+)?/;

/**
 * Parses a `ProductVariant.stemLength` free-text value (e.g. "60 cm",
 * "60CM", "60") into a single whole/decimal centimeter number for EXACT
 * matching - or null when there isn't a single unambiguous value. A range
 * like "50-70 cm" deliberately returns null rather than picking one end or
 * an average: for exact matching, a range is not the same as any single
 * length within it (section 2: "Een range levert voor exacte matching geen
 * enkel getal op"). This is intentionally separate from the existing
 * `parseLengthCm` in `normalize.ts` (used to interpret a length freshly read
 * off an AI/rule-based parser's output, which is never itself a range) -
 * that function's behavior for other callers is left untouched.
 */
export function parseExactStemLengthCm(input: string | null | undefined): number | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (LENGTH_RANGE_PATTERN.test(trimmed)) return null;

  const match = trimmed.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Review-screen rebuild, section 14: which fields invalidate a match
// ---------------------------------------------------------------------------

/** The three fields the primary match combination is built from - see the module doc. */
export interface MatchAffectingFields {
  productName: string | null;
  variety: string | null;
  stemLengthCm: number | null;
}

/**
 * Whether a correction changed one of the fields the automatic matcher
 * actually keys on: product, variety, or stemLengthCm (section 14 -
 * "Bepaal expliciet welke velden 'match-affecting' zijn. Minimaal: product;
 * variety; stemLengthCm."). Deliberately does NOT consider packaging fields
 * (boxType/stemsPerBox/weight), price, currency, quantity/unit or notes -
 * none of those drive the primary match, so changing only them must never
 * invalidate an existing link (including a `USER_LINKED` one the user chose
 * on purpose). Product/variety comparison reuses the same normalization the
 * matcher itself uses, so a change that's only a casing/whitespace/accent
 * difference is correctly treated as "unchanged".
 */
export function haveMatchAffectingFieldsChanged(before: MatchAffectingFields, after: MatchAffectingFields): boolean {
  const normalize = (value: string | null) => (value ? normalizeForMatching(value) : null);
  if (normalize(before.productName) !== normalize(after.productName)) return true;
  if (normalize(before.variety) !== normalize(after.variety)) return true;
  if ((before.stemLengthCm ?? null) !== (after.stemLengthCm ?? null)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toOption(candidate: AssortmentCandidate): AssortmentMatchOption {
  return {
    packagingWeightProfileId: candidate.packagingWeightProfileId,
    productVariantId: candidate.productVariantId,
    productId: candidate.productId,
    productName: candidate.productName,
    variety: candidate.variety,
    stemLength: candidate.stemLength,
    boxType: candidate.boxType,
    stemsPerBox: candidate.stemsPerBox,
    boxWeight: candidate.boxWeight,
  };
}

/**
 * Deterministic display order (section 14): product -> variety -> length
 * (numeric, not lexicographic - "100 cm" must sort after "60 cm", not
 * before it) -> boxType -> stemsPerBox, so a review UI and tests always see
 * the same order regardless of how the candidates were originally loaded.
 */
function sortOptions(options: AssortmentMatchOption[]): AssortmentMatchOption[] {
  return [...options].sort((a, b) => {
    return (
      a.productName.localeCompare(b.productName) ||
      (a.variety ?? "").localeCompare(b.variety ?? "") ||
      lengthSortValue(a.stemLength) - lengthSortValue(b.stemLength) ||
      a.boxType.localeCompare(b.boxType) ||
      a.stemsPerBox - b.stemsPerBox
    );
  });
}

function lengthSortValue(stemLength: string | null): number {
  const parsed = parseExactStemLengthCm(stemLength);
  return parsed ?? Number.POSITIVE_INFINITY;
}

/**
 * Section 16: when every option shares the exact same ProductVariant (they
 * only differ in packaging), the productVariantId itself is still safe to
 * set even though the specific packaging is ambiguous. Returns null as soon
 * as more than one distinct ProductVariant is present, or the list is empty.
 */
function sharedProductVariantId(options: AssortmentMatchOption[]): string | null {
  if (options.length === 0) return null;
  const distinct = new Set(options.map((o) => o.productVariantId));
  return distinct.size === 1 ? options[0].productVariantId : null;
}

// ---------------------------------------------------------------------------
// Section 4-6: the matcher itself
// ---------------------------------------------------------------------------

function emptyResult(status: AssortmentMatchStatus): AssortmentMatchResult {
  return { status, packagingWeightProfileId: null, productVariantId: null, options: [] };
}

/**
 * Matches one line against a farm's already-loaded assortment candidates.
 * Pure - takes no database connection, does no I/O, and never throws.
 *
 * See the module doc for the overall approach; in short:
 * - product AND variety known: exact match on product+variety, then
 *   narrowed by length when a length is given (section 4/6).
 * - variety known but product missing: try to deterministically derive the
 *   product from variety(+length) alone, only when that's unambiguous
 *   (section 5).
 * - variety missing entirely: UNMATCHED - variety is part of the required
 *   primary combination, so there is nothing safe to match on.
 */
export function matchAssortment(input: AssortmentMatchInput, candidates: AssortmentCandidate[]): AssortmentMatchResult {
  // Defense in depth: never consider another farm's assortment, even if the
  // caller's candidate list was accidentally built for the wrong farm.
  const farmCandidates = candidates.filter((c) => c.farmId === input.farmId);

  const normalizedVariety = input.variety ? normalizeForMatching(input.variety) : null;
  if (!normalizedVariety) {
    return emptyResult("UNMATCHED");
  }

  const normalizedProductName = input.productName ? normalizeForMatching(input.productName) : null;
  const stemLengthCm = input.stemLengthCm ?? null;

  if (normalizedProductName) {
    return matchWithKnownProduct(farmCandidates, normalizedProductName, normalizedVariety, stemLengthCm);
  }

  return deriveProductFromVariety(farmCandidates, normalizedVariety, stemLengthCm);
}

/** Section 4 (product known) and section 6 (length missing/mismatched). */
function matchWithKnownProduct(
  farmCandidates: AssortmentCandidate[],
  normalizedProductName: string,
  normalizedVariety: string,
  stemLengthCm: number | null,
): AssortmentMatchResult {
  const productVarietyMatches = farmCandidates.filter(
    (c) => normalizeForMatching(c.productName) === normalizedProductName && normalizeForMatching(c.variety ?? "") === normalizedVariety,
  );

  if (stemLengthCm === null) {
    // Section 6: length is part of the required primary combination - never
    // auto-match without it, but still surface whatever exists for this
    // product+variety (any length) as context for a future review UI.
    const options = sortOptions(productVarietyMatches.map(toOption));
    return {
      status: "UNMATCHED",
      packagingWeightProfileId: null,
      productVariantId: sharedProductVariantId(options),
      options,
    };
  }

  const exactMatches = productVarietyMatches.filter((c) => parseExactStemLengthCm(c.stemLength) === stemLengthCm);

  if (exactMatches.length === 0) {
    // No profile at exactly this length - not a match, but the other
    // lengths for this same product+variety are still useful context.
    const options = sortOptions(productVarietyMatches.map(toOption));
    return {
      status: "UNMATCHED",
      packagingWeightProfileId: null,
      productVariantId: null,
      options,
    };
  }

  const options = sortOptions(exactMatches.map(toOption));

  if (exactMatches.length === 1) {
    return {
      status: "AUTO_MATCHED",
      packagingWeightProfileId: options[0].packagingWeightProfileId,
      productVariantId: options[0].productVariantId,
      options,
    };
  }

  // More than one PackagingWeightProfile for the exact same product+variety
  //+length (section 1/7): packaging alone must never auto-pick a winner.
  return {
    status: "AMBIGUOUS",
    packagingWeightProfileId: null,
    productVariantId: sharedProductVariantId(options),
    options,
  };
}

/** Section 5: product missing, derive it from variety(+length) when unambiguous. */
function deriveProductFromVariety(
  farmCandidates: AssortmentCandidate[],
  normalizedVariety: string,
  stemLengthCm: number | null,
): AssortmentMatchResult {
  const varietyMatches = farmCandidates.filter((c) => {
    if (normalizeForMatching(c.variety ?? "") !== normalizedVariety) return false;
    if (stemLengthCm === null) return true; // length gelijk wanneer length aanwezig is
    return parseExactStemLengthCm(c.stemLength) === stemLengthCm;
  });

  if (varietyMatches.length === 0) {
    return emptyResult("UNMATCHED");
  }

  const distinctProductIds = new Set(varietyMatches.map((c) => c.productId));

  if (distinctProductIds.size > 1) {
    // C: more than one distinct product - no automatic product choice at all.
    return {
      status: "AMBIGUOUS",
      packagingWeightProfileId: null,
      productVariantId: null,
      options: sortOptions(varietyMatches.map(toOption)),
    };
  }

  // Exactly one distinct product - safe to deterministically derive it, then
  // continue matching within that product (already variety(+length)-filtered).
  const derivedProductName = varietyMatches[0].productName;
  const options = sortOptions(varietyMatches.map(toOption));

  if (varietyMatches.length === 1) {
    // A: exactly one PackagingWeightProfile within the derived product.
    return {
      status: "DERIVED",
      packagingWeightProfileId: options[0].packagingWeightProfileId,
      productVariantId: options[0].productVariantId,
      derivedProductName,
      options,
    };
  }

  // B: more than one PackagingWeightProfile within the one derived product.
  return {
    status: "AMBIGUOUS",
    packagingWeightProfileId: null,
    productVariantId: sharedProductVariantId(options),
    derivedProductName,
    options,
  };
}
