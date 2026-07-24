import { calculateTotalStems } from "./offerLineMapping";
import { parseLengthSpec } from "./rangeExpansion";
import type { OfferUnitLike, ParsedOfferLine } from "./types";

/**
 * Deterministic, database-driven enrichment of a freshly matched
 * `ParsedOfferLine`, applied AFTER assortment matching and BEFORE
 * persistence (see `uploadFarmOffer` in farm-offers/actions.ts). Human
 * review should only be required when the application genuinely does not
 * know something (see the module's originating spec) - so once a value is
 * deterministically derivable from trusted application data (the matched
 * `PackagingWeightProfile`, the supplier's own configured default currency,
 * or the line's own already-extracted fields), it is filled in automatically
 * here instead of being left for a reviewer to re-type something the app
 * already knows.
 *
 * Nothing here ever calls Anthropic/AI - every step is pure, deterministic
 * application/database logic. Nothing here ever touches `rawText` or
 * `extractedSnapshot`: those stay built from the ORIGINAL, un-enriched line
 * (see the `originalForSnapshot` parameter of `mapParsedOfferLineToCreateInput`
 * in offerLineMapping.ts) so the audit trail always shows exactly what the
 * supplier wrote and what the AI originally extracted, HB included.
 *
 * Field precedence implemented here:
 *  - Packaging AND product identity (boxType/stemsPerBox/weightPerBoxKg,
 *    productGroupRaw/varietyRaw/lengthCm): once a line has matched a SINGLE
 *    concrete `PackagingWeightProfile` (AUTO_MATCHED, DERIVED, or
 *    USER_LINKED via a saved SupplierLineMapping - never AMBIGUOUS/
 *    UNMATCHED, which have no single profile to trust), that profile's (and
 *    its ProductVariant/Product's) canonical values ALWAYS win - overriding
 *    whatever (if anything) the supplier text/AI extraction stated. This
 *    matters just as much for identity as for packaging: a supplier's raw
 *    source line can omit the product group entirely on a re-import (e.g.
 *    "1hb boulevard 40cm" - no "Rosa" anywhere), and the AI extraction is
 *    re-run fresh each time, so it must never be trusted over the app's own
 *    confirmed assortment record for exactly this farm + product + variety +
 *    length + box type. Unmatched lines are left untouched (nothing trusted
 *    to enrich from).
 *  - Currency: an explicit source currency ALWAYS wins. Otherwise the
 *    supplier's own configured `Farm.defaultCurrency` (every farm has one,
 *    defaulting to USD) is trusted configuration and counts as RESOLVED
 *    (see `resolveEffectiveCurrency`) - this replaces the earlier
 *    country-based Colombia/Ecuador inference.
 *  - Quantity/unit: when the parser only ever populated the legacy
 *    `boxesAvailable` field (every current provider), quantity/unit are
 *    backfilled as `{quantity: boxesAvailable, unit: BOXES}` - the exact
 *    same assumption the review screen's own display fallback already made
 *    (see `OfferLineReviewRow.tsx`'s `effectiveQuantity`/`effectiveUnit`),
 *    now applied to the actual data so `totalStems` can be CALCULATED
 *    (`calculateTotalStems`, unchanged) instead of merely
 *    display-approximated.
 */

// ---------------------------------------------------------------------------
// Packaging enrichment
// ---------------------------------------------------------------------------

/**
 * The canonical fields a matched `PackagingWeightProfile` (and its
 * `ProductVariant`/`Product`) contributes: packaging AND product identity.
 * A supplier's raw source line may re-state the same article with a
 * different (or missing) product group each time it's re-imported - e.g.
 * "1hb boulevard 40cm" carries no product group at all, only a variety - so
 * once a single profile is confirmed, its OWN Product.name/variety are the
 * trusted identity, exactly like its packaging already was.
 */
export interface MatchedPackagingInfo {
  boxType: string;
  stemsPerBox: number;
  /** Decimal string, e.g. "7.000". */
  weightPerBoxKg: string;
  /** Canonical `Product.name`, e.g. "Rosa Ec" - never null, every Product has one. */
  productName: string;
  /** Canonical `ProductVariant.variety`, e.g. "Boulevard". */
  variety: string | null;
  /** Canonical `ProductVariant.stemLength`, free text (e.g. "40 cm") - parsed to `lengthCm` below only when it's an unambiguous single length. */
  stemLength: string | null;
}

export interface CanonicalPackagingFields {
  boxType: string;
  stemsPerBox: number;
  weightPerBoxKg: string;
  totalStems: number | null;
  /** Canonical product group - always present (see `MatchedPackagingInfo.productName`). */
  productGroupRaw: string;
  /** Canonical variety - null when the matched variant itself has none recorded; callers should keep the line's existing value in that case rather than blanking it. */
  varietyRaw: string | null;
  /** Canonical length in cm, parsed from the variant's own stemLength text - null when that text isn't a clean single length (missing, or a range); callers should keep the line's existing value in that case. */
  lengthCm: number | null;
}

