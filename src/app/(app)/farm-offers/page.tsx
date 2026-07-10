import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Concept (te controleren)",
  REVIEWED: "Gecontroleerd",
  ARCHIVED: "Gearchiveerd",
};

export default async function FarmOffersPage({
  searchParams,
}: {
  searchParams: { farmId?: string; status?: string };
}) {
  const [offers, farms] = await Promise.all([
    prisma.farmOffer.findMany({
      where: {
        farmId: searchParams.farmId || undefined,
        status: (searchParams.status as never) || undefined,
      },
      orderBy: { createdAt: "desc" },
      include: { farm: true, createdBy: true, _count: { select: { lines: true } } },
    }),
    prisma.farm.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Farm-aanbiedingen</h1>
          <p className="text-sm text-gray-500 mt-1">Alle geüploade en handmatig ingevoerde aanbiedingen.</p>
        </div>
        <Link href="/farm-offers/upload" className="btn-primary">
          + Nieuwe aanbieding uploaden
        </Link>
      </div>

      <form className="flex gap-3 items-end">
        <div>
          <label className="label">Farm</label>
          <select name="farmId" defaultValue={searchParams.farmId ?? ""} className="input">
            <option value="">Alle</option>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={searchParams.status ?? ""} className="input">
            <option value="">Alle</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
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
              <th>Titel</th>
              <th>Farm</th>
              <th>Regels</th>
              <th>Status</th>
              <th>Aangemaakt</th>
              <th>Door</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/farm-offers/${o.id}`} className="text-brand-700 hover:underline font-medium">
                    {o.title ?? "Naamloos"}
                  </Link>
                </td>
                <td>{o.farm?.name ?? <span className="text-gray-400">niet gekoppeld</span>}</td>
                <td>{o._count.lines}</td>
                <td>
                  <span className={o.status === "DRAFT" ? "badge-medium" : "badge-high"}>
                    {STATUS_LABELS[o.status]}
                  </span>
                </td>
                <td>{fmtDate(o.createdAt)}</td>
                <td>{o.createdBy.name}</td>
              </tr>
            ))}
            {offers.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-gray-400 py-6">
                  Geen aanbiedingen gevonden.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
