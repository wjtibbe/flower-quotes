import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import DeletableTable from "@/components/DeletableTable";
import { deleteFarmOffer, bulkDeleteFarmOffers } from "./actions";

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
          <h1 className="text-2xl font-semibold text-gray-900">Leveranciersaanbiedingen</h1>
          <p className="text-sm text-gray-500 mt-1">Alle geüploade en handmatig ingevoerde aanbiedingen.</p>
        </div>
        <Link href="/farm-offers/upload" className="btn-primary">
          + Nieuwe aanbieding uploaden
        </Link>
      </div>

      <form className="flex gap-3 items-end">
        <div>
          <label className="label">Leverancier</label>
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

      <DeletableTable
        columns={[
          { header: "Titel" },
          { header: "Leverancier" },
          { header: "Regels" },
          { header: "Status" },
          { header: "Aangemaakt" },
          { header: "Door" },
        ]}
        rows={offers.map((o) => ({
          id: o.id,
          cells: [
            <Link key="t" href={`/farm-offers/${o.id}`} className="text-brand-700 hover:underline font-medium">
              {o.title ?? "Naamloos"}
            </Link>,
            o.farm?.name ?? <span className="text-gray-400">niet gekoppeld</span>,
            o._count.lines,
            <span key="s" className={o.status === "DRAFT" ? "badge-medium" : "badge-high"}>
              {STATUS_LABELS[o.status]}
            </span>,
            fmtDate(o.createdAt),
            o.createdBy.name,
          ],
        }))}
        emptyMessage="Geen aanbiedingen gevonden."
        nounSingular="leveranciersaanbieding"
        nounPlural="leveranciersaanbiedingen"
        confirmSingleText="Weet je zeker dat je deze leveranciersaanbieding wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
        deleteAction={deleteFarmOffer}
        bulkDeleteAction={bulkDeleteFarmOffers}
      />
    </div>
  );
}