/**
 * Computes the canonical fields (packaging AND product identity) a
 * CONFIRMED single `PackagingWeightProfile` match contributes to a line's
 * CURRENT/effective state, plus the resulting `totalStems` for the line's
 * current quantity/unit. This is the ONE shared computation used by every
 * path that confirms a profile match on a line - import-time enrichment
 * (`enrichParsedOfferLine`, below, covering AUTO_MATCHED/DERIVED/USER_LINKED
 * via a SupplierLineMapping) and every post-import action that links a
 * profile (`selectPackagingProfile`, `createAssortmentItemFromOfferLine`, and
 * a rematch inside `updateOfferLine`) - so a line's canonical identity AND
 * packaging are always derived the same way regardless of HOW the profile
 * became confirmed. The supplier's own source text never needs to restate
 * the product group, variety, stemsPerBox or box weight: once a single
 * profile is confirmed, IT is the trusted source, never the source text
 * (which may be absent, stale, or differently worded on a re-import).
 */
export function applyCanonicalPackaging(
  matchedProfile: MatchedPackagingInfo,
  quantity: number | null,
  unit: OfferUnitLike | null,
): CanonicalPackagingFields {
  const lengthSpec = parseLengthSpec(matchedProfile.stemLength);
  return {
    boxType: matchedProfile.boxType,
    stemsPerBox: matchedProfile.stemsPerBox,
    weightPerBoxKg: matchedProfile.weightPerBoxKg,
    totalStems: calculateTotalStems({ quantity, unit, stemsPerBox: matchedProfile.stemsPerBox }),
    productGroupRaw: matchedProfile.productName,
    varietyRaw: matchedProfile.variety,
    lengthCm: lengthSpec.kind === "single" ? lengthSpec.cm : null,
  };
}

// ---------------------------------------------------------------------------
// Currency default (supplier-configured Farm.defaultCurrency)
// ---------------------------------------------------------------------------

export interface ResolveEffectiveCurrencyInput {
  explicitCurrency: "USD" | "EUR" | null | undefined;
  /** `Farm.defaultCurrency` - trusted supplier configuration, never inferred from country. */
  supplierDefaultCurrency: "USD" | "EUR" | null | undefined;
}

export interface EffectiveCurrencyResult {
  /** The currency to use, or undefined when nothing deterministic resolved it. */
  currency: "USD" | "EUR" | undefined;
  /** True when `currency` was resolved by an explicit source value OR the supplier's configured default. */
  resolved: boolean;
}

/**
 * Resolves the effective currency for one line: an explicitly stated source
 * currency always wins; otherwise the supplier's configured
 * `defaultCurrency` is trusted configuration and resolves it. Every `Farm`
 * has a `defaultCurrency` (NOT NULL, defaults to USD) so in practice this is
 * always resolved once a supplier is known - the `resolved: false` branch
 * only matters for a caller with no farm at all.
 */
export function resolveEffectiveCurrency({
  explicitCurrency,
  supplierDefaultCurrency,
}: ResolveEffectiveCurrencyInput): EffectiveCurrencyResult {
  if (explicitCurrency) return { currency: explicitCurrency, resolved: true };
  if (supplierDefaultCurrency) return { currency: supplierDefaultCurrency, resolved: true };
  return { currency: undefined, resolved: false };
}

// ---------------------------------------------------------------------------
// Warning reconciliation - only for conditions CURRENTLY resolved
// ---------------------------------------------------------------------------

/**
 * The known topics a parser/AI warning can reference. A single AI-authored
 * sentence often combines several ("stemsPerBox not stated so price could
 * not be derived ... currency is not stated") - every referenced topic must
 * be currently resolved before the whole warning is considered stale.
 */
export type WarningTopic = "STEMS_PER_BOX" | "BOX_WEIGHT" | "PRICE" | "CURRENCY" | "TOTAL_STEMS";

// Deliberately broad-but-safe keyword matches per topic (English AI free text
// and the app's own Dutch canned strings). Safety comes not from narrow
// regexes but from `resolved.<topic>` only ever being true when that field
// genuinely IS resolved on the CURRENT effective line - an unrelated warning
// that happens to mention "prijs" is never dropped unless the price is
// actually present now.
const TOPIC_PATTERNS: Record<WarningTopic, RegExp> = {
  STEMS_PER_BOX: /stems?\s*(?:per|\/)\s*box/i,
  BOX_WEIGHT: /box\s*weight|weight\s*per\s*box|doosgewicht/i,
  PRICE: /price|prijs/i,
  CURRENCY: /currency|valuta/i,
  TOTAL_STEMS: /total\s*stems|totaal(?:\s+aantal)?\s+stelen/i,
};

