import type { OfferUnitLike } from "./types";
import { mergeValidationWarnings, normalizeValidationMessages, readValidationMessages } from "./offerLineMapping";
import { reconcileWarnings } from "./farmOfferEnrichment";

/**
 * Pure, database-independent helpers for a *future* confirm/finalization
 * flow (section 13/14 of "Prisma-datamodel uitbreiden"). Deliberately NOT
 * wired into the existing review button/page yet - this step only builds
 * and tests these helpers, per the explicit scope ("Pas deze helper nog niet
 * toe op de bestaande reviewknop. Alleen bouwen en testen.").
 */

// ---------------------------------------------------------------------------
// Section 13: validateOfferLineForFinalization
// ---------------------------------------------------------------------------

/**
 * The subset of a `FarmOfferLine` this check needs - a plain interface
 * (rather than Prisma's generated row type) so it stays pure and testable
 * with plain objects, without a database connection. `fobPricePerStem` and
 * `quantity` accept `string | number` since a Prisma `Decimal` column can
 * come back as either depending on how it was read/serialized.
 */
export interface FinalizationCheckInput {
  packagingWeightProfileId: string | null | undefined;
  productGroupRaw: string | null | undefined;
  varietyRaw: string | null | undefined;
  fobPricePerStem: string | number | null | undefined;
  currency: string | null | undefined;
  unit: OfferUnitLike | null | undefined;
  stemLengthCm: number | null | undefined;
  quantity: string | number | null | undefined;
  totalStems: number | null | undefined;
  /**
   * Legacy fallback source (section: stale-warning fix) - today's providers
   * only ever populate `boxesAvailable`, never `quantity`/`unit` directly (see
   * `OfferLineReviewRow.tsx`'s own `effectiveUnit`/`effectiveQuantity`
   * display fallback). Without this, a line the reviewer SEES as "Unit:
   * Boxes, Quantity: 2" (derived for display from `boxesAvailable`) was
   * incorrectly reported as missing unit/quantity here, because validation
   * checked only the raw (still-null) `quantity`/`unit` columns. Optional so
   * every existing caller/test that doesn't pass it keeps its current
   * behavior unchanged.
   */
  boxesAvailable?: number | null;
  /**
   * Current effective packaging (section: warning reconciliation) - used
   * ONLY to decide whether a frozen parser warning about a missing
   * stemsPerBox/box weight is now stale, never to add a new blocking
   * check (stemsPerBox/weight are not required for finalization). Optional
   * so every existing caller/test that doesn't pass them keeps its current
   * behavior unchanged.
   */
  stemsPerBox?: number | null;
  weightPerBoxKg?: string | number | null;
}

export interface FinalizationValidationResult {
  errors: string[];
  warnings: string[];
}

function isPresent(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return Number.isFinite(value);
}

/**
 * Checks whether a `FarmOfferLine` is complete enough to be finalized
 * (confirmed as a definitive, assortment-linked offer line). Blocking
 * `errors` mean the line cannot be finalized at all; `warnings` are
 * non-blocking gaps a reviewer should still be aware of. Never touches a
 * database - the caller is responsible for supplying the line's current
 * values (e.g. freshly read from Prisma, or a not-yet-saved draft).
 */
export function validateOfferLineForFinalization(line: FinalizationCheckInput): FinalizationValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPresent(line.packagingWeightProfileId)) {
    errors.push("Geen assortimentartikel gekoppeld.");
  }
  if (!isPresent(line.productGroupRaw)) {
    errors.push("Productgroep ontbreekt.");
  }
  if (!isPresent(line.varietyRaw)) {
    errors.push("Variëteit ontbreekt.");
  }
  if (!isPresent(line.fobPricePerStem)) {
    errors.push("FOB-prijs per steel ontbreekt.");
  }
  if (!isPresent(line.currency)) {
    errors.push("Valuta ontbreekt.");
  }
  // A line whose parser only ever filled the legacy `boxesAvailable` field
  // (every current provider) is treated as having a resolved unit/quantity
  // here too - the same fallback the review screen already displays - so a
  // value the reviewer can see on screen is never reported as missing.
  const effectiveUnit = line.unit ?? (line.boxesAvailable != null ? "BOXES" : null);
  const effectiveQuantity = isPresent(line.quantity) ? line.quantity : (line.boxesAvailable ?? null);

  if (!effectiveUnit) {
    errors.push("Eenheid (unit) ontbreekt.");
  }

  if (line.stemLengthCm === null || line.stemLengthCm === undefined) {
    warnings.push("Steellengte (cm) ontbreekt.");
  }
  if (!isPresent(effectiveQuantity)) {
    warnings.push("Hoeveelheid (quantity) ontbreekt.");
  } else if (line.totalStems === null || line.totalStems === undefined) {
    // Only flagged when a quantity IS present - otherwise the missing-quantity
    // warning above already covers it, and a missing totalStems is expected
    // (nothing to calculate from) rather than a gap in the calculation.
    warnings.push("Totaal aantal stelen kon niet worden berekend.");
  }

  return { errors, warnings };
}

export interface ComputedLineValidationMessages {
  validationWarnings: string[] | null;
  validationErrors: string[] | null;
}

