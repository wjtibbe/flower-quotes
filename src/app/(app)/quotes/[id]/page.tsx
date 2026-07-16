import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { quoteForExportInclude } from "@/lib/exports/types";
import { quoteTotals } from "@/lib/quoteTotals";
import { variantLabel } from "@/lib/variantLabel";
import CopyButton from "@/components/CopyButton";
import { overrideQuoteLinePrice, clearQuoteLineOverride, setQuoteStatus, generateExport } from "../actions";
import { QuoteExportType, QuoteStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  CONCEPT: "Concept",
  READY: "Gereed",
  EXPORTED: "Geëxporteerd",
  EXPIRED: "Verlopen",
  CANCELLED: "Geannuleerd",
};

export default async function QuoteDetailPage({ params }: { params: { id: string } }) {
  const quote = await prisma.quote.findUnique({
    where: { id: params.id },
    include: {
      ...quoteForExportInclude,
      exports: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!quote) notFound();

  const latestWhatsApp = quote.exports.find((e) => e.type === "WHATSAPP");
  const latestEmail = quote.exports.find((e) => e.type === "EMAIL");
  const latestCustomerExcel = quote.exports.find((e) => e.type === "EXCEL_CUSTOMER");
  const latestInternalExcel = quote.exports.find((e) => e.type === "EXCEL_INTERNAL");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{quote.quoteNumber}</h1>
          <p className="text-sm text-gray-500 mt-1">
            {quote.customer.companyName} · {quote.incoterm} · {quote.currency} ·{" "}
            {quote.origin?.city ?? "?"} → {quote.destination?.city ?? "?"}
          </p>
        </div>
        <div className="text-right">
          <span className="badge-high">{STATUS_LABEL[quote.status]}</span>
          <div className="text-xs text-gray-400 mt-1">Aangemaakt {fmtDateTime(quote.createdAt)}</div>
        </div>
      </div>

      {quote.exchangeRateValue ? (
        <div className="text-xs text-gray-500 space-y-0.5">
          <div>
            Wisselkoers snapshot: 1 {quote.exchangeRateBase} = {fmtMoney(quote.exchangeRateValue, 6)}{" "}
            {quote.exchangeRateQuote} ({fmtDateTime(quote.exchangeRateDate)})
            {quote.exchangeRateIsManual && <span className="ml-2 badge-medium">handmatig aangepast</span>}
          </div>
          {quote.exchangeRateIsManual && quote.exchangeRateDefaultValue && (
            <div className="text-amber-600">
              Afwijkend van de standaardkoers ({fmtMoney(quote.exchangeRateDefaultValue, 6)} {quote.exchangeRateQuote})
              {quote.exchangeRateOverrideReason ? ` - reden: ${quote.exchangeRateOverrideReason}` : ""}
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-gray-400">
          Geen wisselkoers nodig (bron- en doelvaluta gelijk) of niet vastgelegd voor deze offerte.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Leverancier</th>
              <th>Product</th>
              <th>Verpakking</th>
              <th>Dozen</th>
              <th>Stelen</th>
              <th>FOB</th>
              <th>Vracht</th>
              <th>Clearing & Inspection</th>
              <th>Handling</th>
              <th>Overige kosten</th>
              <th>Kostprijs (bron)</th>
              <th>Kostprijs ({quote.currency})</th>
              <th>Marge</th>
              <th>Berekende prijs</th>
              <th>Definitieve prijs</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((line) => {
              const variant = line.farmOfferLine.productVariant;
              const treatment = line.farmOfferLine.treatmentRaw;
              const treatmentSuffix = treatment && treatment.toLowerCase() !== "normal" ? ` (${treatment})` : "";
              const label =
                (variant
                  ? variantLabel(variant, variant.product.name)
                  : line.farmOfferLine.productGroupRaw ?? line.farmOfferLine.rawText.slice(0, 30)) + treatmentSuffix;
              const finalPrice = line.manualSellPricePerStem ?? line.calculatedSellPricePerStem;
              // "Overige kosten" = total additional minus the itemized clearing&inspection + handling.
              const clearingInsp = Number(line.clearingAndInspectionPerStem ?? 0);
              const handling = Number(line.handlingPerStem ?? 0);
              const additionalTotal = Number(line.additionalCostPerStem ?? clearingInsp + handling);
              const other = Math.max(0, additionalTotal - clearingInsp - handling);
              const costItems = Array.isArray(line.additionalCostsSnapshot)
                ? (line.additionalCostsSnapshot as { name: string; unit: string; perStem: string }[])
                : [];

              // Supplier: the line's own snapshot, with the farm-offer path as
              // fallback for legacy lines created before farmId existed.
              const supplierName = line.farm?.name ?? line.farmOfferLine.farmOffer.farm?.name ?? "-";

              return (
                <tr key={line.id}>
                  <td className="font-medium whitespace-nowrap">{supplierName}</td>
                  <td>{label}</td>
                  <td>{line.farmOfferLine.boxType ?? "-"}</td>
                  <td>{line.quantityBoxes}</td>
                  <td>{line.quantityBoxes * line.stemsPerBox}</td>
                  <td>{fmtMoney(line.fobPricePerStem, 4)}</td>
                  <td>{fmtMoney(line.freightPerStem, 4)}</td>
                  <td>{fmtMoney(line.clearingAndInspectionPerStem, 4)}</td>
                  <td>{fmtMoney(line.handlingPerStem, 4)}</td>
                  <td>
                    {fmtMoney(other, 4)}
                    {costItems.length > 0 && (
                      <details className="inline-block ml-1">
                        <summary className="text-xs text-brand-600 cursor-pointer inline">specificatie</summary>
                        <div className="absolute z-10 mt-1 bg-white border border-gray-200 rounded shadow p-2 text-xs">
                          {costItems.map((c, i) => (
                            <div key={i} className="whitespace-nowrap">
                              {c.name}: {fmtMoney(c.perStem, 4)}/steel
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </td>
                  <td>{fmtMoney(line.costPricePerStemSource, 4)}</td>
                  <td>{fmtMoney(line.costPricePerStemQuote, 4)}</td>
                  <td>{fmtMoney(line.marginPercent, 1)}%</td>
                  <td>{fmtMoney(line.calculatedSellPricePerStem, 2)}</td>
                  <td className="font-semibold">
                    {fmtMoney(finalPrice, 2)}
                    {line.isManualOverride && <span className="ml-1 badge-medium">handmatig</span>}
                  </td>
                  <td>
                    <details>
                      <summary className="text-xs text-brand-600 cursor-pointer">Prijs aanpassen</summary>
                      <form action={overrideQuoteLinePrice.bind(null, line.id)} className="mt-2 space-y-1 w-48">
                        <input
                          name="manualSellPricePerStem"
                          type="number"
                          step="0.0001"
                          placeholder="Nieuwe prijs"
                          className="input py-1 text-xs"
                          defaultValue={line.manualSellPricePerStem?.toString() ?? ""}
                        />
                        <input
                          name="overrideReason"
                          placeholder="Reden (optioneel)"
                          className="input py-1 text-xs"
                          defaultValue={line.overrideReason ?? ""}
                        />
                        <div className="flex gap-1">
                          <button className="btn-secondary text-xs py-1 px-2">Opslaan</button>
                        </div>
                      </form>
                      {line.isManualOverride && (
                        <form action={clearQuoteLineOverride.bind(null, line.id)}>
                          <button className="text-xs text-red-500 hover:underline mt-1">Reset naar berekende prijs</button>
                        </form>
                      )}
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(() => {
        // Quote totals: simply the sum of all lines - every line carries its
        // own supplier, route, costs and exchange-rate snapshot.
        const totals = quoteTotals(quote.lines);
        const supplierNames = [
          ...new Set(
            quote.lines.map((l) => l.farm?.name ?? l.farmOfferLine.farmOffer.farm?.name).filter(Boolean),
          ),
        ] as string[];
        return (
          <div className="card p-4 flex flex-wrap gap-6 text-sm text-gray-700">
            <div>
              <span className="text-gray-400">Leveranciers:</span>{" "}
              <span className="font-medium">{supplierNames.length > 0 ? supplierNames.join(", ") : "-"}</span>
            </div>
            <div>
              <span className="text-gray-400">Totaal dozen:</span> <span className="font-medium">{totals.totalBoxes}</span>
            </div>
            <div>
              <span className="text-gray-400">Totaal stelen:</span> <span className="font-medium">{totals.totalStems}</span>
            </div>
            <div>
              <span className="text-gray-400">Totale offertewaarde:</span>{" "}
              <span className="font-medium">
                {quote.currency} {fmtMoney(totals.totalValue.toString(), 2)}
              </span>
            </div>
          </div>
        );
      })()}

      <div className="card p-4 flex flex-wrap gap-2 items-center">
        <span className="text-sm text-gray-600 mr-2">Status:</span>
        {(["CONCEPT", "READY", "EXPORTED", "EXPIRED", "CANCELLED"] as QuoteStatus[]).map((s) => (
          <form key={s} action={setQuoteStatus.bind(null, quote.id, s)}>
            <button
              className={quote.status === s ? "btn-primary text-xs py-1 px-2" : "btn-secondary text-xs py-1 px-2"}
            >
              {STATUS_LABEL[s]}
            </button>
          </form>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-800">WhatsApp-tekst</h2>
            <form action={generateExport.bind(null, quote.id, QuoteExportType.WHATSAPP)}>
              <button className="btn-secondary text-xs py-1 px-2">Genereren</button>
            </form>
          </div>
          {latestWhatsApp?.content ? (
            <>
              <pre className="text-xs whitespace-pre-wrap bg-gray-50 p-3 rounded border border-gray-100 max-h-64 overflow-y-auto">
                {latestWhatsApp.content}
              </pre>
              <div className="mt-2">
                <CopyButton text={latestWhatsApp.content} />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">Nog niet gegenereerd.</p>
          )}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-gray-800">E-mailtekst</h2>
            <form action={generateExport.bind(null, quote.id, QuoteExportType.EMAIL)}>
              <button className="btn-secondary text-xs py-1 px-2">Genereren</button>
            </form>
          </div>
          {latestEmail?.content ? (
            <>
              <pre className="text-xs whitespace-pre-wrap bg-gray-50 p-3 rounded border border-gray-100 max-h-64 overflow-y-auto">
                {latestEmail.content}
              </pre>
              <div className="mt-2">
                <CopyButton text={latestEmail.content} />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400">Nog niet gegenereerd.</p>
          )}
        </div>

        <div className="card p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Excel - klantversie</h2>
          <p className="text-xs text-gray-500 mb-2">Zonder kostprijs, marge of interne berekening.</p>
          <div className="flex gap-2">
            <form action={generateExport.bind(null, quote.id, QuoteExportType.EXCEL_CUSTOMER)}>
              <button className="btn-secondary text-xs py-1 px-2">Genereren</button>
            </form>
            {latestCustomerExcel && (
              <a href={`/api/exports/${latestCustomerExcel.id}`} className="btn-primary text-xs py-1 px-2">
                Downloaden
              </a>
            )}
          </div>
        </div>

        <div className="card p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Excel - interne calculatie</h2>
          <p className="text-xs text-gray-500 mb-2">Volledige kostprijsopbouw en marge - nooit naar de klant sturen.</p>
          <div className="flex gap-2">
            <form action={generateExport.bind(null, quote.id, QuoteExportType.EXCEL_INTERNAL)}>
              <button className="btn-secondary text-xs py-1 px-2">Genereren</button>
            </form>
            {latestInternalExcel && (
              <a href={`/api/exports/${latestInternalExcel.id}`} className="btn-primary text-xs py-1 px-2">
                Downloaden
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
