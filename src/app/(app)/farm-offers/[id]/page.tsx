import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";
import { variantLabel } from "@/lib/variantLabel";
import { normalizeSupplierMappingSource } from "@/lib/supplierMapping/normalize";
import { resolveLineStatusLabel } from "@/lib/farmOfferLineStatus";
import { isFarmOfferLineQuotable } from "@/lib/quotes/lineGating";
import { FarmOfferLinesTable, type FarmOfferDetailLineViewModel } from "./FarmOfferLinesTable";

export const dynamic = "force-dynamic";

export default async function FarmOfferDetailPage({ params }: { params: { id: string } }) {
  const offer = await prisma.farmOffer.findUnique({
    where: { id: params.id },
    include: {
      farm: true,
      sourceUpload: true,
      createdBy: true,
      lines: { include: { productVariant: { include: { product: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!offer) notFound();

  // Section 1: distinguishing "Supplier mapping" from a plain "Manually
  // matched" USER_LINKED line needs to know whether a saved
  // SupplierLineMapping for this supplier currently targets the SAME
  // profile this line links to - one batched query for the whole offer
  // (never once per line), never a new DB column (farmOfferLineStatus.ts).
  const mappings = offer.farmId
    ? await prisma.supplierLineMapping.findMany({
        where: { farmId: offer.farmId },
        select: { normalizedSource: true, packagingWeightProfileId: true },
      })
    : [];
  const mappingKeys = new Set(mappings.map((m) => `${m.normalizedSource}::${m.packagingWeightProfileId}`));

  const lines: FarmOfferDetailLineViewModel[] = offer.lines.map((line) => {
    const hasSupplierMapping =
      line.matchStatus === "USER_LINKED" &&
      !!line.packagingWeightProfileId &&
      mappingKeys.has(`${normalizeSupplierMappingSource(line.rawText)}::${line.packagingWeightProfileId}`);

    const statusLabel = resolveLineStatusLabel({
      offerStatus: offer.status,
      matchStatus: line.matchStatus,
      hasSupplierMapping,
    });

    const quotable = isFarmOfferLineQuotable({
      offerStatus: offer.status,
      matchStatus: line.matchStatus,
      packagingWeightProfileId: line.packagingWeightProfileId,
    }).ok;

    return {
      id: line.id,
      productLabel: line.productVariant
        ? variantLabel(line.productVariant, line.productVariant.product.name)
        : (line.productGroupRaw ?? line.rawText.slice(0, 40)),
      isUnmatched: !line.productVariant,
      treatment: line.treatmentRaw,
      boxType: line.boxType,
      boxesAvailable: line.boxesAvailable,
      stemsPerBox: line.stemsPerBox,
      fobPricePerStem: line.fobPricePerStem ? fmtMoney(line.fobPricePerStem, 4) : null,
      currency: line.currency,
      weightPerBoxKg: line.weightPerBoxKg ? fmtMoney(line.weightPerBoxKg, 3) : null,
      statusLabel,
      originalConfidence: line.confidence,
      quotable,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{offer.title ?? "Naamloze aanbieding"}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {offer.farm?.name ?? "Geen leverancier gekoppeld"} · Status: {offer.status} · Aangemaakt {fmtDate(offer.createdAt)} door{" "}
            {offer.createdBy.name}
          </p>
        </div>
        <div className="flex gap-2">
          {offer.status === "DRAFT" && (
            <Link href={`/farm-offers/${offer.id}/review`} className="btn-secondary">
              Verder controleren
            </Link>
          )}
        </div>
      </div>

      <FarmOfferLinesTable lines={lines} />

      {offer.sourceUpload && (
        <div className="card p-4 text-xs text-gray-500">
          Bronbestand: {offer.sourceUpload.originalName} ({offer.sourceUpload.fileType})
        </div>
      )}
    </div>
  );
}
