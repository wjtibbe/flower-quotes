import "server-only";
import { prisma } from "@/lib/db";

export interface CreateAssortmentItemInput {
  farmId: string;
  productName: string;
  variety: string;
  /** Free text, e.g. "60 cm" - same convention as `ProductVariant.stemLength` elsewhere in the app. */
  stemLength: string;
  boxType: string;
  stemsPerBox: number;
  /** Decimal string. */
  weightPerBoxKg: string;
}

export interface CreateAssortmentItemResult {
  packagingWeightProfileId: string;
  productVariantId: string;
  productId: string;
  createdProduct: boolean;
  createdVariant: boolean;
  createdProfile: boolean;
  /**
   * The resolved profile's OWN canonical packaging fields - identical to the
   * input when a new profile was just created, but reflects the EXISTING
   * profile's actual values (which may differ from what was typed, e.g. its
   * `weightPerBoxKg`) when an existing profile was reused instead. Callers
   * should always treat this, never the raw form input, as the canonical
   * source once linked (see `applyCanonicalPackaging` in
   * `farmOfferEnrichment.ts`).
   */
  boxType: string;
  stemsPerBox: number;
  weightPerBoxKg: string;
  /** The resolved Product's own canonical name/variety/stemLength - same reuse-not-input caveat as above. */
  productName: string;
  variety: string | null;
  stemLength: string | null;
}

/**
 * Finds-or-creates a supplier-specific assortment article (Product ->
 * ProductVariant -> PackagingWeightProfile) for the "Create assortment item"
 * flow triggered from an UNMATCHED offer line (review-screen rebuild,
 * section 11-13). Mirrors the exact same duplicate-safe lookup logic already
 * used by the central Assortiment management screens
 * (`src/app/(app)/products/actions.ts`: `createCentralProduct` /
 * `bulkAddAssortment`) rather than reinventing it:
 *  - Product: reused by name, case-insensitive.
 *  - ProductVariant: reused by productId + variety + stemLength (both
 *    case-insensitive), restricted to rows with no color/grade/treatment -
 *    exactly the "plain assortment variant" shape those screens create.
 *  - PackagingWeightProfile: reused by farmId + productVariantId + boxType +
 *    stemsPerBox - never a duplicate for the same supplier/article/packaging.
 * Extracted as its own shared helper (rather than duplicated inline) so this
 * new call site and the existing product-management actions stay in sync
 * without either one drifting; the existing actions were intentionally left
 * untouched (not refactored to call this) to avoid any regression risk to
 * their already-tested behavior - see the review-step report for this
 * trade-off.
 */
export async function findOrCreatePackagingWeightProfile(
  input: CreateAssortmentItemInput,
): Promise<CreateAssortmentItemResult> {
  let createdProduct = false;
  let product = await prisma.product.findFirst({
    where: { name: { equals: input.productName, mode: "insensitive" } },
  });
  if (!product) {
    product = await prisma.product.create({ data: { name: input.productName, productGroup: input.productName } });
    createdProduct = true;
  }

  let createdVariant = false;
  let variant = await prisma.productVariant.findFirst({
    where: {
      productId: product.id,
      variety: { equals: input.variety, mode: "insensitive" },
      stemLength: { equals: input.stemLength, mode: "insensitive" },
      color: null,
      grade: null,
      treatment: null,
    },
  });
  if (!variant) {
    variant = await prisma.productVariant.create({
      data: { productId: product.id, variety: input.variety, stemLength: input.stemLength },
    });
    createdVariant = true;
  }

  let createdProfile = false;
  let profile = await prisma.packagingWeightProfile.findFirst({
    where: {
      farmId: input.farmId,
      productVariantId: variant.id,
      boxType: input.boxType,
      stemsPerBox: input.stemsPerBox,
    },
  });
  if (!profile) {
    profile = await prisma.packagingWeightProfile.create({
      data: {
        farmId: input.farmId,
        productVariantId: variant.id,
        boxType: input.boxType,
        stemsPerBox: input.stemsPerBox,
        weightPerBoxKg: input.weightPerBoxKg,
        notes: "Aangemaakt vanuit aanbieding-review",
      },
    });
    createdProfile = true;
  }

  return {
    packagingWeightProfileId: profile.id,
    productVariantId: variant.id,
    productId: product.id,
    createdProduct,
    createdVariant,
    createdProfile,
    boxType: profile.boxType,
    stemsPerBox: profile.stemsPerBox,
    weightPerBoxKg: profile.weightPerBoxKg.toString(),
    productName: product.name,
    variety: variant.variety,
    stemLength: variant.stemLength,
  };
}
