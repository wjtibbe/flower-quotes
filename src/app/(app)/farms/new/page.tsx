import Link from "next/link";
import { prisma } from "@/lib/db";
import { saveFarm } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Leveranciers -> Nieuwe leverancier: single-supplier creation, split off
 * the Overzicht page (Task 4). Reuses the SAME `saveFarm` server action
 * unchanged (no `id` field submitted, so it always creates); editing an
 * EXISTING supplier stays inline on the Overzicht page ("Bewerken"), exactly
 * as before this split.
 */
export default async function FarmNewPage() {
  const origins = await prisma.origin.findMany({ orderBy: { city: "asc" } });

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Link href="/farms" className="text-sm text-brand-600 hover:underline">
          ← Leveranciers overzicht
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">Nieuwe leverancier</h1>
      </div>

      <div className="card p-6">
        <form action={saveFarm} className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Naam *</label>
            <input className="input" name="name" required />
          </div>
          <div>
            <label className="label">Land *</label>
            <input className="input" name="country" required />
          </div>
          <div>
            <label className="label">Vertrekpunt</label>
            <select className="input" name="originId" defaultValue="">
              <option value="">-</option>
              {origins.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.city}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Standaardvaluta</label>
            <select className="input" name="defaultCurrency" defaultValue="USD">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Opmerkingen</label>
            <textarea className="input" name="notes" rows={2} />
          </div>
          <div className="col-span-2 flex gap-2">
            <button className="btn-primary" type="submit">
              Leverancier toevoegen
            </button>
            <Link href="/farms" className="btn-secondary">
              Annuleren
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
