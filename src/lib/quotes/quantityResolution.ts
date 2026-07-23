/**
 * Pure, deterministic translation of "how much of this offer line is
 * available" into what quote creation and pricing actually need:
 * `quantityBoxes` (an exact whole number of boxes) and `totalStems`. Never
 * guesses and never applies a silent default (in particular: a missing box
 * count is a blocking error, NEVER assumed to be "1 box" - see the
 * consistency-fix that introduced this module).
 *
 * `stemsPerBox` must already be the CALLER's canonical value (see
 * `resolveCanonicalPackaging` - a matched PackagingWeightProfile's
 * stemsPerBox takes priority over the line's own legacy stemsPerBox). This
 * helper only handles the quantity/unit conversion, not packaging priority,
 * so the two concerns stay independently testable.
 */

export type OfferLineUnit = "STEMS" | "BUNCHES" | "BOXES" | "KILOGRAMS";

export interface OfferLineQuantityInput {
  /** FarmOfferLine.quantity, already converted to a plain number (or null). */
  quantity: number | null;
  /** FarmOfferLine.unit. */
  unit: OfferLineUnit | null;
  /** Legacy FarmOfferLine.boxesAvailable - only used when quantity/unit are absent. */
  boxesAvailable: number | null;
  /** The already-resolved canonical stems-per-box (see `resolveCanonicalPackaging`). */
  stemsPerBox: number | null;
}

export type QuantityResolutionSource = "BOXES" | "STEMS" | "LEGACY_BOXES";

export type QuantityResolutionBlockerCode =
  | "MISSING_QUANTITY"
  | "MISSING_STEMS_PER_BOX"
  | "FRACTIONAL_BOXES"
  | "STEMS_NOT_DIVISIBLE"
  | "BUNCHES_NOT_SUPPORTED"
  | "KILOGRAMS_NOT_SUPPORTED";

export interface QuantityResolutionOk {
  ok: true;
  quantityBoxes: number;
  totalStems: number;
  stemsPerBox: number;
  source: QuantityResolutionSource;
}

export interface QuantityResolutionBlocked {
  ok: false;
  code: QuantityResolutionBlockerCode;
  message: string;
}

export type QuantityResolutionResult = QuantityResolutionOk | QuantityResolutionBlocked;

function ok(quantityBoxes: number, stemsPerBox: number, source: QuantityResolutionSource): QuantityResolutionOk {
  return { ok: true, quantityBoxes, totalStems: quantityBoxes * stemsPerBox, stemsPerBox, source };
}

function blocked(code: QuantityResolutionBlockerCode, message: string): QuantityResolutionBlocked {
  return { ok: false, code, message };
}

const MISSING_STEMS_PER_BOX = () =>
  blocked("MISSING_STEMS_PER_BOX", "Packaging profile is missing stems per box.");

export function resolveOfferLinePricingQuantity(input: OfferLineQuantityInput): QuantityResolutionResult {
  const { quantity, unit, boxesAvailable, stemsPerBox } = input;

  if (unit === "BOXES" && quantity != null) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return blocked("MISSING_QUANTITY", "Quantity is missing.");
    }
    if (!Number.isInteger(quantity)) {
      return blocked("FRACTIONAL_BOXES", "Quantity is not a whole number of boxes.");
    }
    if (stemsPerBox == null || stemsPerBox <= 0) return MISSING_STEMS_PER_BOX();
    return ok(quantity, stemsPerBox, "BOXES");
  }

  if (unit === "STEMS" && quantity != null) {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return blocked("MISSING_QUANTITY", "Quantity is missing.");
    }
    if (stemsPerBox == null || stemsPerBox <= 0) return MISSING_STEMS_PER_BOX();
    if (quantity % stemsPerBox !== 0) {
      return blocked(
        "STEMS_NOT_DIVISIBLE",
        "Stem quantity cannot be converted to whole boxes for this assortment item.",
      );
    }
    return ok(quantity / stemsPerBox, stemsPerBox, "STEMS");
  }

  if (unit === "BUNCHES") {
    return blocked("BUNCHES_NOT_SUPPORTED", "Bunch quantities cannot yet be quoted automatically.");
  }

  if (unit === "KILOGRAMS") {
    return blocked("KILOGRAMS_NOT_SUPPORTED", "Kilogram quantities cannot yet be quoted automatically.");
  }

  // Legacy: no quantity/unit at all - fall back to boxesAvailable, but ONLY
  // when it is explicitly present. Never a silent "1 box" default.
  if (boxesAvailable != null) {
    if (!Number.isFinite(boxesAvailable) || boxesAvailable <= 0) {
      return blocked("MISSING_QUANTITY", "Quantity is missing.");
    }
    if (!Number.isInteger(boxesAvailable)) {
      return blocked("FRACTIONAL_BOXES", "Quantity is not a whole number of boxes.");
    }
    if (stemsPerBox == null || stemsPerBox <= 0) return MISSING_STEMS_PER_BOX();
    return ok(boxesAvailable, stemsPerBox, "LEGACY_BOXES");
  }

  return blocked("MISSING_QUANTITY", "Quantity is missing.");
}
