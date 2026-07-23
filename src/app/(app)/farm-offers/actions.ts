"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { randomUUID } from "node:crypto";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  detectFileType,
  runImport,
  runPastedTextImport,
  validateUploadSource,
  isUploadableFileKind,
  unsupportedFileTypeMessage,
  mapParsedOfferLineToCreateInput,
  calculateTotalStems,
  mapQuantityToBoxesAvailable,
  validateOfferLineForFinalization,
  validatePackagingWeightProfileSelection,
  computeLineValidationMessages,
  MANUAL_LINE_RAWTEXT_PLACEHOLDER,
  type ImportResult,
  type OfferUnitLike,
} from "@/lib/import";
import { loadFarmAssortmentCandidates } from "@/lib/import/matching/assortmentRepository";
import { matchFarmOfferLine } from "@/lib/import/matching/matchFarmOfferLine";
import { haveMatchAffectingFieldsChanged, resolveImportedProductName } from "@/lib/import/matching/assortmentMatch";
import { findOrCreatePackagingWeightProfile } from "@/lib/import/matching/assortmentCreate";
import { applySupplierMappingsThenMatch } from "@/lib/supplierMapping/applyMappings";
import { normalizeSupplierMappingSource } from "@/lib/supplierMapping/normalize";
import { isValidSupplierMappingSource } from "@/lib/supplierMapping/mappingSource";
import { hasLengthRange } from "@/lib/import/rangeExpansion";
import { isPackagingProfileValidForSupplier } from "@/lib/import/offerLineValidation";
import {
  ConfidenceLevel,
  Currency,
  FarmOfferStatus,
  LineMatchStatus,
  OfferUnit,
  PriceUnit,
  SourceFileType,
} from "@prisma/client";
import { blockedDeleteMessage } from "@/lib/deletionMessage";
import { normalizeBulkIds } from "@/lib/bulkIds";
import type { ActionResult } from "@/lib/actionResult";

const CONFIDENCE_MAP: Record<string, ConfidenceLevel> = {
  high: ConfidenceLevel.HIGH,
  medium: ConfidenceLevel.MEDIUM,
  low: ConfidenceLevel.LOW,
};

async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Niet ingelogd");
  return session.user.id;
}

/** Form state for `uploadFarmOffer`, used with `useFormState` (see UploadForm.tsx) so a validation/parse/database failure re-renders the same form - with the supplier, title and pasted text the user already entered still in place - instead of navigating away or throwing. */
export interface UploadFormState {
  error?: string;
}

/**
 * Validates the source (file XOR pasted text, supplier required), runs it
 * through the import pipeline, and - only once that has produced a usable
 * result - atomically persists SourceUpload + FarmOffer + FarmOfferLine[] in
 * a single Prisma transaction (section 9: "Zorg dat een parserfout of
 * databasefout geen half aangemaakte import achterlaat"). A validation
 * failure, a parser fatalError, or a database error during the transaction
 * all leave nothing behind - the form re-renders with the concrete error and
 * the user can adjust and retry, rather than being left with a half-created,
 * empty offer to clean up. There is deliberately no "save SourceUpload even
 * on a failed parse" fallback here: doing that would need a failure-status
 * column this step isn't scoped to add (no Prisma migration), so per the
 * spec's explicit preference, a failed parse persists nothing at all.
 */
