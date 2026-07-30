"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  MANUAL_LINE_RAWTEXT_PLACEHOLDER,
  applyCanonicalPackaging,
  calculateTotalStems,
  computeLineValidationMessages,
  mapQuantityToBoxesAvailable,
  type MatchedPackagingInfo,
} from "@/lib/import";
import { isPackagingProfileValidForSupplier } from "@/lib/import/offerLineValidation";
import { buildAssortmentWhere, type AssortmentFilters, type AssortmentPage } from "../products/assortmentQuery";
import { resolvePagination } from "@/lib/pagination";
import { ConfidenceLevel, Currency, FarmOfferSource, FarmOfferStatus, LineMatchStatus, OfferUnit, PriceUnit } from "@prisma/client";

/**
 * Backend for "Handmatige aanbieding maken" (manual supplier/farm offer
 * entry) - a second, non-parsed way to create a normal FarmOffer/
 * FarmOfferLine, reusing the exact same downstream models, canonical-
 * packaging enrichment (`applyCanonicalPackaging`), and validation helpers
 * the AI/file import path uses (`farm-offers/actions.ts`). Deliberately kept
 * in its own file rather than added to that already-large actions.ts, since
 * it's a self-contained flow with its own header-creation + search +
 * multi-line-save actions.
 */

async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Niet ingelogd");
  return session.user.id;
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// Step 1: create the offer header
// ---------------------------------------------------------------------------

/**
 * Creates the DRAFT FarmOffer header for a manual offer (source: MANUAL, no
 * SourceUpload - there is no uploaded/parsed document behind it) and
 * redirects into the article-picker/line-editor builder page. Farm/offerDate/
 * validUntil follow the same validation shape as the rest of the app
 * (redirect+`err` query param, since this is a plain form submit, not a
 * client-driven multi-line save - see `saveManualOfferLines` for that).
 */
export async function createManualFarmOffer(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const farmId = emptyToNull(formData.get("farmId"));
  const title = emptyToNull(formData.get("title"));
  const offerDateRaw = emptyToNull(formData.get("offerDate"));
  const validUntilRaw = emptyToNull(formData.get("validUntil"));

  if (!farmId) {
    redirect(`/farm-offers/manual?err=${encodeURIComponent("Leverancier is verplicht")}`);
  }
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  if (!farm) {
    redirect(`/farm-offers/manual?err=${encodeURIComponent("De gekozen leverancier bestaat niet meer")}`);
  }

  const offerDate = offerDateRaw ? new Date(offerDateRaw) : new Date();
  const validUntil = validUntilRaw ? new Date(validUntilRaw) : null;
  if (validUntil && validUntil < offerDate) {
    redirect(`/farm-offers/manual?err=${encodeURIComponent("Geldig tot kan niet vóór de aanbiedingsdatum liggen")}`);
  }

  const offer = await prisma.farmOffer.create({
    data: {
      farmId,
      title,
      offerDate,
      validUntil,
      status: FarmOfferStatus.DRAFT,
      source: FarmOfferSource.MANUAL,
      createdById: userId,
    },
  });
  revalidatePath("/farm-offers");
  redirect(`/farm-offers/manual/${offer.id}`);
}

// ---------------------------------------------------------------------------
// Step 2: search the chosen supplier's assortment (paginated, farm-scoped)
// ---------------------------------------------------------------------------

export interface ManualOfferAssortmentFilters extends Omit<AssortmentFilters, "farmId"> {
  /** When false (default), expired articles (effectiveTo in the past) are excluded - matches "only active assortment articles are shown by default". */
  includeInactive?: boolean;
}

/**
 * Farm-scoped, paginated assortment search for the manual-offer article
 * picker - reuses `buildAssortmentWhere`/the Assortiment overview's own
 * pagination (`resolvePagination`) rather than a second query/search
 * implementation, so this never drifts from how the Assortiment page itself
 * filters. Called directly (not via a `<form>`) from the client builder
 * component, so it returns data instead of redirecting.
 */
