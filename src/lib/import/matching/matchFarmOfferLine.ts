import "server-only";
import { matchAssortment, resolveImportedProductName } from "./assortmentMatch";
import type { AssortmentCandidate, AssortmentMatchResult } from "./assortmentMatch";
import { loadFarmAssortmentCandidates } from "./assortmentRepository";

/** What's needed to attempt a match for one line - shaped so both a fresh `ParsedOfferLine` (at upload time) and a persisted `FarmOfferLine` (a future re-match after correction, section 13) satisfy it structurally without adaptation. */
export interface MatchFarmOfferLineInput {
  farmId: string;
  productNameRaw?: string | null;
  productGroupRaw?: string | null;
  varietyRaw?: string | null;
  stemLengthCm?: number | null;
}

/**
 * Matches one line against a pre-loaded candidate set for the SAME farm
 * (section 10). Pure aside from the import chain - takes no database
 * connection itself; the caller is responsible for having loaded
 * `candidates` via `loadFarmAssortmentCandidates(farmId)` (once, not per
 * line - see `matchOfferLines` below).
 */
export function matchFarmOfferLine(
  input: MatchFarmOfferLineInput,
  candidates: AssortmentCandidate[],
): AssortmentMatchResult {
  return matchAssortment(
    {
      farmId: input.farmId,
      productName: resolveImportedProductName(input),
      variety: input.varietyRaw ?? null,
      stemLengthCm: input.stemLengthCm ?? null,
    },
    candidates,
  );
}

/**
 * Batch version (section 15): matches every line of an offer against the
 * SAME already-loaded candidate set, so an offer with e.g. 100 lines loads
 * the farm's assortment exactly once, not once per line. This is the
 * function `uploadFarmOffer` uses.
 */
export function matchOfferLines(
  farmId: string,
  lines: Omit<MatchFarmOfferLineInput, "farmId">[],
  candidates: AssortmentCandidate[],
): AssortmentMatchResult[] {
  return lines.map((line) => matchFarmOfferLine({ ...line, farmId }, candidates));
}

/**
 * Convenience, database-touching wrapper for matching a single line on
 * demand (section 13: "her-matching na correctie - engine alvast
 * geschikt"). Loads that farm's assortment fresh and runs the same pure
 * matcher - intended for a future "re-match this line" action once a user
 * edits its product/variety/length, but no such action/UI is wired up in
 * this step.
 */
export async function matchSingleFarmOfferLine(input: MatchFarmOfferLineInput): Promise<AssortmentMatchResult> {
  const candidates = await loadFarmAssortmentCandidates(input.farmId);
  return matchFarmOfferLine(input, candidates);
}
