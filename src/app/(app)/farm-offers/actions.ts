"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { detectFileType, runImport } from "@/lib/import";
import { ConfidenceLevel, Currency, FarmOfferStatus, SourceFileType } from "@prisma/client";

const UPLOAD_DIR = path.join(process.cwd(), "storage", "uploads");
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

  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const storedName = `${randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const storagePath = path.join("storage", "uploads", storedName);
  await fs.writeFile(path.join(process.cwd(), storagePath), buffer);

  const result = await runImport(fileType, buffer);

  const sourceUpload = await prisma.sourceUpload.create({
    data: {
      fileType: fileType as SourceFileType,
      originalName: file.name,
      storagePath,
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
          active: true,
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
        active: true,
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

export async function markOfferReviewed(offerId: string): Promise<void> {
  await prisma.farmOffer.update({ where: { id: offerId }, data: { status: FarmOfferStatus.REVIEWED } });
  redirect(`/farm-offers/${offerId}`);
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
