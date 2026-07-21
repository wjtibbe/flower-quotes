"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { detectFileType, runImport } from "@/lib/import";
import { ConfidenceLevel, Currency, FarmOfferStatus, SourceFileType } from "@prisma/client";
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

export async function uploadFarmOffer(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const file = formData.get("file") as File | null;
  const farmId = (formData.get("farmId") as string) || null;
  const title = (formData.get("title") as string) || null;

  if (!file || file.size === 0) throw new Error("Kies eerst een bestand om te uploaden");

  const fileType = detectFileType(file.name, file.type);
  const buffer = Buffer.from(await file.arrayBuffer());

  // File bytes are stored in the database (fileData), not on local disk -
  // serverless hosting (Vercel) has no writable/durable filesystem outside a
  // request's own /tmp. storagePath is kept as a descriptive label only.
  const storedName = `${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storagePath = path.join("storage", "uploads", storedName);

  const result = await runImport(fileType, buffer);

  const sourceUpload = await prisma.sourceUpload.create({
    data: {
      fileType: fileType as SourceFileType,
      originalName: file.name,
      storagePath,
      fileData: buffer,
      rawText: result.rawText || null,
      uploadedById: userId,
    },
  });

  const farmOffer = await prisma.farmOffer.create({
    data: {
      farmId,
      sourceUploadId: sourceUpload.id,
      title: title || file.name,
      status: FarmOfferStatus.DRAFT,
      createdById: userId,
      lines: {
        create: result.lines.map((line) => ({
          rawText: line.rawText,
          productGroupRaw: line.productGroupRaw,
          varietyRaw: line.varietyRaw,
          colorRaw: line.colorRaw,
          gradeRaw: line.gradeRaw,
          treatmentRaw: line.treatmentRaw,
          boxType: line.boxType,
          boxesAvailable: line.boxesAvailable,
          stemsPerBox: line.stemsPerBox,
          fobPricePerStem: line.fobPricePerStem,
          currency: (line.currency as Currency) ?? Currency.USD,
          extraLeadTimeHrs: line.extraLeadTimeHrs,
          confidence: CONFIDENCE_MAP[line.confidence] ?? ConfidenceLevel.LOW,
          fieldConfidence: line.fieldConfidence as never,
          needsReview: line.needsReview,
          notes: line.parserWarnings.join("; ") || null,
        })),
      },
    },
  });

  if (result.fatalError) {
    // Still create the (empty) offer so the upload + source text isn't lost,
    // but send the user straight to manual entry.
    redirect(`/farm-offers/${farmOffer.id}/review?fatal=${encodeURIComponent(result.fatalError)}`);
  }

  redirect(`/farm-offers/${farmOffer.id}/review`);
}

export async function updateOfferLine(lineId: string, formData: FormData): Promise<void> {
  const data = {
    farmNameRaw: (formData.get("farmNameRaw") as string) || null,
    countryOfOrigin: (formData.get("countryOfOrigin") as string) || null,
    productGroupRaw: (formData.get("productGroupRaw") as string) || null,
    varietyRaw: (formData.get("varietyRaw") as string) || null,
    colorRaw: (formData.get("colorRaw") as string) || null,
    gradeRaw: (formData.get("gradeRaw") as string) || null,
    treatmentRaw: (formData.get("treatmentRaw") as string) || null,
    boxType: (formData.get("boxType") as string) || null,
    boxesAvailable: emptyToNull(formData.get("boxesAvailable")),
    stemsPerBox: emptyToNull(formData.get("stemsPerBox")),
    fobPricePerStem: (formData.get("fobPricePerStem") as string) || null,
    currency: (formData.get("currency") as Currency) || Currency.USD,
    weightPerBoxKg: (formData.get("weightPerBoxKg") as string) || null,
    notes: (formData.get("notes") as string) || null,
    productVariantId: (formData.get("productVariantId") as string) || null,
    needsReview: formData.get("stillNeedsReview") === "on",
  };

  const stemsPerBox = data.stemsPerBox !== null ? parseInt(String(data.stemsPerBox), 10) : null;

  // Section 6: when a line gets linked to a central product, try to find a
  // matching weight profile (farm + variant + box type + stems per box)
  // before asking the user to enter it manually.
  let weightPerBoxKg = data.weightPerBoxKg;
  if (!weightPerBoxKg && data.productVariantId && data.boxType && stemsPerBox) {
    const existing = await prisma.farmOfferLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { farmOfferId: true, farmOffer: { select: { farmId: true } } },
    });
    if (existing.farmOffer.farmId) {
      const profile = await prisma.packagingWeightProfile.findFirst({
        where: {
          farmId: existing.farmOffer.farmId,
          productVariantId: data.productVariantId,
          boxType: data.boxType,
          stemsPerBox,
        },
        orderBy: { effectiveFrom: "desc" },
      });
      if (profile) weightPerBoxKg = profile.weightPerBoxKg.toString();
    }
  }

  await prisma.farmOfferLine.update({
    where: { id: lineId },
    data: {
      ...data,
      weightPerBoxKg,
      boxesAvailable: data.boxesAvailable !== null ? parseInt(String(data.boxesAvailable), 10) : null,
      stemsPerBox,
    },
  });

  const line = await prisma.farmOfferLine.findUniqueOrThrow({
    where: { id: lineId },
    include: { farmOffer: { select: { farmId: true } } },
  });

  // Optionally persist a manually entered weight as a new/updated profile
  // for next time (section 6: "de gebruiker moet het ingevoerde gewicht
  // daarna optioneel als nieuw gewichtsprofiel kunnen opslaan").
  if (
    formData.get("saveAsWeightProfile") === "on" &&
    data.weightPerBoxKg &&
    line.farmOffer.farmId &&
    line.productVariantId &&
    line.boxType &&
    line.stemsPerBox
  ) {
    const existingProfile = await prisma.packagingWeightProfile.findFirst({
      where: {
        farmId: line.farmOffer.farmId,
        productVariantId: line.productVariantId,
        boxType: line.boxType,
        stemsPerBox: line.stemsPerBox,
      },
    });
    if (existingProfile) {
      await prisma.packagingWeightProfile.update({
        where: { id: existingProfile.id },
        data: { weightPerBoxKg: data.weightPerBoxKg },
      });
    } else {
      await prisma.packagingWeightProfile.create({
        data: {
          farmId: line.farmOffer.farmId,
          productVariantId: line.productVariantId,
          boxType: line.boxType,
          stemsPerBox: line.stemsPerBox,
          weightPerBoxKg: data.weightPerBoxKg,
          notes: "Aangemaakt vanuit importcontrole",
        },
      });
    }
  }

  revalidatePath(`/farm-offers/${line.farmOfferId}/review`);
}

export async function deleteOfferLine(offerId: string, lineId: string): Promise<void> {
  await prisma.farmOfferLine.delete({ where: { id: lineId } });
  revalidatePath(`/farm-offers/${offerId}/review`);
}

export async function addManualOfferLine(offerId: string, formData: FormData): Promise<void> {
  await prisma.farmOfferLine.create({
    data: {
      farmOfferId: offerId,
      rawText: "(handmatig ingevoerd)",
      productGroupRaw: (formData.get("productGroupRaw") as string) || null,
      varietyRaw: (formData.get("varietyRaw") as string) || null,
      colorRaw: (formData.get("colorRaw") as string) || null,
      gradeRaw: (formData.get("gradeRaw") as string) || null,
      treatmentRaw: (formData.get("treatmentRaw") as string) || "normal",
      boxType: (formData.get("boxType") as string) || "QB",
      boxesAvailable: emptyToNull(formData.get("boxesAvailable")) ? parseInt(String(formData.get("boxesAvailable")), 10) : null,
      stemsPerBox: emptyToNull(formData.get("stemsPerBox")) ? parseInt(String(formData.get("stemsPerBox")), 10) : null,
      fobPricePerStem: (formData.get("fobPricePerStem") as string) || null,
      currency: (formData.get("currency") as Currency) || Currency.USD,
      weightPerBoxKg: (formData.get("weightPerBoxKg") as string) || null,
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
 * Each line is auto-linked to an existing central Assortiment variant when
 * its description matches exactly one ProductVariant.variety - the same text
 * used when setting up this supplier's assortment - so a price list that
 * mirrors an already-entered assortment (e.g. via the bulk-import on
 * Assortiment) links up automatically instead of needing manual matching per
 * line. The matching weight profile (leverancier + variant + doostype +
 * stelen/doos) is used to fill the doosgewicht when not overridden.
 */
export async function bulkAddOfferLines(offerId: string, formData: FormData): Promise<void> {
  const offer = await prisma.farmOffer.findUniqueOrThrow({ where: { id: offerId } });
  const defaultBoxType = (formData.get("boxType") as string) || "QB";
  const defaultCurrency = ((formData.get("currency") as string) || "USD") as Currency;
  const rowsRaw = String(formData.get("rows") ?? "");

  const lines = rowsRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let added = 0;
  let invalid = 0;

  for (const line of lines) {
    const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    const description = cols[0] || null;
    const stemsPerBox = parseInt(cols[1] ?? "", 10);
    const fobPricePerStem = cols[2] || null;
    const boxesAvailable = cols[3] ? parseInt(cols[3], 10) : null;
    const boxType = cols[4] || defaultBoxType;
    let weightPerBoxKg = cols[5] || null;
    const currency = (cols[6] as Currency) || defaultCurrency;

    if (!description || !Number.isFinite(stemsPerBox) || stemsPerBox <= 0 || !fobPricePerStem) {
      invalid++;
      continue;
    }

    let productVariantId: string | null = null;
    const matches = await prisma.productVariant.findMany({
      where: { variety: { equals: description, mode: "insensitive" } },
    });
    if (matches.length === 1) {
      productVariantId = matches[0].id;
      if (!weightPerBoxKg && offer.farmId) {
        const profile = await prisma.packagingWeightProfile.findFirst({
          where: { farmId: offer.farmId, productVariantId, boxType, stemsPerBox },
          orderBy: { effectiveFrom: "desc" },
        });
        if (profile) weightPerBoxKg = profile.weightPerBoxKg.toString();
      }
    }

    await prisma.farmOfferLine.create({
      data: {
        farmOfferId: offerId,
        rawText: description,
        varietyRaw: description,
        treatmentRaw: "normal",
        boxType,
        boxesAvailable,
        stemsPerBox,
        fobPricePerStem,
        currency,
        weightPerBoxKg,
        productVariantId,
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

export async function markOfferReviewed(offerId: string): Promise<void> {
  await prisma.farmOffer.update({ where: { id: offerId }, data: { status: FarmOfferStatus.REVIEWED } });
  redirect(`/farm-offers/${offerId}`);
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
