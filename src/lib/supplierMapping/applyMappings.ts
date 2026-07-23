import "server-only";
import { prisma } from "@/lib/db";
import { normalizeSupplierMappingSource } from "./normalize";
import { matchFarmOfferLine, type MatchFarmOfferLineInput } from "@/lib/import/matching/matchFarmOfferLine";
import type { AssortmentCandidate, AssortmentMatchResult } from "@/lib/import/matching/assortmentMatch";

/**
 * What `applySupplierMappingsThenMatch` needs from one line, independent of
 * whether it's a freshly-parsed `ParsedOfferLine` (upload) or a form
 * submission (manual add / bulk paste) - the three import call sites this
 * module exists to unify (section 21).
 */
export interface MappableOfferLine {
  rawText: string | null | undefined;
  productNameRaw?: string | null;
  productGroupRaw: string | null | undefined;
  varietyRaw: string | null | undefined;
  stemLengthCm: number | null | undefined;
}

export type AppliedLineMatchStatus = "UNMATCHED" | "AUTO_MATCHED" | "AMBIGUOUS" | "DERIVED" | "USER_LINKED";

export interface AppliedLineMatch {
  status: AppliedLineMatchStatus;
  packagingWeightProfileId: string | null;
  productVariantId: string | null;
  derivedProductName?: string;
  options: AssortmentMatchResult["options"];
  /** Section 23 display metadata only - never persisted (no new column). */
  matchedViaMapping: boolean;
}

/**
 * The single shared entry point for "how should this batch of offer lines
 * be matched", used identically by `uploadFarmOffer`, `bulkAddOfferLines`
 * and `addManualOfferLine` (section 21 - "voorkom drie aparte
 * implementaties"). Per line, in order:
 *   1. An exact, approved `SupplierLineMapping` for this farm - checked
 *      FIRST, before the deterministic engine (section 8: the user has
 *      explicitly said "when this supplier writes this, they mean this
 *      article" - that decision must win).
 *   2. Otherwise, the existing deterministic product/variety/length engine
 *      (`matchFarmOfferLine`), completely unchanged.
 *
 * Batching (section 10/36): loads every distinct mapping this batch could
 * need in ONE query (never once per line), then applies everything
 * in-memory. `candidates` must already be loaded once by the caller, exactly
 * as before this module existed.
 */
export async function applySupplierMappingsThenMatch(
  farmId: string,
  lines: MappableOfferLine[],
  candidates: AssortmentCandidate[],
): Promise<AppliedLineMatch[]> {
  const normalizedSources = lines.map((line) => (line.rawText ? normalizeSupplierMappingSource(line.rawText) : null));
  const uniqueSources = [...new Set(normalizedSources.filter((s): s is string => s !== null))];

  const mappings =
    uniqueSources.length > 0
      ? await prisma.supplierLineMapping.findMany({
          where: { farmId, normalizedSource: { in: uniqueSources } },
          include: { packagingWeightProfile: true },
        })
      : [];
  const mappingBySource = new Map(mappings.map((m) => [m.normalizedSource, m]));

  const results: AppliedLineMatch[] = [];
  const usedMappingIds: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normalizedSource = normalizedSources[i];
    const mapping = normalizedSource ? mappingBySource.get(normalizedSource) : undefined;

    // A mapping is only ever used when its target profile still exists AND
    // still belongs to THIS farm (section 24/20) - a `PackagingWeightProfile`
    // delete already Cascades the mapping away, and the query above is
    // already farm-scoped, so this is defense in depth, never trusted blindly.
    if (mapping && mapping.packagingWeightProfile && mapping.packagingWeightProfile.farmId === farmId) {
      results.push({
        status: "USER_LINKED",
        packagingWeightProfileId: mapping.packagingWeightProfileId,
        productVariantId: mapping.packagingWeightProfile.productVariantId,
        options: [],
        matchedViaMapping: true,
      });
      usedMappingIds.push(mapping.id);
      continue;
    }

    const input: MatchFarmOfferLineInput = {
      farmId,
      productNameRaw: line.productNameRaw ?? null,
      productGroupRaw: line.productGroupRaw ?? null,
      varietyRaw: line.varietyRaw ?? null,
      stemLengthCm: line.stemLengthCm ?? null,
    };
    const matched = matchFarmOfferLine(input, candidates);
    results.push({ ...matched, matchedViaMapping: false });
  }

  if (usedMappingIds.length > 0) {
    await incrementMappingUsage(usedMappingIds);
  }

  return results;
}

/**
 * Section 13: `timesUsed` counts one increment per LINE a mapping was
 * applied to (10 matched lines -> +10), never per import. Uses Prisma's
 * atomic `increment` (never a read-then-write in JS, so concurrent imports
 * can never race/lose an update) - one `update` per DISTINCT mapping used
 * in this batch, not one per line, so a mapping matching 10 lines in one
 * offer is a single query with `increment: 10`, not 10 queries.
 */
async function incrementMappingUsage(mappingIds: string[]): Promise<void> {
  const counts = new Map<string, number>();
  for (const id of mappingIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const now = new Date();
  await Promise.all(
    [...counts.entries()].map(([id, count]) =>
      prisma.supplierLineMapping.update({
        where: { id },
        data: { timesUsed: { increment: count }, lastUsedAt: now },
      }),
    ),
  );
}
