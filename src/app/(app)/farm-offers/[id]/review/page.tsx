import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { loadFarmAssortmentCandidates } from "@/lib/import/matching/assortmentRepository";
import { normalizeSupplierMappingSource } from "@/lib/supplierMapping/normalize";
import { buildOfferLineViewModel, toAssortmentOption } from "./buildOfferLineViewModel";
import { ReviewOfferClient } from "./ReviewOfferClient";

export const dynamic = "force-dynamic";

export default async function ReviewFarmOfferPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { fatal?: string; msg?: string; added?: string; invalid?: string };
}) {
  // One query for the offer + its lines (section 20: no N+1) - the farm's
  // full assortment is then loaded exactly once more below, never once per
  // line and never once per match-option.
  const offer = await prisma.farmOffer.findUnique({
    where: { id: params.id },
    include: { farm: true, lines: { orderBy: { createdAt: "asc" } } },
  });
  if (!offer) notFound();

  const candidates = offer.farmId ? await loadFarmAssortmentCandidates(offer.farmId) : [];
  const allOptions = candidates.map(toAssortmentOption);

  // Section 23: batch-load (never per line) which SupplierLineMapping, if
  // any, currently applies to each line's own rawText - purely to decide the
  // "Matched via supplier mapping" display hint below; never written back.
  const normalizedSourceByLineId = new Map(
    offer.lines.map((line) => [line.id, line.rawText ? normalizeSupplierMappingSource(line.rawText) : null]),
  );
  const uniqueSources = [...new Set([...normalizedSourceByLineId.values()].filter((s): s is string => s !== null))];
  const mappings =
    offer.farmId && uniqueSources.length > 0
      ? await prisma.supplierLineMapping.findMany({
          where: { farmId: offer.farmId, normalizedSource: { in: uniqueSources } },
          select: { normalizedSource: true, packagingWeightProfileId: true },
        })
      : [];
  const mappedProfileIdBySource = new Map(mappings.map((m) => [m.normalizedSource, m.packagingWeightProfileId]));

  const lines = offer.lines.map((line) => {
    const normalizedSource = normalizedSourceByLineId.get(line.id) ?? null;
    const mappedProfileId = normalizedSource ? (mappedProfileIdBySource.get(normalizedSource) ?? null) : null;
    return buildOfferLineViewModel(line, offer.farmId, candidates, mappedProfileId);
  });

  return (
    <ReviewOfferClient
      offerId={offer.id}
      offerTitle={offer.title}
      farmId={offer.farmId}
      farmName={offer.farm?.name ?? null}
      offerStatus={offer.status}
      lines={lines}
      allAssortmentOptions={allOptions}
      fatalMessage={searchParams.fatal ?? null}
      bulkMessage={
        searchParams.msg === "bulk"
          ? { added: Number(searchParams.added ?? 0), invalid: Number(searchParams.invalid ?? 0) }
          : null
      }
    />
  );
}
