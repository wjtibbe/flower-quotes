import { CURRENCY_NOT_STATED_WARNING } from "./provider";
import type { ParsedOfferLine } from "./types";

/**
 * Deterministic, database-driven enrichment of a freshly matched
 * `ParsedOfferLine`, applied AFTER assortment matching and BEFORE
 * persistence (see `uploadFarmOffer` in farm-offers/actions.ts). Human
 * review should only be required when the application genuinely does not
 * know something (see the module's originating spec) - so once a value is
 * deterministically derivable from trusted application data (the matched
 * `PackagingWeightProfile`, the supplier's own country, or the line's own
 * already-extracted fields), it is filled in automatically here instead of
 * being left for a reviewer to re-type something the app already knows.
 *
 * Nothing here ever calls Anthropic/AI - every step is pure, deterministic
 * application/database logic. Nothing here ever touches `rawText` or
 * `extractedSnapshot`: those stay built from the ORIGINAL, un-enriched line
 * (see the `originalForSnapshot` parameter of `mapParsedOfferLineToCreateInput`
 * in offerLineMapping.ts) so the audit trail always shows exactly what the
 * supplier wrote and what the AI originally extracted, HB included.
 *
 * Field precedence implemented here:
 *  - Packaging (boxType/stemsPerBox/weightPerBoxKg): once a line has
 *    matched a SINGLE concrete `PackagingWeightProfile` (AUTO_MATCHED,
 *    DERIVED, or USER_LINKED via a saved SupplierLineMapping - never
 *    AMBIGUOUS/UNMATCHED, which have no single profile to trust), that
 *    profile's canonical values ALWAYS win - overriding whatever (if
 *    anything) the supplier text/AI extraction stated, since suppliers
 *    essentially never state stemsPerBox/box weight explicitly and the
 *    profile is this app's own trusted assortment record for exactly this
 *    farm + product + variety + length + box type. Unmatched lines are left
 *    untouched (nothing trusted to enrich from).
 *  - Currency: an explicit source currency ALWAYS wins over any default.
 *    Only when no currency was stated AND a price is present AND the
 *    farm's country is Colombia or Ecuador, currency defaults to USD (see
 *    `resolveEffectiveCurrency`). Any other country's missing currency is
 *    left unresolved here - the existing unconditional `?? "USD"` fallback
 *    in `mapParsedOfferLineToCreateInput` still persists a valid DB value
 *    for it (the `currency` column is NOT NULL), but that fallback is NOT
 *    treated as "resolved" for warning-suppression purposes, so the
 *    reviewer still sees a warning for a country this business rule doesn't
 *    cover.
 *  - Quantity/unit: when the parser only ever populated the legacy
 *    `boxesAvailable` field (every current provider), quantity/unit are
 *    backfilled as `{quantity: boxesAvailable, unit: BOXES}` - the exact
 *    same assumption the review screen's own display fallback already made
 *    (see `OfferLineReviewRow.tsx`'s `effectiveQuantity`/`effectiveUnit`),
 *    now applied to the actual data so `totalStems` can be CALCULATED
 *    (`calculateTotalStems` in offerLineMapping.ts, unchanged) instead of
 *    merely display-approximated.
 */

// ---------------------------------------------------------------------------
// Packaging enrichment
// ---------------------------------------------------------------------------

/** The canonical packaging fields a matched `PackagingWeightProfile` contributes. */
export interface MatchedPackagingInfo {
  boxType: string;
  stemsPerBox: number;
  /** Decimal string, e.g. "7.000". */
  weightPerBoxKg: string;
}

// ---------------------------------------------------------------------------
// Currency default (Colombia/Ecuador -> USD)
// ---------------------------------------------------------------------------

// Farm.country is free-text (e.g. "Colombia", "Ecuador", "Netherlands" - see
// seedData.ts) - matched case-insensitively/trimmed so "colombia"/"ECUADOR"
// still qualify. Deliberately a fixed allowlist of exact country names, not
// a region/currency-zone lookup - this implements exactly the two countries
// the business rule names, nothing broader.
const USD_DEFAULT_COUNTRIES = new Set(["colombia", "ecuador"]);

