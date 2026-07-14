import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";
import { variantLabel } from "@/lib/variantLabel";

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

      <form action="/quotes/new" method="GET" className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th></th>
              <th>Product</th>
              <th>Box</th>
              <th>Beschikbaar</th>
              <th>Stelen/doos</th>
              <th>FOB</th>
              <th>Gewicht/doos</th>
              <th>Betrouwbaarheid</th>
            </tr>
          </thead>
          <tbody>
            {offer.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <input type="checkbox" name="lineIds" value={line.id} />
                </td>
                <td>
                  {line.productVariant ? (
                    <>{variantLabel(line.productVariant, line.productVariant.product.name)}</>
                  ) : (
                    <span className="text-amber-600">
                      {line.productGroupRaw ?? line.rawText.slice(0, 40)} (niet gekoppeld)
                    </span>
                  )}
                  {line.treatmentRaw && line.treatmentRaw !== "normal" && (
                    <span className="ml-1 text-xs text-gray-400">({line.treatmentRaw})</span>
                  )}
                </td>
                <td>{line.boxType ?? "-"}</td>
                <td>{line.boxesAvailable ?? "-"}</td>
                <td>{line.stemsPerBox ?? "-"}</td>
                <td>
                  {line.fobPricePerStem ? `${line.currency} ${fmtMoney(line.fobPricePerStem, 4)}` : (
                    <span className="text-red-500">ontbreekt</span>
                  )}
                </td>
                <td>{line.weightPerBoxKg ? `${fmtMoney(line.weightPerBoxKg, 3)} kg` : <span className="text-red-500">ontbreekt</span>}</td>
                <td>
                  <span
                    className={
                      line.confidence === "HIGH" ? "badge-high" : line.confidence === "MEDIUM" ? "badge-medium" : "badge-low"
                    }
                  >
                    {line.confidence}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-4 border-t border-gray-100">
          <button type="submit" className="btn-primary">
            Offerte maken van geselecteerde regels
          </button>
        </div>
      </form>

      {offer.sourceUpload && (
        <div className="card p-4 text-xs text-gray-500">
          Bronbestand: {offer.sourceUpload.originalName} ({offer.sourceUpload.fileType})
        </div>
      )}
    </div>
  );
}
