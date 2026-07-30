import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { FarmOfferSource, FarmOfferStatus } from "@prisma/client";
import { ManualOfferBuilder } from "./ManualOfferBuilder";

export const dynamic = "force-dynamic";

/**
 * Steps 2-4 of "Handmatige aanbieding maken": pick assortment articles for
 * this offer's supplier, enter quantity/price per article, review and save.
 * Only ever applies to a still-DRAFT MANUAL offer - once it's been reviewed/
 * confirmed (or was never manual to begin with), further editing happens
 * through the existing `/farm-offers/[id]/review` screen instead (see
 * "EDITING MANUAL OFFERS": prefer the existing editor over a second one).
 */
export default async function ManualOfferBuilderPage({ params }: { params: { id: string } }) {
  const offer = await prisma.farmOffer.findUnique({
    where: { id: params.id },
    include: { farm: true },
  });
  if (!offer) notFound();
  if (offer.source !== FarmOfferSource.MANUAL) redirect(`/farm-offers/${offer.id}/review`);
  if (offer.status !== FarmOfferStatus.DRAFT) redirect(`/farm-offers/${offer.id}/review`);
  if (!offer.farm) redirect("/farm-offers/manual");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Handmatige aanbieding - {offer.farm.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          Zoek en selecteer assortimentartikelen van deze leverancier, vul per artikel de hoeveelheid en prijs in, en
          sla de aanbieding op.
        </p>
      </div>
      <ManualOfferBuilder
        offerId={offer.id}
        farmId={offer.farm.id}
        farmName={offer.farm.name}
        farmDefaultCurrency={offer.farm.defaultCurrency}
      />
    </div>
  );
}
