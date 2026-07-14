import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { quoteForExportInclude } from "@/lib/exports/types";
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

      {quote.exchangeRateValue && (
        <div className="text-xs text-gray-500">
          Wisselkoers snapshot: 1 {quote.exchangeRateBase} = {fmtMoney(quote.exchangeRateValue, 6)} {quote.exchangeRateQuote}{" "}
          ({fmtDateTime(quote.exchangeRateDate)})
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Product</th>
              <th>FOB</th>
              <th>Vracht</th>
              <th>Clearing & Inspection</th>
              <th>Handling</th>
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

              return (
                <tr key={line.id}>
                  <td>{label}</td>
                  <td>{fmtMoney(line.fobPricePerStem, 4)}</td>
                  <td>{fmtMoney(line.freightPerStem, 4)}</td>
                  <td>{fmtMoney(line.clearingAndInspectionPerStem, 4)}</td>
                  <td>{fmtMoney(line.handlingPerStem, 4)}</td>
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