export async function searchManualOfferAssortment(
  farmId: string,
  filters: ManualOfferAssortmentFilters,
  page: number,
): Promise<AssortmentPage> {
  await requireUserId();
  const where = buildAssortmentWhere({ ...filters, farmId });
  if (!filters.includeInactive) {
    const now = new Date();
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { effectiveFrom: { lte: now } },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] },
    ];
  }

  const pageSize = 20;
  const totalCount = await prisma.packagingWeightProfile.count({ where });
  const pagination = resolvePagination(page, pageSize, totalCount);
  const rows = await prisma.packagingWeightProfile.findMany({
    where,
    include: { farm: true, productVariant: { include: { product: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: pagination.skip,
    take: pagination.take,
  });
  return { rows, pagination };
}

// ---------------------------------------------------------------------------
// Step 3/4: save the picked articles + entered quantities/prices as real
// FarmOfferLine rows, atomically.
// ---------------------------------------------------------------------------

export interface ManualOfferLineInput {
  /** A client-side-only key (e.g. the packagingWeightProfileId itself) used solely to address per-line errors back to the right row - never persisted. */
  key: string;
  packagingWeightProfileId: string;
  quantity: string;
  unit: OfferUnit;
  fobPricePerStem: string;
  notes?: string | null;
}

export type ManualOfferSaveResult =
  | { ok: true; offerId: string }
  | { ok: false; globalError?: string; lineErrors: Record<string, string> };

function validateManualLine(line: ManualOfferLineInput): string | null {
  const quantity = Number(line.quantity);
  if (!line.quantity || !Number.isFinite(quantity) || quantity <= 0) {
    return "Hoeveelheid moet positief zijn";
  }
  if (!line.unit) return "Eenheid is verplicht";
  const price = Number(line.fobPricePerStem);
  if (!line.fobPricePerStem || !Number.isFinite(price) || price <= 0) {
    return "Prijs moet positief zijn";
  }
  return null;
}

/**
 * Persists every picked article as a real `FarmOfferLine`, in one
 * transaction (all-or-nothing, matching `uploadFarmOffer`'s own "a failure
 * leaves nothing half-created" guarantee). Each line is enriched from its
 * chosen `PackagingWeightProfile` via the exact same `applyCanonicalPackaging`
 * helper the review screen's "select assortment article" action uses
 * (`selectPackagingProfile` in `actions.ts`), so a manually created line's
 * packaging/product identity is derived from the canonical article, never
 * retyped - and gets `matchStatus: USER_LINKED` (the user picked the exact
 * article, so there is nothing left to "match"). Validation happens twice:
 * once per-line here (defense in depth - the client already blocks an
 * invalid save), reported back keyed by each line's own `key` so the UI can
 * show the error on that exact row rather than one generic message.
 */
export async function saveManualOfferLines(
  offerId: string,
  currency: Currency,
  lines: ManualOfferLineInput[],
): Promise<ManualOfferSaveResult> {
  await requireUserId();

  const offer = await prisma.farmOffer.findUnique({ where: { id: offerId } });
  if (!offer) return { ok: false, globalError: "Deze aanbieding bestaat niet meer. Ververs de pagina.", lineErrors: {} };
  if (offer.source !== FarmOfferSource.MANUAL) {
    return { ok: false, globalError: "Dit is geen handmatige aanbieding.", lineErrors: {} };
  }
  if (lines.length === 0) {
    return { ok: false, globalError: "Voeg minstens één assortimentartikel toe.", lineErrors: {} };
  }

  const lineErrors: Record<string, string> = {};
  for (const line of lines) {
    const error = validateManualLine(line);
    if (error) lineErrors[line.key] = error;
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.packagingWeightProfileId)) {
      lineErrors[line.key] = lineErrors[line.key] ?? "Dit artikel is al toegevoegd aan deze aanbieding.";
    }
    seen.add(line.packagingWeightProfileId);
  }
  if (Object.keys(lineErrors).length > 0) {
    return { ok: false, lineErrors };
  }

  const profiles = await prisma.packagingWeightProfile.findMany({
    where: { id: { in: lines.map((l) => l.packagingWeightProfileId) } },
    include: { productVariant: { include: { product: true } } },
  });
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  for (const line of lines) {
    const profile = profileById.get(line.packagingWeightProfileId);
    if (!profile) {
      lineErrors[line.key] = "Dit assortimentartikel bestaat niet (meer).";
    } else if (!isPackagingProfileValidForSupplier(offer.farmId, profile.farmId)) {
      lineErrors[line.key] = "Dit assortimentartikel behoort tot een andere leverancier.";
    }
  }
  if (Object.keys(lineErrors).length > 0) {
    return { ok: false, lineErrors };
  }

  try {
    await prisma.$transaction(
      lines.map((line) => {
        const profile = profileById.get(line.packagingWeightProfileId)!;
        const quantity = Number(line.quantity);
        const matchedPackaging: MatchedPackagingInfo = {
          boxType: profile.boxType,
          stemsPerBox: profile.stemsPerBox,
          weightPerBoxKg: profile.weightPerBoxKg.toString(),
          productName: profile.productVariant.product.name,
          variety: profile.productVariant.variety,
          stemLength: profile.productVariant.stemLength,
        };
        const canonical = applyCanonicalPackaging(matchedPackaging, quantity, line.unit);
        const totalStems = canonical.totalStems ?? calculateTotalStems({ quantity, unit: line.unit, stemsPerBox: profile.stemsPerBox });
        const { validationWarnings, validationErrors } = computeLineValidationMessages(null, {
          packagingWeightProfileId: profile.id,
          productGroupRaw: canonical.productGroupRaw,
          varietyRaw: canonical.varietyRaw,
          fobPricePerStem: line.fobPricePerStem,
          currency,
          unit: line.unit,
          stemLengthCm: canonical.lengthCm,
          quantity: line.quantity,
          totalStems,
          stemsPerBox: canonical.stemsPerBox,
          weightPerBoxKg: canonical.weightPerBoxKg,
        });

        return prisma.farmOfferLine.create({
          data: {
            farmOfferId: offerId,
            rawText: MANUAL_LINE_RAWTEXT_PLACEHOLDER,
            productGroupRaw: canonical.productGroupRaw,
            varietyRaw: canonical.varietyRaw,
            colorRaw: profile.productVariant.color,
            gradeRaw: profile.productVariant.grade,
            treatmentRaw: profile.productVariant.treatment ?? "normal",
            boxType: canonical.boxType,
            stemsPerBox: canonical.stemsPerBox,
            weightPerBoxKg: canonical.weightPerBoxKg,
            stemLengthCm: canonical.lengthCm,
            quantity,
            unit: line.unit,
            totalStems,
            boxesAvailable: mapQuantityToBoxesAvailable(quantity, line.unit),
            fobPricePerStem: line.fobPricePerStem,
            currency,
            priceUnit: PriceUnit.PER_STEM,
            notes: emptyToNull(line.notes ?? null),
            packagingWeightProfileId: profile.id,
            productVariantId: profile.productVariantId,
            matchStatus: LineMatchStatus.USER_LINKED,
            confidence: ConfidenceLevel.HIGH,
            needsReview: false,
            validationWarnings: validationWarnings as never,
            validationErrors: validationErrors as never,
          },
        });
      }),
    );
  } catch {
    return { ok: false, globalError: "Opslaan is mislukt door een databasefout. Probeer het opnieuw.", lineErrors: {} };
  }

  revalidatePath("/farm-offers");
  revalidatePath(`/farm-offers/${offerId}`);
  revalidatePath(`/farm-offers/${offerId}/review`);
  return { ok: true, offerId };
}
