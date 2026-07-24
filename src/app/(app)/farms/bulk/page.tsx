import Link from "next/link";
import { bulkAddFarms } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Leveranciers -> Bulk import: the supplier bulk-paste tool, split off the
 * Overzicht page (Task 4). Reuses the SAME `bulkAddFarms` server action
 * unchanged - it already redirects to `/farms` on success, so the result
 * banner still renders there exactly as before.
 */
export default function FarmBulkPage() {
  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <Link href="/farms" className="text-sm text-brand-600 hover:underline">
          ← Leveranciers overzicht
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">Bulk import</h1>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Meerdere leveranciers tegelijk toevoegen (plakken)</h2>
        <p className="text-sm text-gray-500 mb-4">
          Plak een lijst, één leverancier per regel: <code className="text-xs bg-gray-100 px-1 rounded">Land</code>{" "}
          gevolgd door <code className="text-xs bg-gray-100 px-1 rounded">Naam</code> (gescheiden door een Tab, zoals
          uit Excel). Staat er geen land bij een regel, dan wordt het standaardland hieronder gebruikt. Namen die al
          bestaan worden overgeslagen (opnieuw plakken maakt geen duplicaten).
        </p>
        <form action={bulkAddFarms} className="space-y-4">
          <div className="max-w-xs">
            <label className="label">Standaardland (als een regel geen land heeft)</label>
            <input className="input" name="defaultCountry" placeholder="bv. Ecuador" />
          </div>
          <div>
            <label className="label">Regels (Land ⇥ Naam, één per regel)</label>
            <textarea
              className="input font-mono text-xs"
              name="rows"
              rows={8}
              required
              placeholder={"Ecuador\tRosaprima\nEcuador\tAgrocoex\nColombia\tLa Gaitana Farms"}
            />
          </div>
          <button className="btn-primary" type="submit">
            Leveranciers toevoegen
          </button>
        </form>
      </div>
    </div>
  );
}