/**
 * Shared orchestration used both when SAVING a line (`updateOfferLine`,
 * `selectPackagingProfile`, `createAssortmentItemFromOfferLine` in
 * `farm-offers/actions.ts`) and when merely DISPLAYING it (the review
 * page's server component, which must never write to the database during a
 * GET - section 19): computes the current `validateOfferLineForFinalization`
 * result against `next`, then merges its warnings with the ORIGINAL parser
 * warnings preserved in `extractedSnapshot` (section 18) - never the other
 * way around, and `validationErrors` is always the fresh set, never merged
 * with a stale persisted value (a resolved error must actually disappear).
 *
 * The frozen `extractedSnapshot.parserWarnings` are themselves reconciled
 * against `next` (`reconcileWarnings`, farmOfferEnrichment.ts) BEFORE the
 * merge: a warning whose every referenced topic (stemsPerBox/box weight/
 * price/currency/total stems) is resolved on the CURRENT effective line -
 * e.g. by a matched `PackagingWeightProfile` or the supplier's configured
 * default currency - no longer represents a real problem, even though the
 * original extraction genuinely didn't state it. This runs on every call
 * (display AND save), not just at import time, so the review screen never
 * shows a warning the app has already resolved. `extractedSnapshot` itself
 * is never mutated - only the merged/returned `validationWarnings`.
 */
export function computeLineValidationMessages(
  extractedSnapshot: unknown,
  next: FinalizationCheckInput,
): ComputedLineValidationMessages {
  const snapshot = extractedSnapshot && typeof extractedSnapshot === "object" ? (extractedSnapshot as Record<string, unknown>) : null;
  const rawParserWarnings = readValidationMessages(snapshot?.parserWarnings);
  const parserWarnings = reconcileWarnings(rawParserWarnings, {
    stemsPerBox: isPresent(next.stemsPerBox),
    boxWeight: isPresent(next.weightPerBoxKg),
    price: isPresent(next.fobPricePerStem),
    currency: isPresent(next.currency),
    totalStems: next.totalStems !== null && next.totalStems !== undefined,
  });
  const { errors, warnings } = validateOfferLineForFinalization(next);
  return {
    validationWarnings: mergeValidationWarnings(parserWarnings, warnings),
    validationErrors: normalizeValidationMessages(errors),
  };
}

// ---------------------------------------------------------------------------
// Section 14: supplier-consistency helper
// ---------------------------------------------------------------------------

/**
 * Domain rule Prisma's foreign key alone cannot enforce (section 1/14): a
 * `FarmOfferLine` may only link to a `PackagingWeightProfile` that belongs
 * to the SAME supplier as the line's own `FarmOffer.farmId` - otherwise the
 * assortment link would silently mix up pricing/packaging data across
 * suppliers. Pure and database-independent - it takes the two farmIds as
 * plain values (already looked up by the caller) rather than querying
 * anything itself, so it can be reused unchanged from any future server
 * action without duplicating this check. A missing offer farmId is always
 * invalid for a *definitive* link (there is nothing to match against), even
 * though `FarmOffer.farmId` itself is nullable at the schema level.
 */
export function isPackagingProfileValidForSupplier(
  offerFarmId: string | null | undefined,
  profileFarmId: string | null | undefined,
): boolean {
  if (!offerFarmId || !profileFarmId) return false;
  return offerFarmId === profileFarmId;
}

// ---------------------------------------------------------------------------
// Section 18: server-side guard for a future manual selection action
// ---------------------------------------------------------------------------

/** The minimal shape a looked-up `PackagingWeightProfile` needs for this check - deliberately not Prisma's generated row type, so this stays pure and testable with a plain object. */
export interface SelectablePackagingWeightProfile {
  id: string;
  farmId: string;
}

export interface ValidatePackagingWeightProfileSelectionInput {
  offerFarmId: string | null | undefined;
  /** The profile the user picked, already looked up by the caller - null/undefined when the id didn't resolve to a real row (e.g. deleted between page load and submit). */
  packagingWeightProfile: SelectablePackagingWeightProfile | null | undefined;
}

export type ValidatePackagingWeightProfileSelectionResult = { ok: true } | { ok: false; message: string };

/**
 * Guards a future "manually choose this assortment article" action (section
 * 18) - not wired into any server action or UI yet. Checks the two things a
 * database foreign key alone cannot: that the profile actually still exists,
 * and that it belongs to the same supplier as the offer being edited (reuses
 * `isPackagingProfileValidForSupplier` above rather than re-implementing the
 * comparison).
 */
export function validatePackagingWeightProfileSelection(
  input: ValidatePackagingWeightProfileSelectionInput,
): ValidatePackagingWeightProfileSelectionResult {
  if (!input.packagingWeightProfile) {
    return { ok: false, message: "Dit assortimentartikel bestaat niet (meer)." };
  }
  if (!isPackagingProfileValidForSupplier(input.offerFarmId, input.packagingWeightProfile.farmId)) {
    return {
      ok: false,
      message: "Dit assortimentartikel behoort tot een andere leverancier en kan niet aan deze aanbieding worden gekoppeld.",
    };
  }
  return { ok: true };
}
