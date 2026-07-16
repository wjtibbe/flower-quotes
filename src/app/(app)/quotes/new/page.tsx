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

  const [lines, customers, destinations, activeRates] = await Promise.all([
    prisma.farmOfferLine.findMany({
      where: { id: { in: lineIds } },
      include: { productVariant: { include: { product: true } }, farmOffer: { include: { farm: true } } },
    }),
    prisma.customer.findMany({ where: { active: true }, include: { destination: true }, orderBy: { companyName: "asc" } }),
    prisma.destination.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
    prisma.exchangeRate.findMany({ where: { active: true }, orderBy: { effectiveFrom: "desc" } }),
  ]);

  // The source currencies present in the selected lines, used to decide per
  // customer whether a conversion (and thus an exchange rate) applies.
  const lineCurrencies = [...new Set(lines.map((l) => l.currency))];

  /** "1 from = X to" using an active rate in either stored direction, or null. */
  function currentRateFor(from: string, to: string): string | null {
    if (from === to) return null;
    const match = activeRates.find(
      (r) =>
        (r.baseCurrency === from && r.quoteCurrency === to) || (r.baseCurrency === to && r.quoteCurrency === from),
    );
    if (!match) return null;
    const v = Number(match.rate.toString());
    if (match.baseCurrency === from) return v.toString();
    return v !== 0 ? (1 / v).toFixed(6) : v.toString();
  }

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
              <th>Wisselkoers</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => {
              // Source currency(ies) among the selected lines that differ from
              // this customer's target currency; if any, a rate applies.
              const foreignSource = lineCurrencies.find((cur) => cur !== c.defaultCurrency);
              const currentRate = foreignSource ? currentRateFor(foreignSource, c.defaultCurrency) : null;
              return (
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
                <td>
                  {!foreignSource ? (
                    <span className="text-xs text-gray-400">n.v.t.</span>
                  ) : (
                    <details>
                      <summary className="text-xs text-brand-600 cursor-pointer">
                        {currentRate ? `1 ${foreignSource} = ${currentRate} ${c.defaultCurrency}` : "geen koers"}
                      </summary>
                      <div className="mt-1 bg-gray-50 p-2 rounded space-y-1 min-w-56">
                        <label className="label">Koers overschrijven (1 {foreignSource} = ? {c.defaultCurrency})</label>
                        <input
                          name={`exchangeRate_${c.id}`}
                          type="number"
                          step="0.000001"
                          min="0"
                          placeholder={currentRate ?? "bv. 0.92"}
                          className="input py-1 text-xs w-full"
                        />
                        <label className="label">Reden (optioneel)</label>
                        <input name={`exchangeRateReason_${c.id}`} className="input py-1 text-xs w-full" />
                        <p className="text-[11px] text-gray-400">
                          Leeg laten = huidige standaardkoers gebruiken. Een overschrijving geldt alleen voor deze
                          offerte.
                        </p>
                      </div>
                    </details>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>

        <button type="submit" className="btn-primary" disabled={lines.length === 0}>
          Bereken en genereer offerte(s)
        </button>
      </form>
    </div>
  );
}