export async function uploadFarmOffer(_prevState: UploadFormState, formData: FormData): Promise<UploadFormState> {
  const userId = await requireUserId();
  const file = formData.get("file") as File | null;
  const pastedText = (formData.get("pastedText") as string) || "";
  const farmId = (formData.get("farmId") as string) || null;
  const title = ((formData.get("title") as string) || "").trim() || null;

  const validation = validateUploadSource({
    farmId,
    file: file && file.size > 0 ? { name: file.name, size: file.size } : null,
    pastedText,
  });
  if (!validation.ok) {
    return { error: validation.message };
  }

  // The supplier the user selected before uploading is a strong hint for the
  // AI parser (section 2: "de prompt moet de gekozen leverancier meekrijgen")
  // - it is never allowed to change this choice, only to flag a suspected
  // mismatch as a parserWarning on the affected line(s).
  const farm = await prisma.farm.findUnique({ where: { id: farmId! }, select: { name: true, country: true } });
  if (!farm) {
    return { error: "De gekozen leverancier bestaat niet meer. Ververs de pagina en probeer het opnieuw." };
  }
  const context = { supplierName: farm.name, supplierCountry: farm.country };

  let result: ImportResult;
  let sourceUploadData: {
    fileType: SourceFileType;
    originalName: string;
    storagePath: string;
    fileData: Buffer | null;
    rawText: string | null;
  };
  let defaultTitle: string;

  if (validation.source === "file") {
    const fileType = detectFileType(file!.name, file!.type);
    if (!isUploadableFileKind(fileType)) {
      return { error: unsupportedFileTypeMessage() };
    }

    const buffer = Buffer.from(await file!.arrayBuffer());
    result = await runImport(fileType, buffer, context, { fileName: file!.name, mimeType: file!.type });

    // File bytes are stored in the database (fileData), not on local disk -
    // serverless hosting (Vercel) has no writable/durable filesystem outside
    // a request's own /tmp. storagePath is kept as a descriptive label only.
    const storedName = `${randomUUID()}-${file!.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    sourceUploadData = {
      fileType: fileType as SourceFileType,
      originalName: file!.name,
      storagePath: `uploads/${storedName}`,
      fileData: buffer,
      rawText: result.rawText || null,
    };
    defaultTitle = file!.name;
  } else {
    result = await runPastedTextImport(validation.text, context);
    sourceUploadData = {
      // SourceUpload.fileType has no dedicated "pasted text" value - MANUAL
      // is the closest existing fit (no bytes, no real uploaded file).
      fileType: SourceFileType.MANUAL,
      originalName: "Pasted text",
      // A plain label, never a path implying a real file on disk - there is
      // no file here at all, only pasted text stored in `rawText` below.
      storagePath: "pasted-text",
      fileData: null,
      rawText: result.rawText || validation.text,
    };
    defaultTitle = "Geplakte tekst";
  }

  if (result.fatalError) {
    return { error: result.fatalError };
  }

  // Assortment matching (section 11/15, extended per the supplier-mapping
  // step - section 8/21): the farm's assortment is loaded ONCE here - not
  // once per line - and every line is matched in-memory against that same
  // candidate set, so an offer with e.g. 100 lines never triggers more than
  // this one extra query. `applySupplierMappingsThenMatch` checks an exact,
  // approved SupplierLineMapping for this farm FIRST (the user's explicit
  // "when this supplier writes this, they mean this article" decision), and
  // only falls back to the deterministic engine when no mapping applies.
  // Supplier scoping is enforced repeatedly: the mapping lookup itself is
  // farm-scoped, `loadFarmAssortmentCandidates` only ever loads this
  // farmId's rows, and `matchAssortment` re-filters by farmId defensively
  // too - so a profile/mapping belonging to another farm can never end up
  // linked here.
  const assortmentCandidates = await loadFarmAssortmentCandidates(farmId!);
  const matchResults = await applySupplierMappingsThenMatch(
    farmId!,
    result.lines.map((line) => ({
      rawText: line.rawText ?? null,
      productNameRaw: line.productNameRaw ?? null,
      productGroupRaw: line.productGroupRaw ?? null,
      varietyRaw: line.varietyRaw ?? null,
      stemLengthCm: line.lengthCm ?? null,
    })),
    assortmentCandidates,
  );

  let farmOfferId: string;
  try {
    farmOfferId = await prisma.$transaction(async (tx) => {
      const sourceUpload = await tx.sourceUpload.create({
        data: { ...sourceUploadData, uploadedById: userId },
      });

      const farmOffer = await tx.farmOffer.create({
        data: {
          farmId,
          sourceUploadId: sourceUpload.id,
          title: title || defaultTitle,
          status: FarmOfferStatus.DRAFT,
          createdById: userId,
          lines: {
            // The full ParsedOfferLine -> FarmOfferLine mapping lives in one
            // place (`mapParsedOfferLineToCreateInput`, offerLineMapping.ts)
            // rather than spread across this action - see that function's
            // doc comment for exactly what it maps (stemLengthCm, quantity/
            // unit, totalStems, extractedSnapshot, validationWarnings, ...).
            // Only the few fields Prisma requires as generated enums (rather
            // than the plain string literals the provider-agnostic mapping
            // helper deals in) are converted here, mirroring how `currency`
            // was already cast before this change. The assortment match
            // result computed above (same index) overrides the mapping
            // helper's own UNMATCHED/null defaults for
            // packagingWeightProfileId/productVariantId/matchStatus - see
            // `matching/assortmentMatch.ts` for exactly when each status is
            // produced. `extractedSnapshot` is built solely from the parser
            // output above and is never touched here - matching data never
            // flows into it (section 12).
            create: result.lines.map((line, index) => {
              const mapped = mapParsedOfferLineToCreateInput(line);
              const match = matchResults[index];
              return {
                ...mapped,
                currency: (mapped.currency as Currency) ?? Currency.USD,
                priceUnit: mapped.priceUnit as PriceUnit,
                matchStatus: match.status as LineMatchStatus,
                packagingWeightProfileId: match.packagingWeightProfileId,
                productVariantId: match.productVariantId ?? undefined,
                unit: mapped.unit as OfferUnit | undefined,
                confidence: CONFIDENCE_MAP[mapped.confidence] ?? ConfidenceLevel.LOW,
                fieldConfidence: mapped.fieldConfidence as never,
                extractedSnapshot: mapped.extractedSnapshot as never,
                validationWarnings: mapped.validationWarnings as never,
              };
            }),
          },
        },
      });

      return farmOffer.id;
    });
  } catch {
    // Never surface a raw Prisma error to the user; the transaction rolled
    // back automatically, so nothing was left half-created.
    return { error: "Opslaan is mislukt door een databasefout. Probeer het opnieuw." };
  }

  redirect(`/farm-offers/${farmOfferId}/review`);
}


/**
 * Saves a correction to one offer line and, in the same server-side flow
 * (section 5: "Voorkom ... aparte handmatige rematch-knop"), re-derives
 * everything that depends on the edited fields:
 *  - `totalStems` is recalculated from the new quantity/unit/stemsPerBox.
 *  - The assortment link is only ever re-matched when a "match-affecting"
 *    field actually changed - product, variety or stemLengthCm (section 14).
 *    A `USER_LINKED` profile the user explicitly chose is preserved as-is
 *    across a notes/price/packaging-only edit; it is only re-evaluated (and
 *    possibly cleared) when the line's product/variety/length no longer
 *    matches what was originally linked.
 *  - `validationWarnings`/`validationErrors` are recomputed from the new
 *    values (section 18).
 * `rawText` and `extractedSnapshot` are never part of `data` below - this
 * function has no way to touch them even by accident.
 */
export async function updateOfferLine(lineId: string, formData: FormData): Promise<ActionResult> {
  const existing = await prisma.farmOfferLine.findUnique({
    where: { id: lineId },
    include: { farmOffer: { select: { farmId: true } } },
  });
  if (!existing) return { ok: false, message: "Deze offerregel bestaat niet meer. Ververs de pagina." };

  const productGroupRaw = emptyToNull(formData.get("productGroupRaw"));
  const varietyRaw = emptyToNull(formData.get("varietyRaw"));
  const colorRaw = emptyToNull(formData.get("colorRaw"));
  const gradeRaw = emptyToNull(formData.get("gradeRaw"));
  const treatmentRaw = emptyToNull(formData.get("treatmentRaw")) ?? "normal";
  const boxType = emptyToNull(formData.get("boxType"));
  const stemsPerBoxRaw = emptyToNull(formData.get("stemsPerBox"));
  const stemsPerBox = stemsPerBoxRaw !== null ? parseInt(stemsPerBoxRaw, 10) : null;
  const stemLengthCmRaw = emptyToNull(formData.get("stemLengthCm"));
  const stemLengthCm = stemLengthCmRaw !== null ? Number(stemLengthCmRaw) : null;
  const quantityRaw = emptyToNull(formData.get("quantity"));
  const unit = (emptyToNull(formData.get("unit")) as OfferUnit | null) ?? null;
  const fobPricePerStem = emptyToNull(formData.get("fobPricePerStem"));
  const currency = (emptyToNull(formData.get("currency")) as Currency | null) ?? Currency.USD;
  const weightPerBoxKg = emptyToNull(formData.get("weightPerBoxKg"));
  const notes = emptyToNull(formData.get("notes"));

  const quantityNumber = quantityRaw !== null ? Number(quantityRaw) : null;
  const totalStems = calculateTotalStems({ quantity: quantityNumber, unit: unit as OfferUnitLike | null, stemsPerBox });
  // boxesAvailable is legacy display-only compatibility (section 3): derive
  // it from quantity+unit=BOXES when possible, otherwise leave the existing
  // stored value untouched rather than blanking it out.
  const boxesAvailable = mapQuantityToBoxesAvailable(quantityNumber, unit as OfferUnitLike | null) ?? existing.boxesAvailable;

  const before = {
    productName: resolveImportedProductName({ productNameRaw: existing.productNameRaw, productGroupRaw: existing.productGroupRaw }),
    variety: existing.varietyRaw,
    stemLengthCm: existing.stemLengthCm,
  };
  const after = {
    productName: resolveImportedProductName({ productGroupRaw }),
    variety: varietyRaw,
    stemLengthCm,
  };

  let packagingWeightProfileId = existing.packagingWeightProfileId;
  let productVariantId = existing.productVariantId;
  let matchStatus = existing.matchStatus;

  if (haveMatchAffectingFieldsChanged(before, after)) {
    // Section 14: a match-affecting correction invalidates any existing link
    // (including a USER_LINKED one) - re-run the same deterministic engine
    // used at import time with the corrected values. Deliberately
    // `matchFarmOfferLine` directly, NEVER `applySupplierMappingsThenMatch`
    // (supplier-mapping step, section 22/32): a saved mapping is for FUTURE
    // imports, not for overruling a human's own correction within the
    // current offer - re-applying it here would make a bad mapping
    // impossible to escape from inside the same review session.
    if (existing.farmOffer.farmId) {
      const candidates = await loadFarmAssortmentCandidates(existing.farmOffer.farmId);
      const match = matchFarmOfferLine(
        { farmId: existing.farmOffer.farmId, productGroupRaw, varietyRaw, stemLengthCm },
        candidates,
      );
      packagingWeightProfileId = match.packagingWeightProfileId;
      productVariantId = match.productVariantId;
      matchStatus = match.status as LineMatchStatus;
    } else {
      packagingWeightProfileId = null;
      productVariantId = null;
      matchStatus = LineMatchStatus.UNMATCHED;
    }
  }

  const { validationWarnings, validationErrors } = computeLineValidationMessages(existing.extractedSnapshot, {
    packagingWeightProfileId,
    productGroupRaw,
    varietyRaw,
    fobPricePerStem,
    currency,
    unit: unit as OfferUnitLike | null,
    stemLengthCm,
    quantity: quantityRaw,
    totalStems,
    boxesAvailable,
  });

  try {
    await prisma.farmOfferLine.update({
      where: { id: lineId },
      data: {
        productGroupRaw,
        varietyRaw,
        colorRaw,
        gradeRaw,
        treatmentRaw,
        boxType,
        boxesAvailable,
        stemsPerBox,
        stemLengthCm,
        quantity: quantityRaw,
        unit,
        totalStems,
        fobPricePerStem,
        currency,
        weightPerBoxKg,
        notes,
        packagingWeightProfileId,
        productVariantId,
        matchStatus,
        validationWarnings: validationWarnings as never,
        validationErrors: validationErrors as never,
      },
    });
  } catch {
    return { ok: false, message: "Opslaan is mislukt door een databasefout. Probeer het opnieuw." };
  }

  revalidatePath(`/farm-offers/${existing.farmOfferId}/review`);
  return { ok: true, message: "Regel opgeslagen." };
}

export async function deleteOfferLine(offerId: string, lineId: string): Promise<ActionResult> {
  try {
    await prisma.farmOfferLine.delete({ where: { id: lineId } });
  } catch {
    return { ok: false, message: "Verwijderen is mislukt door een databasefout. Probeer het opnieuw." };
  }
  revalidatePath(`/farm-offers/${offerId}/review`);
  return { ok: true, message: "Regel verwijderd." };
}

/**
 * Server-side "choose this assortment article" flow (sections 7-9): used for
 * both "Choose match" (AMBIGUOUS) and "Change match" (any status). Never
 * trusts the client's own copy of a candidate - always re-reads the chosen
 * `PackagingWeightProfile` fresh from the database and re-validates supplier
 * consistency via `validatePackagingWeightProfileSelection` before linking
 * it, so a stale/tampered client selection (or a profile deleted moments
 * earlier) can never be accepted. A profile belonging to a different
 * supplier is rejected with a clear message, never silently linked.
 */
export async function selectPackagingProfile(lineId: string, packagingWeightProfileId: string): Promise<ActionResult> {
  const line = await prisma.farmOfferLine.findUnique({
    where: { id: lineId },
    include: { farmOffer: { select: { farmId: true } } },
  });
  if (!line) return { ok: false, message: "Deze offerregel bestaat niet meer. Ververs de pagina." };

  const profile = await prisma.packagingWeightProfile.findUnique({ where: { id: packagingWeightProfileId } });
  const validation = validatePackagingWeightProfileSelection({
    offerFarmId: line.farmOffer.farmId,
    packagingWeightProfile: profile,
  });
  if (!validation.ok) return { ok: false, message: validation.message };

  const { validationWarnings, validationErrors } = computeLineValidationMessages(line.extractedSnapshot, {
    packagingWeightProfileId: profile!.id,
    productGroupRaw: line.productGroupRaw,
    varietyRaw: line.varietyRaw,
    fobPricePerStem: line.fobPricePerStem?.toString() ?? null,
    currency: line.currency,
    unit: line.unit as OfferUnitLike | null,
    stemLengthCm: line.stemLengthCm,
    quantity: line.quantity?.toString() ?? null,
    totalStems: line.totalStems,
    boxesAvailable: line.boxesAvailable,
  });

  try {
    await prisma.farmOfferLine.update({
      where: { id: lineId },
      data: {
        packagingWeightProfileId: profile!.id,
        productVariantId: profile!.productVariantId,
        matchStatus: LineMatchStatus.USER_LINKED,
        validationWarnings: validationWarnings as never,
        validationErrors: validationErrors as never,
      },
    });
  } catch {
    return { ok: false, message: "Opslaan is mislukt door een databasefout. Probeer het opnieuw." };
  }

  revalidatePath(`/farm-offers/${line.farmOfferId}/review`);
  return { ok: true, message: "Assortimentartikel gekoppeld." };
}

/**
 * Creates a new supplier-specific assortment article directly from an
 * UNMATCHED offer line and immediately links it (sections 11-13). Supplier
 * is always the offer's own farm - never freely choosable in this flow (the
 * form never even offers another farm as an option). Reuses
 * `findOrCreatePackagingWeightProfile` (duplicate-safe: reuses an existing
 * Product/ProductVariant/PackagingWeightProfile by the same
 * casing/whitespace-insensitive rules the central Assortiment screens use)
 * rather than unconditionally creating new rows.
 */
export async function createAssortmentItemFromOfferLine(lineId: string, formData: FormData): Promise<ActionResult> {
  const line = await prisma.farmOfferLine.findUnique({
    where: { id: lineId },
    include: { farmOffer: { select: { farmId: true } } },
  });
  if (!line) return { ok: false, message: "Deze offerregel bestaat niet meer. Ververs de pagina." };
  if (!line.farmOffer.farmId) {
    return {
      ok: false,
      message: "Deze aanbieding heeft geen leverancier - er kan geen assortimentartikel worden aangemaakt.",
    };
  }

  const productName = emptyToNull(formData.get("productName"));
  const variety = emptyToNull(formData.get("variety"));
  const stemLength = emptyToNull(formData.get("stemLength"));
  const boxType = emptyToNull(formData.get("boxType"));
  const stemsPerBoxRaw = emptyToNull(formData.get("stemsPerBox"));
  const stemsPerBox = stemsPerBoxRaw !== null ? parseInt(stemsPerBoxRaw, 10) : null;
  const weightPerBoxKg = emptyToNull(formData.get("weightPerBoxKg"));

  if (!productName || !variety || !stemLength || !boxType || !stemsPerBox || stemsPerBox <= 0 || !weightPerBoxKg) {
    return {
      ok: false,
      message: "Product, variëteit, lengte, doostype, stelen per doos en doosgewicht zijn allemaal verplicht.",
    };
  }

  let created;
  try {
    created = await findOrCreatePackagingWeightProfile({
      farmId: line.farmOffer.farmId,
      productName,
      variety,
      stemLength,
      boxType,
      stemsPerBox,
      weightPerBoxKg,
    });
  } catch {
    return {
      ok: false,
      message: "Aanmaken van het assortimentartikel is mislukt door een databasefout. Probeer het opnieuw.",
    };
  }

  const { validationWarnings, validationErrors } = computeLineValidationMessages(line.extractedSnapshot, {
    packagingWeightProfileId: created.packagingWeightProfileId,
    productGroupRaw: line.productGroupRaw,
    varietyRaw: line.varietyRaw,
    fobPricePerStem: line.fobPricePerStem?.toString() ?? null,
    currency: line.currency,
    unit: line.unit as OfferUnitLike | null,
    stemLengthCm: line.stemLengthCm,
    quantity: line.quantity?.toString() ?? null,
    totalStems: line.totalStems,
    boxesAvailable: line.boxesAvailable,
  });

  try {
    await prisma.farmOfferLine.update({
      where: { id: lineId },
      data: {
        packagingWeightProfileId: created.packagingWeightProfileId,
        productVariantId: created.productVariantId,
        matchStatus: LineMatchStatus.USER_LINKED,
        validationWarnings: validationWarnings as never,
        validationErrors: validationErrors as never,
      },
    });
  } catch {
    return { ok: false, message: "Koppelen van het nieuwe assortimentartikel is mislukt. Probeer het opnieuw." };
  }

  revalidatePath(`/farm-offers/${line.farmOfferId}/review`);
  return { ok: true, message: "Nieuw assortimentartikel aangemaakt en gekoppeld." };
}

/**
 * Saves a controlled, per-supplier mapping (supplier-mapping step, section
 * 5): "when this farm writes exactly this raw text, they mean this
 * assortment article" - so a future import of the same supplier's list can
 * link it immediately, before the deterministic matcher even runs (section
 * 8). Never automatic - only ever runs from the review screen's explicit
 * "Save as supplier mapping" click. Re-reads everything itself (line, its
 * offer's farmId, its own current `packagingWeightProfileId`/`matchStatus`)
 * - a client-supplied farm/profile id is never trusted.
 */
export async function saveSupplierLineMapping(lineId: string): Promise<ActionResult> {
  const userId = await requireUserId();

  const line = await prisma.farmOfferLine.findUnique({
    where: { id: lineId },
    include: { farmOffer: { select: { farmId: true } }, packagingWeightProfile: { select: { farmId: true } } },
  });
  if (!line) return { ok: false, message: "Deze offerregel bestaat niet meer. Ververs de pagina." };

  const farmId = line.farmOffer.farmId;
  if (!farmId) {
    return { ok: false, message: "Deze aanbieding heeft geen leverancier - er kan geen mapping worden opgeslagen." };
  }
  // Never map from empty/whitespace-only or an internal, non-supplier-authored
  // placeholder rawText (a degraded AI line or a manually-added line) - a
  // mapping only makes sense keyed on text the supplier actually wrote.
  if (!isValidSupplierMappingSource(line.rawText)) {
    return { ok: false, message: "Deze regel heeft geen bruikbare originele brontekst - er kan geen mapping worden opgeslagen." };
  }
  // A ranged source row ("2hb Alert 40-60cm") was expanded across several
  // lengths - and therefore several packaging/weight profiles - during import.
  // The mapping key is one normalized source -> one profile, so saving this
  // row's mapping would silently bind the WHOLE range to a single length's
  // profile. Until the mapping model can represent one source -> many targets,
  // this is refused outright rather than saved incorrectly.
  if (hasLengthRange(line.rawText)) {
    return {
      ok: false,
      message:
        "Deze regel bevat een lengterange (bv. \"40-60cm\") en is over meerdere lengtes uitgesplitst. Zo'n regel kan (nog) niet als leverancier-mapping worden opgeslagen.",
    };
  }
  if (!line.packagingWeightProfileId || !line.packagingWeightProfile) {
    return { ok: false, message: "Deze regel heeft nog geen gekoppeld assortimentartikel." };
  }
  // Section 5: USER_LINKED always qualifies; AUTO_MATCHED/DERIVED also
  // qualify, but only because the user is explicitly clicking "save" right
  // now - this action is never called automatically.
  const CONFIRMED_STATUSES: LineMatchStatus[] = [
    LineMatchStatus.USER_LINKED,
    LineMatchStatus.AUTO_MATCHED,
    LineMatchStatus.DERIVED,
  ];
  if (!CONFIRMED_STATUSES.includes(line.matchStatus)) {
    return { ok: false, message: "Deze regel heeft nog geen bevestigde koppeling - kies eerst een assortimentartikel." };
  }
  if (!isPackagingProfileValidForSupplier(farmId, line.packagingWeightProfile.farmId)) {
    return { ok: false, message: "Dit assortimentartikel behoort tot een andere leverancier." };
  }

  const normalizedSource = normalizeSupplierMappingSource(line.rawText);

  const existing = await prisma.supplierLineMapping.findUnique({
    where: { farmId_normalizedSource: { farmId, normalizedSource } },
  });

  if (existing) {
    // Section 6, scenario A: identical target already mapped - idempotent, not an error.
    if (existing.packagingWeightProfileId === line.packagingWeightProfileId) {
      return { ok: true, message: "Mapping already exists." };
    }
    // Section 6, scenario B: never silently overwrite a different target.
    return {
      ok: false,
      message: "This supplier text is already mapped to another assortment item.",
    };
  }

  try {
    await prisma.supplierLineMapping.create({
      data: {
        farmId,
        normalizedSource,
        rawSource: line.rawText,
        packagingWeightProfileId: line.packagingWeightProfileId,
        createdById: userId,
      },
    });
  } catch {
    return { ok: false, message: "Opslaan van de mapping is mislukt door een databasefout. Probeer het opnieuw." };
  }

  revalidatePath(`/farm-offers/${line.farmOfferId}/review`);
  return { ok: true, message: "Supplier mapping saved" };
}

/**
 * Adds one hand-entered offer line and immediately runs it through the same
 * supplier-scoped matching engine used everywhere else (section 24 applies
 * to every newly-added line, not just bulk-pasted ones) - a manually typed
 * product/variety/length can get a real AUTO_MATCHED/DERIVED/AMBIGUOUS
 * result exactly like an AI-imported line would, instead of always starting
 * UNMATCHED regardless of what was typed.
 */
export async function addManualOfferLine(offerId: string, formData: FormData): Promise<void> {
  const offer = await prisma.farmOffer.findUniqueOrThrow({ where: { id: offerId }, select: { farmId: true } });

  const productGroupRaw = emptyToNull(formData.get("productGroupRaw"));
  const varietyRaw = emptyToNull(formData.get("varietyRaw"));
  const stemLengthCmRaw = emptyToNull(formData.get("stemLengthCm"));
  const stemLengthCm = stemLengthCmRaw !== null ? Number(stemLengthCmRaw) : null;

  // Deliberately NOT run through applySupplierMappingsThenMatch: this
  // line's rawText below is a fixed placeholder ("(handmatig ingevoerd)"),
  // never real supplier-authored text - every manually-added line for a
  // farm would share the exact same key, so a mapping lookup here could
  // only ever produce meaningless collisions, not a real "this supplier
  // wrote this" match. Deterministic product/variety/length matching still
  // applies normally.
  const match = offer.farmId
    ? matchFarmOfferLine(
        { farmId: offer.farmId, productGroupRaw, varietyRaw, stemLengthCm },
        await loadFarmAssortmentCandidates(offer.farmId),
      )
    : { status: "UNMATCHED" as const, packagingWeightProfileId: null, productVariantId: null, options: [] };

  await prisma.farmOfferLine.create({
    data: {
      farmOfferId: offerId,
      rawText: MANUAL_LINE_RAWTEXT_PLACEHOLDER,
      productGroupRaw,
      varietyRaw,
      colorRaw: emptyToNull(formData.get("colorRaw")),
      gradeRaw: emptyToNull(formData.get("gradeRaw")),
      treatmentRaw: emptyToNull(formData.get("treatmentRaw")) ?? "normal",
      boxType: emptyToNull(formData.get("boxType")) ?? "QB",
      stemLengthCm,
      boxesAvailable: emptyToNull(formData.get("boxesAvailable")) ? parseInt(String(formData.get("boxesAvailable")), 10) : null,
      stemsPerBox: emptyToNull(formData.get("stemsPerBox")) ? parseInt(String(formData.get("stemsPerBox")), 10) : null,
      fobPricePerStem: emptyToNull(formData.get("fobPricePerStem")),
      currency: (emptyToNull(formData.get("currency")) as Currency) ?? Currency.USD,
      weightPerBoxKg: emptyToNull(formData.get("weightPerBoxKg")),
      packagingWeightProfileId: match.packagingWeightProfileId,
      productVariantId: match.productVariantId ?? undefined,
      matchStatus: match.status as LineMatchStatus,
      confidence: ConfidenceLevel.HIGH, // manually entered by a human - trusted by definition
      needsReview: false,
    },
  });
  revalidatePath(`/farm-offers/${offerId}/review`);
}

/**
 * Bulk-adds offer lines from a pasted list - one row per line:
 * "Omschrijving<TAB>Stelen per doos<TAB>FOB-prijs per steel" optionally
 * followed by dozen beschikbaar, doostype, doosgewicht en valuta to override
 * the shared defaults. Used when OCR isn't configured for an image/PDF
 * upload (section: "Maak een fallback voor handmatige invoer wanneer parsing
 * mislukt") and pasting is much faster than one-line-at-a-time entry.
 *
 * UPDATED (review-screen rebuild, section 24): this no longer runs its own
 * global, unscoped `productVariant.findMany({ where: { variety } })` lookup -
 * that competed with the deterministic matching engine and could link a
 * variety that only existed for a DIFFERENT supplier. Every parsed row (the
 * description column is treated as the variety, since this paste format has
 * no separate product/length columns) is now matched through the exact same
 * `loadFarmAssortmentCandidates`/`applySupplierMappingsThenMatch` flow
 * `uploadFarmOffer` uses (an approved supplier mapping is checked first,
 * then the deterministic engine) - loaded once for the whole paste, never
 * once per row. A row can therefore come out USER_LINKED (via a saved
 * mapping), AUTO_MATCHED-equivalent (in practice DERIVED, since no product
 * name is given here), AMBIGUOUS, or UNMATCHED, but never an unscoped guess. The old "backfill doosgewicht from a box-type/stems-
 * specific profile" convenience is preserved unchanged (packaging never
 * drives the assortment LINK itself - section 7 - it only fills a display
 * value), now reading the productVariantId the engine resolved.
 */
export async function bulkAddOfferLines(offerId: string, formData: FormData): Promise<void> {
  const offer = await prisma.farmOffer.findUniqueOrThrow({ where: { id: offerId } });
  const defaultBoxType = (formData.get("boxType") as string) || "QB";
  const defaultCurrency = ((formData.get("currency") as string) || "USD") as Currency;
  const rowsRaw = String(formData.get("rows") ?? "");

  const rawLines = rowsRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  interface ParsedRow {
    description: string;
    stemsPerBox: number;
    fobPricePerStem: string;
    boxesAvailable: number | null;
    boxType: string;
    weightPerBoxKg: string | null;
    currency: Currency;
  }
  const parsedRows: ParsedRow[] = [];
  let invalid = 0;

  for (const line of rawLines) {
    const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    const description = cols[0] || null;
    const stemsPerBox = parseInt(cols[1] ?? "", 10);
    const fobPricePerStem = cols[2] || null;
    const boxesAvailable = cols[3] ? parseInt(cols[3], 10) : null;
    const boxType = cols[4] || defaultBoxType;
    const weightPerBoxKg = cols[5] || null;
    const currency = (cols[6] as Currency) || defaultCurrency;

    if (!description || !Number.isFinite(stemsPerBox) || stemsPerBox <= 0 || !fobPricePerStem) {
      invalid++;
      continue;
    }
    parsedRows.push({ description, stemsPerBox, fobPricePerStem, boxesAvailable, boxType, weightPerBoxKg, currency });
  }

  const candidates = offer.farmId ? await loadFarmAssortmentCandidates(offer.farmId) : [];
  const matchResults = offer.farmId
    ? await applySupplierMappingsThenMatch(
        offer.farmId,
        parsedRows.map((r) => ({ rawText: r.description, varietyRaw: r.description, productGroupRaw: null, stemLengthCm: null })),
        candidates,
      )
    : parsedRows.map(() => ({
        status: "UNMATCHED" as const,
        packagingWeightProfileId: null,
        productVariantId: null,
        options: [],
      }));

  let added = 0;
  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const match = matchResults[i];

    let weightPerBoxKg = row.weightPerBoxKg;
    if (!weightPerBoxKg && offer.farmId && match.productVariantId) {
      const profile = await prisma.packagingWeightProfile.findFirst({
        where: { farmId: offer.farmId, productVariantId: match.productVariantId, boxType: row.boxType, stemsPerBox: row.stemsPerBox },
        orderBy: { effectiveFrom: "desc" },
      });
      if (profile) weightPerBoxKg = profile.weightPerBoxKg.toString();
    }

    await prisma.farmOfferLine.create({
      data: {
        farmOfferId: offerId,
        rawText: row.description,
        varietyRaw: row.description,
        treatmentRaw: "normal",
        boxType: row.boxType,
        boxesAvailable: row.boxesAvailable,
        stemsPerBox: row.stemsPerBox,
        fobPricePerStem: row.fobPricePerStem,
        currency: row.currency,
        weightPerBoxKg,
        productVariantId: match.productVariantId ?? undefined,
        packagingWeightProfileId: match.packagingWeightProfileId,
        matchStatus: match.status as LineMatchStatus,
        confidence: ConfidenceLevel.HIGH, // pasted by a human from a real price list - trusted by definition
        needsReview: false,
      },
    });
    added++;
  }

  revalidatePath(`/farm-offers/${offerId}/review`);
  redirect(`/farm-offers/${offerId}/review?msg=bulk&added=${added}&invalid=${invalid}`);
}

/**
 * Hard-deletes a single leveranciersaanbieding. The offer's own lines cascade
 * on delete, but a line that is already used in a quote
 * (QuoteLine.farmOfferLineId is a required, Restrict-ed FK) must never be
 * removed - that would corrupt historical quotes - so the delete is blocked
 * with a clear message when any line is referenced. The upload's raw file bytes
 * (SourceUpload) are cleaned up in the same transaction when no other offer
 * still references them, so no orphan records are left behind.
 */
export async function deleteFarmOffer(id: string): Promise<ActionResult> {
  await requireUserId();
  const offer = await prisma.farmOffer.findUnique({
    where: { id },
    select: { title: true, sourceUploadId: true },
  });
  if (!offer) return { ok: false, message: "Deze leveranciersaanbieding bestaat niet meer. Ververs de pagina." };

  const usedInQuotes = await prisma.quoteLine.count({ where: { farmOfferLine: { farmOfferId: id } } });
  const blocked = blockedDeleteMessage("Deze leveranciersaanbieding", [
    { count: usedInQuotes, label: "offerteregel(s)" },
  ]);
  if (blocked) return { ok: false, message: blocked };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.farmOffer.delete({ where: { id } });
      if (offer.sourceUploadId) {
        const others = await tx.farmOffer.count({ where: { sourceUploadId: offer.sourceUploadId } });
        if (others === 0) await tx.sourceUpload.delete({ where: { id: offer.sourceUploadId } });
      }
    });
  } catch {
    return { ok: false, message: "Verwijderen is mislukt door een databasefout. Probeer het opnieuw." };
  }

  revalidatePath("/farm-offers");
  return { ok: true, message: `Aanbieding "${offer.title ?? "Naamloos"}" verwijderd.` };
}

/**
 * Bulk-deletes the selected leveranciersaanbiedingen. Offers whose lines are
 * still referenced by a quote are skipped (never partially deleted) and
 * reported; the rest are removed in one transaction, together with any now-
 * orphaned SourceUpload bytes.
 */
export async function bulkDeleteFarmOffers(ids: string[]): Promise<ActionResult> {
  await requireUserId();
  const norm = normalizeBulkIds(ids);
  if ("error" in norm) return { ok: false, message: norm.error };

  // Any offer with at least one quote-referenced line can't be deleted (the
  // cascade would hit that Restrict-ed line), so exclude the whole offer.
  const referenced = await prisma.quoteLine.findMany({
    where: { farmOfferLine: { farmOfferId: { in: norm.ids } } },
    select: { farmOfferLine: { select: { farmOfferId: true } } },
  });
  const blockedIds = new Set(referenced.map((r) => r.farmOfferLine.farmOfferId));
  const deletableIds = norm.ids.filter((id) => !blockedIds.has(id));

  if (deletableIds.length === 0) {
    return {
      ok: false,
      message: "Geen van de geselecteerde leveranciersaanbiedingen kon worden verwijderd: ze zijn nog gekoppeld aan offertes.",
    };
  }

  let deletedCount = 0;
  try {
    const uploads = await prisma.farmOffer.findMany({
      where: { id: { in: deletableIds }, sourceUploadId: { not: null } },
      select: { sourceUploadId: true },
    });
    const uploadIds = [...new Set(uploads.map((u) => u.sourceUploadId!).filter(Boolean))];

    await prisma.$transaction(async (tx) => {
      const res = await tx.farmOffer.deleteMany({ where: { id: { in: deletableIds } } });
      deletedCount = res.count;
      for (const uploadId of uploadIds) {
        const others = await tx.farmOffer.count({ where: { sourceUploadId: uploadId } });
        if (others === 0) await tx.sourceUpload.delete({ where: { id: uploadId } });
      }
    });
  } catch {
    return { ok: false, message: "Verwijderen is mislukt door een databasefout. Probeer het opnieuw." };
  }

  revalidatePath("/farm-offers");
  const skipped = norm.ids.length - deletableIds.length;
  const message =
    skipped > 0
      ? `${deletedCount} leveranciersaanbieding(en) verwijderd. ${skipped} overgeslagen omdat deze nog gekoppeld zijn aan offertes.`
      : `${deletedCount} leveranciersaanbieding(en) verwijderd.`;
  return { ok: true, message };
}

/**
 * Finalization (section 15/17), replacing the old, unconditional
 * `markOfferReviewed`: server-side validates EVERY line via
 * `validateOfferLineForFinalization` and refuses to confirm while any line
 * still has a blocking error (missing assortment link, product, variety,
 * price, currency or unit) - never trusts the client's own read of whether
 * the offer looks ready. Uses the same `FarmOfferStatus.REVIEWED` status as
 * before (section 17: no new enum needed).
 */
export async function confirmFarmOffer(offerId: string): Promise<ActionResult> {
  await requireUserId();
  const offer = await prisma.farmOffer.findUnique({ where: { id: offerId }, include: { lines: true } });
  if (!offer) return { ok: false, message: "Deze leveranciersaanbieding bestaat niet meer. Ververs de pagina." };
  if (offer.lines.length === 0) {
    return { ok: false, message: "Deze aanbieding heeft nog geen regels. Voeg eerst regels toe." };
  }

  const linesWithErrors = offer.lines.filter(
    (line) =>
      validateOfferLineForFinalization({
        packagingWeightProfileId: line.packagingWeightProfileId,
        productGroupRaw: line.productGroupRaw,
        varietyRaw: line.varietyRaw,
        fobPricePerStem: line.fobPricePerStem?.toString() ?? null,
        currency: line.currency,
        unit: line.unit as OfferUnitLike | null,
        stemLengthCm: line.stemLengthCm,
        quantity: line.quantity?.toString() ?? null,
        totalStems: line.totalStems,
      }).errors.length > 0,
  ).length;

  if (linesWithErrors > 0) {
    return {
      ok: false,
      message: `Kan niet bevestigen: ${linesWithErrors} regel(s) hebben nog blokkerende fouten die eerst opgelost moeten worden.`,
    };
  }

  await prisma.farmOffer.update({ where: { id: offerId }, data: { status: FarmOfferStatus.REVIEWED } });
  revalidatePath(`/farm-offers/${offerId}/review`);
  revalidatePath(`/farm-offers/${offerId}`);
  revalidatePath("/farm-offers");
  return { ok: true, message: "Aanbieding bevestigd als gecontroleerd." };
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
