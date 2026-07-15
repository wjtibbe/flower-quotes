import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { variantLabel } from "@/lib/variantLabel";
import { createQuotes } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: { lineIds?: string | string[] };
}) {
  const lineIds = (
    Array.isArray(searchParams.lineIds) ? searchParams.lineIds : searchParams.lineIds ? [searchParams.lineIds] : []
  ).filter(Boolean);

  const [lines, customers, destinations] = await Promise.all([
    prisma.farmOfferLine.findMany({
      where: { id: { in: lineIds } },
      include: { productVariant: { include: { product: true } }, farmOffer: { include: { farm: true } } },
    }),
    prisma.customer.findMany({ where: { active: true }, include: { destination: true }, orderBy: { companyName: "asc" } }),
    prisma.destination.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Nieuwe offerte</h1>
        <p className="text-sm text-gray-500 mt-1">
          Kies één of meerdere klanten. Per klant wordt een aparte offerte gemaakt met de bestemming, route, valuta,
          incoterm en marge zoals hieronder ingesteld (standaard overgenomen van het klantprofiel, hier per offerte
          aan te passen - de gekozen bestemming bepaalt welke route en tarieven worden gebruikt).
        </p>
      </div>

      {lines.length === 0 ? (
        <div className="card p-6 text-amber-700 bg-amber-50">
          Geen productregels geselecteerd. Ga naar een farm-aanbieding en selecteer eerst regels.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Product</th>
                <th>Leverancier</th>
                <th>Box</th>
                <th>FOB</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    {line.productVariant
                      ? variantLabel(line.productVariant, line.productVariant.product.name)
                      : line.productGroupRaw ?? line.rawText.slice(0, 40)}
                  </td>
                  <td>{line.farmOffer.farm?.name ?? "-"}</td>
                  <td>
                    {line.boxType} · {line.stemsPerBox ?? "?"} stelen
                  </td>
                  <td>{line.fobPricePerStem ? `${line.currency} ${fmtMoney(line.fobPricePerStem, 4)}` : "ontbreekt"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={createQuotes} className="card p-6 space-y-4">
        {lineIds.map((id) => (
          <input key={id} type="hidden" name="lineIds" value={id} />
        ))}

        <table className="table-base">
          <thead>
            <tr>
              <th></th>
              <th>Klant</th>
              <th>Bestemming</th>
              <th>Incoterm</th>
              <th>Valuta</th>
              <th>Marge (%)</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <input type="checkbox" name="customerIds" value={c.id} />
                </td>
                <td className="font-medium">{c.companyName}</td>
                <td>
                  <select name={`destination_${c.id}`} className="input py-1" defaultValue={c.destinationId ?? ""}>
                    {!c.destinationId && (
                      <option value="" disabled>
                        Geen standaardbestemming - kies er een
                      </option>
                    )}
                    {destinations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.city}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select name={`incoterm_${c.id}`} className="input py-1" defaultValue={c.defaultIncoterm}>
                    <option value="FOB">FOB</option>
                    <option value="CFR">C&F</option>
                    <option value="DDP">DDP</option>
                  </select>
                </td>
                <td>
                  <select name={`currency_${c.id}`} className="input py-1" defaultValue={c.defaultCurrency}>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </td>
                <td>
                  <input
                    name={`margin_${c.id}`}
                    type="number"
                    step="0.001"
                    className="input py-1 w-24"
                    defaultValue={c.defaultMarginPercent.toString()}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button type="submit" className="btn-primary" disabled={lines.length === 0}>
          Bereken en genereer offerte(s)
        </button>
      </form>
    </div>
  );
}
