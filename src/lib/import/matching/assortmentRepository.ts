import "server-only";
import { prisma } from "@/lib/db";
import type { AssortmentCandidate } from "./assortmentMatch";

/**
 * Loads every `PackagingWeightProfile` for one farm - i.e. that supplier's
 * full assortment - in a single Prisma query (section 9), pre-joined with
 * `ProductVariant`/`Product` so the pure matcher never needs to query
 * anything itself. Call this ONCE per farm/import (e.g. once per
 * `uploadFarmOffer`, not once per line) and reuse the result for every line
 * via the matcher (`matchFarmOfferLine` /
 * `applySupplierMappingsThenMatch`) - see those modules' docs for why.
 */
export async function loadFarmAssortmentCandidates(farmId: string): Promise<AssortmentCandidate[]> {
  const profiles = await prisma.packagingWeightProfile.findMany({
    where: { farmId },
    include: { productVariant: { include: { product: true } } },
  });

  return profiles.map((profile) => ({
    packagingWeightProfileId: profile.id,
    farmId: profile.farmId,
    productVariantId: profile.productVariantId,
    productId: profile.productVariant.productId,
    productName: profile.productVariant.product.name,
    variety: profile.productVariant.variety,
    stemLength: profile.productVariant.stemLength,
    boxType: profile.boxType,
    stemsPerBox: profile.stemsPerBox,
    boxWeight: profile.weightPerBoxKg.toString(),
  }));
}
