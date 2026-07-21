import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";
import DeletableTable from "@/components/DeletableTable";
import { deleteQuote, bulkDeleteQuotes } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  CONCEPT: "Concept",
  READY: "Gereed",
  EXPORTED: "Geëxporteerd",
  EXPIRED: "Verlopen",
  CANCELLED: "Geannuleerd",
};

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: { customerId?: string; status?: string; destinationId?: string; justCreated?: string };
}) {
  const [quotes, customers, destinations] = await Promise.all([
    prisma.quote.findMany({
      where: {
        customerId: searchParams.customerId || undefined,
        status: (searchParams.status as never) || undefined,
        destinationId: searchParams.destinationId || undefined,
      },
      orderBy: { createdAt: "desc" },
      include: { customer: true, destination: true, _count: { select: { lines: true } } },
    }),
    prisma.customer.findMany({ orderBy: { companyName: "asc" } }),
    prisma.destination.findMany({ orderBy: { city: "asc" } }),
  ]);

  const justCreatedIds = searchParams.justCreated?.split(",").filter(Boolean) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Offertehistorie</h1>
        <p className="text-sm text-gray-500 mt-1">Alle offertes, doorzoekbaar op klant, bestemming en status.</p>
      </div>

      {justCreatedIds.length > 1 && (
        <div className="card p-4 bg-green-50 border-green-200 text-sm text-green-800">
          {justCreatedIds.length} offertes aangemaakt:{" "}
          {justCreatedIds.map((id, i) => (
            <span key={id}>
              <Link href={`/quotes/${id}`} className="underline">
                bekijk #{i + 1}
              </Link>
              {i < justCreatedIds.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}

      <form className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="label">Klant</label>
          <select name="customerId" defaultValue={searchParams.customerId ?? ""} className="input">
            <option value="">Alle</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Bestemming</label>
          <select name="destinationId" defaultValue={searchParams.destinationId ?? ""} className="input">
            <option value="">Alle</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>
                {d.city}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={searchParams.status ?? ""} className="input">
            <option value="">Alle</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-secondary">Filteren</button>
      </form>

      <DeletableTable
        columns={[
          { header: "Offertenummer" },
          { header: "Klant" },
          { header: "Bestemming" },
          { header: "Incoterm" },
          { header: "Valuta" },
          { header: "Marge" },
          { header: "Regels" },
          { header: "Status" },
          { header: "Datum" },
        ]}
        rows={quotes.map((q) => ({
          id: q.id,
          cells: [
            <Link key="n" href={`/quotes/${q.id}`} className="text-brand-700 hover:underline font-medium">
              {q.quoteNumber}
            </Link>,
            q.customer.companyName,
            q.destination?.city ?? "-",
            q.incoterm,
            q.currency,
            `${fmtMoney(q.marginPercentDefault, 1)}%`,
            q._count.lines,
            <span key="s" className={q.status === "CONCEPT" ? "badge-medium" : "badge-high"}>
              {STATUS_LABEL[q.status]}
            </span>,
            fmtDate(q.createdAt),
          ],
        }))}
        emptyMessage="Geen offertes gevonden."
        nounSingular="offerte"
        nounPlural="offertes"
        confirmSingleText="Weet je zeker dat je deze offerte wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
        deleteAction={deleteQuote}
        bulkDeleteAction={bulkDeleteQuotes}
      />
    </div>
  );
}
