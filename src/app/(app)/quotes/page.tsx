import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate, fmtMoney } from "@/lib/format";

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

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Offertenummer</th>
              <th>Klant</th>
              <th>Bestemming</th>
              <th>Incoterm</th>
              <th>Valuta</th>
              <th>Marge</th>
              <th>Regels</th>
              <th>Status</th>
              <th>Datum</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id}>
                <td>
                  <Link href={`/quotes/${q.id}`} className="text-brand-700 hover:underline font-medium">
                    {q.quoteNumber}
                  </Link>
                </td>
                <td>{q.customer.companyName}</td>
                <td>{q.destination?.city ?? "-"}</td>
                <td>{q.incoterm}</td>
                <td>{q.currency}</td>
                <td>{fmtMoney(q.marginPercentDefault, 1)}%</td>
                <td>{q._count.lines}</td>
                <td>
                  <span className={q.status === "CONCEPT" ? "badge-medium" : "badge-high"}>{STATUS_LABEL[q.status]}</span>
                </td>
                <td>{fmtDate(q.createdAt)}</td>
              </tr>
            ))}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-gray-400 py-6">
                  Geen offertes gevonden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
