import { computeLineValidationMessages } from "@/lib/import";
import type { OfferUnitLike } from "@/lib/import";
import { matchFarmOfferLine } from "@/lib/import/matching/matchFarmOfferLine";
import type { AssortmentCandidate, AssortmentMatchOption } from "@/lib/import/matching/assortmentMatch";
import { isValidSupplierMappingSource } from "@/lib/supplierMapping/mappingSource";
import { hasLengthRange } from "@/lib/import/rangeExpansion";
import type { OfferLineViewModel } from "./ReviewOfferClient";

export function toAssortmentOption(candidate: AssortmentCandidate): AssortmentMatchOption {
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
 * Minimal shape of a persisted `FarmOfferLine` this builder needs. Decimal
 * fields accept anything with a `toString()` (a real Prisma `Decimal`, or a
 * plain string/number in tests) so this stays testable with plain objects,
 * without a database connection.
 */
export interface FarmOfferLineForViewModel {
  id: string;
  rawText: string;
  productGroupRaw: string | null;
  productNameRaw: string | null;
  varietyRaw: string | null;
  colorRaw: string | null;
  gradeRaw: string | null;
  treatmentRaw: string | null;
  boxType: string | null;
  boxesAvailable: number | null;
  stemsPerBox: number | null;
  stemLengthCm: number | null;
  quantity: { toString(): string } | null;
  unit: string | null;
  totalStems: number | null;
  fobPricePerStem: { toString(): string } | null;
  currency: string;
  weightPerBoxKg: { toString(): string } | null;
  notes: string | null;
  matchStatus: string;
  packagingWeightProfileId: string | null;
  extractedSnapshot: unknown;
}

/**
 * Builds the plain, client-serializable view model for one offer line
 * (review-screen rebuild, section 19): recomputes the live match/candidate
 * list for display via the same deterministic engine used everywhere else,
 * WITHOUT ever writing to the database - a `USER_LINKED` line's deliberate
 * human choice is respected as-is (its currently linked profile is looked
 * up, never silently re-evaluated by a page render). Pure given its inputs
 * (`candidates` must already be loaded once by the caller - see
 * `loadFarmAssortmentCandidates` - never re-queried per line), so this is
 * unit-testable without a database connection.
 */
export function buildOfferLineViewModel(
  line: FarmOfferLineForViewModel,
  farmId: string | null,
  candidates: AssortmentCandidate[],
  /**
   * The `packagingWeightProfileId` a `SupplierLineMapping` for this farm +
   * this line's normalized `rawText` currently points to, if any -
   * precomputed once by the caller for the whole offer (never a query per
   * line). Used ONLY to decide the "Matched via supplier mapping" display
   * hint (section 23) - never persisted, never re-evaluated into a database
   * write during this render.
   */
  mappedProfileIdForSource: string | null = null,
): OfferLineViewModel {
  const allOptions = candidates.map(toAssortmentOption);
  const optionsByProfileId = new Map(allOptions.map((o) => [o.packagingWeightProfileId, o]));

  let matchOptions: AssortmentMatchOption[] = [];
  let matchedOption: AssortmentMatchOption | null = line.packagingWeightProfileId
    ? (optionsByProfileId.get(line.packagingWeightProfileId) ?? null)
    : null;

  if (line.matchStatus !== "USER_LINKED" && farmId) {
    const result = matchFarmOfferLine(
      {
        farmId,
        productNameRaw: line.productNameRaw,
        productGroupRaw: line.productGroupRaw,
        varietyRaw: line.varietyRaw,
        stemLengthCm: line.stemLengthCm,
      },
      candidates,
    );
    matchOptions = result.options;
    if (!matchedOption && result.packagingWeightProfileId) {
      matchedOption = optionsByProfileId.get(result.packagingWeightProfileId) ?? null;
    }
  }

  const { validationWarnings, validationErrors } = computeLineValidationMessages(line.extractedSnapshot, {
    packagingWeightProfileId: line.packagingWeightProfileId,
    productGroupRaw: line.productGroupRaw,
    varietyRaw: line.varietyRaw,
    fobPricePerStem: line.fobPricePerStem?.toString() ?? null,
    currency: line.currency,
    unit: line.unit as OfferUnitLike | null,
    stemLengthCm: line.stemLengthCm,
    quantity: line.quantity?.toString() ?? null,
    totalStems: line.totalStems,
    boxesAvailable: line.boxesAvailable,
    stemsPerBox: line.stemsPerBox,
    weightPerBoxKg: line.weightPerBoxKg?.toString() ?? null,
  });

  const snapshot =
    line.extractedSnapshot && typeof line.extractedSnapshot === "object"
      ? (line.extractedSnapshot as Record<string, unknown>)
      : null;

  // Section 23: shown as a subtle hint, never persisted - derived purely
  // from whether a currently-active mapping's target still equals this
  // line's own linked profile. USER_LINKED already covers both "chosen by
  // hand" and "applied from a saved mapping" (section 11) - this is only
  // for a nicer label, the underlying status/data are identical either way.
  const matchedViaSupplierMapping =
    line.matchStatus === "USER_LINKED" &&
    mappedProfileIdForSource !== null &&
    mappedProfileIdForSource === line.packagingWeightProfileId;

  // Section 4/7: a mapping can only be saved from a rawText the supplier
  // actually wrote (never empty/whitespace or an internal placeholder), for
  // a line that already has a confirmed assortment link. A ranged source row
  // ("2hb Alert 40-60cm") is additionally excluded: it was expanded across
  // several lengths (and therefore several packaging/weight profiles), so it
  // cannot be represented by the current one-source -> one-profile mapping key
  // without silently mapping the whole range to a single length. Uses the
  // exact same guards the authoritative server action does, so UI and server
  // never disagree.
  const canSaveAsSupplierMapping =
    isValidSupplierMappingSource(line.rawText) &&
    !hasLengthRange(line.rawText) &&
    Boolean(line.packagingWeightProfileId);

  return {
    id: line.id,
    rawText: line.rawText,
    productGroupRaw: line.productGroupRaw,
    productNameRaw: line.productNameRaw,
    varietyRaw: line.varietyRaw,
    colorRaw: line.colorRaw,
    gradeRaw: line.gradeRaw,
    treatmentRaw: line.treatmentRaw,
    boxType: line.boxType,
    boxesAvailable: line.boxesAvailable,
    stemsPerBox: line.stemsPerBox,
    stemLengthCm: line.stemLengthCm,
    quantity: line.quantity?.toString() ?? null,
    unit: line.unit,
    totalStems: line.totalStems,
    fobPricePerStem: line.fobPricePerStem?.toString() ?? null,
    currency: line.currency,
    weightPerBoxKg: line.weightPerBoxKg?.toString() ?? null,
    notes: line.notes,
    matchStatus: line.matchStatus,
    matchedOption,
    matchOptions,
    validationWarnings: validationWarnings ?? [],
    validationErrors: validationErrors ?? [],
    extractedSnapshot: snapshot,
    matchedViaSupplierMapping,
    canSaveAsSupplierMapping,
  };
}
