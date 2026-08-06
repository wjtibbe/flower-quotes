import Link from "next/link";
import { prisma } from "@/lib/db";
import ConfirmButton from "@/components/ConfirmButton";
import { COST_CATEGORY_LABELS, COST_RATE_UNIT_LABELS } from "@/lib/additionalCostTypes";
import {
  addAdditionalCostType,
  updateAdditionalCostType,
  toggleAdditionalCostTypeActive,
  deleteAdditionalCostType,
} from "./actions";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  "costtype-created": "Kostensoort aangemaakt.",
  "costtype-updated": "Kostensoort bijgewerkt.",
  "costtype-deleted": "Kostensoort verwijderd.",
};

export default async function AdditionalCostTypesPage({
  searchParams,
}: {
  searchParams: { msg?: string; err?: string; editCostType?: string };
}) {
  const costTypes = await prisma.additionalCostType.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { costRates: true } } },
  });
  const msg = searchParams.msg ? MESSAGES[searchParams.msg] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Aanvullende kostensoorten</h1>
        <p className="text-sm text-gray-500 mt-1">
          De centraal beheerde lijst van kostensoorten (Clearing, Handling, Inspection, ...) waaruit bij Routes &amp;
          vracht wordt gekozen - zo blijft de naamgeving overal consistent. Een kostensoort deactiveren verwijdert 'm
          uit de keuzelijst maar houdt bestaande routekosten en offertes intact.
        </p>
      </div>

      {msg && <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">{msg}</div>}
      {searchParams.err && (
        <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-800">{searchParams.err}</div>
      )}

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Naam</th>
              <th>Categorie</th>
              <th>Standaardeenheid</th>
              <th>Status</th>
              <th>In gebruik</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {costTypes.map((t) => {
              if (searchParams.editCostType === t.id) {
                return (
                  <tr key={t.id}>
                    <td colSpan={6}>
                      <form
                        action={updateAdditionalCostType.bind(null, t.id)}
                        className="flex flex-wrap gap-2 items-end py-1"
                      >
                        <div>
                          <label className="label">Naam</label>
                          <input name="name" required defaultValue={t.name} className="input py-1 px-2 text-xs w-32" />
                        </div>
                        <div>
                          <label className="label">Categorie</label>
                          <select name="category" required className="input py-1 px-2 text-xs" defaultValue={t.category}>
                            {Object.entries(COST_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Standaardeenheid</label>
                          <select name="defaultUnit" required className="input py-1 px-2 text-xs" defaultValue={t.defaultUnit}>
                            {Object.entries(COST_RATE_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="label">Omschrijving</label>
                          <input name="description" defaultValue={t.description ?? ""} className="input py-1 px-2 text-xs w-40" />
                        </div>
                        <button className="btn-primary py-1 px-2 text-xs">Opslaan</button>
                        <Link href="/settings/additional-cost-types" className="text-xs text-gray-500 hover:underline px-2">
                          Annuleren
                        </Link>
                      </form>
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={t.id}>
                  <td className="font-medium">{t.name}</td>
                  <td>{COST_CATEGORY_LABELS[t.category]}</td>
                  <td>{COST_RATE_UNIT_LABELS[t.defaultUnit]}</td>
                  <td>
                    {t.isActive ? (
                      <span className="badge-high">actief</span>
                    ) : (
                      <span className="text-xs text-gray-400">inactief</span>
                    )}
                  </td>
                  <td>{t._count.costRates}</td>
                  <td className="whitespace-nowrap">
                    <Link href={`/settings/additional-cost-types?editCostType=${t.id}`} className="text-xs text-blue-600 hover:underline mr-2">
                      Bewerken
                    </Link>
                    <form action={toggleAdditionalCostTypeActive.bind(null, t.id, t.isActive)} className="inline mr-2">
                      <button className="text-xs text-gray-600 hover:underline">
                        {t.isActive ? "Deactiveren" : "Activeren"}
                      </button>
                    </form>
                    {t._count.costRates === 0 && (
                      <form action={deleteAdditionalCostType.bind(null, t.id)} className="inline">
                        <ConfirmButton
                          message={`Weet je zeker dat je kostensoort "${t.name}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`}
                          className="text-xs text-red-600 hover:underline"
                        >
                          Verwijderen
                        </ConfirmButton>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {costTypes.length === 0 && (
              <tr><td colSpan={6} className="text-gray-400">Nog geen kostensoorten.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-6 max-w-lg">
        <h2 className="font-semibold text-gray-800 mb-4">Nieuwe kostensoort</h2>
        <form action={addAdditionalCostType} className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Naam *</label>
            <input className="input" name="name" required />
          </div>
          <div>
            <label className="label">Categorie *</label>
            <select className="input" name="category" defaultValue="CLEARING">
              {Object.entries(COST_CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Standaardeenheid *</label>
            <select className="input" name="defaultUnit" defaultValue="PER_STEM">
              {Object.entries(COST_RATE_UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Omschrijving</label>
            <input className="input" name="description" />
          </div>
          <div className="col-span-2">
            <button className="btn-primary" type="submit">
              Kostensoort toevoegen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
