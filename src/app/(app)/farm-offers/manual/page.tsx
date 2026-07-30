import { prisma } from "@/lib/db";
import { createManualFarmOffer } from "../manualOfferActions";

export const dynamic = "force-dynamic";

/** Step 1 of "Handmatige aanbieding maken": collect the offer header, then hand off to the article-picker/line-editor builder at /farm-offers/manual/[id]. */
export default async function NewManualFarmOfferPage({ searchParams }: { searchParams: { err?: string } }) {
  const farms = await prisma.farm.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, country: true } });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Handmatige aanbieding maken</h1>
        <p className="text-sm text-gray-500 mt-1">
          Stel eerst de aanbiedingsgegevens in. Op het volgende scherm kies je assortimentartikelen en vul je
          hoeveelheden en prijzen in.
        </p>
      </div>

      {searchParams.err && (
        <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-800">{searchParams.err}</div>
      )}

      <form action={createManualFarmOffer} className="card p-6 space-y-4">
        <div>
          <label className="label">Leverancier *</label>
          <select name="farmId" required className="input" defaultValue="">
            <option value="" disabled>
              Kies een leverancier...
            </option>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.country})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Titel</label>
          <input name="title" className="input" placeholder="Optioneel" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Aanbiedingsdatum</label>
            <input name="offerDate" type="date" className="input" defaultValue={today} />
          </div>
          <div>
            <label className="label">Geldig tot</label>
            <input name="validUntil" type="date" className="input" />
          </div>
        </div>
        <button className="btn-primary" type="submit">
          Doorgaan naar assortiment
        </button>
      </form>
    </div>
  );
}
