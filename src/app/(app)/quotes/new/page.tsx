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

  // All priced lines are candidates, so one offerte can combine regels from
  // multiple leveranciers. The lineIds from the URL arrive pre-checked; the
  // user can add or remove lines (across suppliers) before calculating.
  const [candidateLines, customers, destinations, activeRates] = await Promise.all([
    prisma.farmOfferLine.findMany({
      where: { OR: [{ fobPricePerStem: { not: null } }, { id: { in: lineIds } }] },
      include: { productVariant: { include: { product: true } }, farmOffer: { include: { farm: true } } },
    }),
    prisma.customer.findMany({ include: { destination: true }, orderBy: { companyName: "asc" } }),
    prisma.destination.findMany({ orderBy: { city: "asc" } }),
    prisma.exchangeRate.findMany({ orderBy: { effectiveFrom: "desc" } }),
  ]);

  const selectedSet = new Set(lineIds);
  const lines = [...candidateLines].sort((a, b) => {
    const bySelected = Number(selectedSet.has(b.id)) - Number(selectedSet.has(a.id));
    if (bySelected !== 0) return bySelected;
    const byFarm = (a.farmOffer.farm?.name ?? "").localeCompare(b.farmOffer.farm?.name ?? "");
    if (byFarm !== 0) return byFarm;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  const supplierCount = new Set(lines.filter((l) => selectedSet.has(l.id)).map((l) => l.farmOffer.farmId)).size;

  // The source currencies present in the candidate lines, used to decide per
  // customer whether a conversion (and thus an exchange rate) applies.
  const lineCurrencies = [...new Set(lines.map((l) => l.currency))];

  /** "1 from = X to" using a rate in either stored direction, or null. */
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

      <form action={createQuotes} className="space-y-6">
        <div className="card overflow-x-auto">
          <div className="px-4 pt-4">
            <h2 className="font-semibold text-gray-800">Productregels</h2>
            <p className="text-xs text-gray-500 mt-0.5 mb-2">
              Regels van meerdere leveranciers kunnen in één offerte worden gecombineerd - vink aan of uit welke
              regels meedoen. Iedere regel rekent met zijn eigen leverancier, route, kosten en wisselkoers.
              {supplierCount > 1 && ` Nu ${supplierCount} leveranciers geselecteerd.`}
            </p>
          </div>
          <table className="table-base">
            <thead>
              <tr>
                <th></th>
                <th>Leverancier</th>
                <th>Product</th>
                <th>Box</th>
                <th>FOB</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <input
                      type="checkbox"
                      name="lineIds"
                      value={line.id}
                      defaultChecked={selectedSet.has(line.id)}
                    />
                  </td>
                  <td className="font-medium">{line.farmOffer.farm?.name ?? "-"}</td>
                  <td>
                    {line.productVariant
                      ? variantLabel(line.productVariant, line.productVariant.product.name)
                      : line.productGroupRaw ?? line.rawText.slice(0, 40)}
                  </td>
                  <td>
                    {line.boxType} · {line.stemsPerBox ?? "?"} stelen
                  </td>
                  <td>{line.fobPricePerStem ? `${line.currency} ${fmtMoney(line.fobPricePerStem, 4)}` : "ontbreekt"}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-6">
                    Geen berekenbare productregels beschikbaar. Upload eerst een leveranciersaanbieding.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card p-6 space-y-4">
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
        </div>
      </form>
    </div>
  );
}