export interface EffectiveCurrencyResult {
  /** The currency to use, or undefined when nothing deterministic resolved it. */
  currency: "USD" | "EUR" | undefined;
  /** True only when `currency` was resolved by an explicit source value OR the Colombia/Ecuador rule - never by any later, unconditional persistence-time fallback. */
  resolved: boolean;
}

/**
 * Resolves the effective currency for one line (business rule, section 2 of
 * the spec). An explicitly stated source currency always wins. Otherwise,
 * for a Colombia/Ecuador farm with a stated price, defaults to USD. Any
 * other case is left unresolved (`resolved: false`) - the caller/DB layer
 * may still need SOME value to persist (`currency` is NOT NULL), but that
 * later fallback must never be mistaken for this rule having applied.
 */
export function resolveEffectiveCurrency(
  explicitCurrency: "USD" | "EUR" | null | undefined,
  farmCountry: string | null | undefined,
  hasPrice: boolean,
): EffectiveCurrencyResult {
  if (explicitCurrency) return { currency: explicitCurrency, resolved: true };
  const country = farmCountry?.trim().toLowerCase();
  if (hasPrice && country && USD_DEFAULT_COUNTRIES.has(country)) {
    return { currency: "USD", resolved: true };
  }
  return { currency: undefined, resolved: false };
}

// ---------------------------------------------------------------------------
// Warning cleanup - only for conditions THIS enrichment step resolved
// ---------------------------------------------------------------------------

// Distinctive enough (an unusual English field name) that matching on it
// anywhere in an AI-authored warning is safe - see the module doc's
// packaging precedence: this is only ever applied when a matched profile
// really did just supply a concrete stemsPerBox.
const STEMS_PER_BOX_WARNING_RE = /stems\s*per\s*box/i;

export interface ResolvedByEnrichment {
  stemsPerBox: boolean;
  currency: boolean;
}

/**
 * Drops parser warnings whose underlying condition this enrichment step has
 * just deterministically resolved (section 3 of the spec: "warnings must
 * represent current effective state"). Never touches any other warning -
 * including a genuinely still-unresolved one, or one unrelated to these two
 * specific conditions - so nothing is blindly deleted.
 */
export function filterResolvedEnrichmentWarnings(
  warnings: readonly string[],
  resolved: ResolvedByEnrichment,
): string[] {
  return warnings.filter((w) => {
    if (resolved.currency && w === CURRENCY_NOT_STATED_WARNING) return false;
    if (resolved.stemsPerBox && STEMS_PER_BOX_WARNING_RE.test(w)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Applies every deterministic enrichment step to one freshly matched line,
 * in order: quantity/unit backfill, canonical packaging from the matched
 * profile, the Colombia/Ecuador currency default, then warning cleanup for
 * whatever this step actually resolved. Pure - no network, no database
 * (the caller already loaded `matchedProfile`/`farmCountry`).
 */
export function enrichParsedOfferLine(
  line: ParsedOfferLine,
  matchedProfile: MatchedPackagingInfo | null,
  farmCountry: string | null | undefined,
): ParsedOfferLine {
  let next: ParsedOfferLine = { ...line };

  // Quantity/unit backfill from the legacy boxesAvailable field (see module doc).
  if (!next.quantity && !next.unit && next.boxesAvailable != null) {
    next = { ...next, quantity: String(next.boxesAvailable), unit: "BOXES" };
  }

  // Canonical packaging from the matched PackagingWeightProfile.
  const stemsPerBoxResolved = matchedProfile !== null;
  if (matchedProfile) {
    next = {
      ...next,
      boxType: matchedProfile.boxType,
      stemsPerBox: matchedProfile.stemsPerBox,
      weightPerBoxKg: matchedProfile.weightPerBoxKg,
    };
  }

  // Colombia/Ecuador currency default (explicit source currency always wins - see resolveEffectiveCurrency).
  const { currency, resolved: currencyResolved } = resolveEffectiveCurrency(
    next.currency,
    farmCountry,
    Boolean(next.fobPricePerStem),
  );
  if (currency) next = { ...next, currency };

  // Warning cleanup - only for exactly what was just resolved above.
  next = {
    ...next,
    parserWarnings: filterResolvedEnrichmentWarnings(next.parserWarnings, {
      stemsPerBox: stemsPerBoxResolved,
      currency: currencyResolved,
    }),
  };

  return next;
}