/** Every recognized topic a warning references - empty for an OTHER/unrecognized warning. */
export function detectWarningTopics(warning: string): WarningTopic[] {
  return (Object.keys(TOPIC_PATTERNS) as WarningTopic[]).filter((topic) => TOPIC_PATTERNS[topic].test(warning));
}

export interface ResolvedWarningTopics {
  stemsPerBox: boolean;
  boxWeight: boolean;
  price: boolean;
  currency: boolean;
  totalStems: boolean;
}

const TOPIC_KEY: Record<WarningTopic, keyof ResolvedWarningTopics> = {
  STEMS_PER_BOX: "stemsPerBox",
  BOX_WEIGHT: "boxWeight",
  PRICE: "price",
  CURRENCY: "currency",
  TOTAL_STEMS: "totalStems",
};

/**
 * A warning is stale (fully resolved) only when it references AT LEAST ONE
 * recognized topic AND every topic it references is currently resolved. An
 * OTHER/unrecognized warning (no matched topic at all) is conservatively
 * kept - never guessed away. A warning referencing multiple topics is only
 * dropped once ALL of them are resolved.
 */
export function isWarningResolved(warning: string, resolved: ResolvedWarningTopics): boolean {
  const topics = detectWarningTopics(warning);
  if (topics.length === 0) return false;
  return topics.every((topic) => resolved[TOPIC_KEY[topic]]);
}

/**
 * Drops every warning from `warnings` whose underlying condition(s) are
 * ALL currently resolved (section: "warnings must represent current
 * effective state"). Used both at import (on the freshly enriched line) and
 * at every review-time recomputation (`computeLineValidationMessages`, so
 * the review screen - which always recomputes from the frozen
 * `extractedSnapshot.parserWarnings`, never the persisted `validationWarnings`
 * column - reflects the CURRENT effective state too, not just what was
 * resolved at the moment of import).
 */
export function reconcileWarnings(warnings: readonly string[], resolved: ResolvedWarningTopics): string[] {
  return warnings.filter((w) => !isWarningResolved(w, resolved));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Applies every deterministic enrichment step to one freshly matched line,
 * in order: quantity/unit backfill, canonical packaging from the matched
 * profile, the supplier default currency, then warning reconciliation for
 * whatever is now resolved. Pure - no network, no database (the caller
 * already loaded `matchedProfile`/`supplierDefaultCurrency`).
 */
export function enrichParsedOfferLine(
  line: ParsedOfferLine,
  matchedProfile: MatchedPackagingInfo | null,
  supplierDefaultCurrency: "USD" | "EUR" | null | undefined,
): ParsedOfferLine {
  let next: ParsedOfferLine = { ...line };

  // Quantity/unit backfill from the legacy boxesAvailable field (see module doc).
  if (!next.quantity && !next.unit && next.boxesAvailable != null) {
    next = { ...next, quantity: String(next.boxesAvailable), unit: "BOXES" };
  }

  // Canonical packaging AND product identity from the matched
  // PackagingWeightProfile - the SAME shared computation every other
  // confirmed-match path uses. productGroupRaw is always overwritten (every
  // Product has a name); varietyRaw/lengthCm only when the matched variant
  // itself has a clean value to offer, so a genuinely-unset variant field
  // never blanks out something the line already had.
  if (matchedProfile) {
    const canonical = applyCanonicalPackaging(
      matchedProfile,
      next.quantity !== undefined ? Number(next.quantity) : null,
      next.unit ?? null,
    );
    next = {
      ...next,
      boxType: canonical.boxType,
      stemsPerBox: canonical.stemsPerBox,
      weightPerBoxKg: canonical.weightPerBoxKg,
      productGroupRaw: canonical.productGroupRaw,
      varietyRaw: canonical.varietyRaw ?? next.varietyRaw,
      lengthCm: canonical.lengthCm ?? next.lengthCm,
    };
  }

  // Supplier default currency (explicit source currency always wins).
  const { currency } = resolveEffectiveCurrency({
    explicitCurrency: next.currency,
    supplierDefaultCurrency,
  });
  if (currency) next = { ...next, currency };

  const totalStems = calculateTotalStems({
    quantity: next.quantity !== undefined ? Number(next.quantity) : null,
    unit: next.unit ?? null,
    stemsPerBox: next.stemsPerBox ?? null,
  });

  // Warning reconciliation - only for exactly what is resolved right now.
  next = {
    ...next,
    parserWarnings: reconcileWarnings(next.parserWarnings, {
      stemsPerBox: next.stemsPerBox != null,
      boxWeight: Boolean(next.weightPerBoxKg),
      price: Boolean(next.fobPricePerStem),
      currency: Boolean(next.currency),
      totalStems: totalStems !== null,
    }),
  };

  return next;
}
