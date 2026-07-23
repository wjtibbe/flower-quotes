/**
 * Resolves which packaging data (box type, stems per box, box weight) a
 * quote should actually use. A matched `PackagingWeightProfile` is always
 * the canonical source once it exists - it's the supplier's own, current
 * assortment definition. The legacy fields stored directly on
 * `FarmOfferLine` (`boxType`/`stemsPerBox`/`weightPerBoxKg`, originally
 * parsed straight off the offer text) are used ONLY when no profile is
 * linked at all, purely for backward compatibility with historical lines
 * that predate the matching engine.
 *
 * Priority, explicit and in this order, never guessed:
 *   1. PackagingWeightProfile (canonical, supplier-confirmed)
 *   2. FarmOfferLine's own legacy snapshot (historical compatibility only)
 *   3. never invented/defaulted
 */

export interface CanonicalPackagingProfileInput {
  boxType: string;
  stemsPerBox: number;
  weightPerBoxKg: string | number | { toString(): string };
}

export interface CanonicalPackagingLegacyInput {
  boxType: string | null | undefined;
  stemsPerBox: number | null | undefined;
  weightPerBoxKg: string | number | { toString(): string } | null | undefined;
}

export type CanonicalPackagingSource = "PROFILE" | "LEGACY";

export interface CanonicalPackagingResult {
  boxType: string | null;
  stemsPerBox: number | null;
  weightPerBoxKg: string | null;
  source: CanonicalPackagingSource;
}

export function resolveCanonicalPackaging(
  profile: CanonicalPackagingProfileInput | null | undefined,
  legacy: CanonicalPackagingLegacyInput,
): CanonicalPackagingResult {
  if (profile) {
    return {
      boxType: profile.boxType,
      stemsPerBox: profile.stemsPerBox,
      weightPerBoxKg: profile.weightPerBoxKg.toString(),
      source: "PROFILE",
    };
  }
  return {
    boxType: legacy.boxType ?? null,
    stemsPerBox: legacy.stemsPerBox ?? null,
    weightPerBoxKg: legacy.weightPerBoxKg != null ? legacy.weightPerBoxKg.toString() : null,
    source: "LEGACY",
  };
}
