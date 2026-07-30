import Link from "next/link";
import { prisma } from "@/lib/db";
import ConfirmButton from "@/components/ConfirmButton";
import { COST_CATEGORY_LABELS, COST_RATE_UNIT_LABELS } from "@/lib/additionalCostTypes";
import {
  addUser,
  deleteUser,
  addAdditionalCostType,
  updateAdditionalCostType,
  toggleAdditionalCostTypeActive,
  deleteAdditionalCostType,
} from "./actions";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  deleted: "Gebruiker verwijderd.",
  "costtype-created": "Kostensoort aangemaakt.",
  "costtype-updated": "Kostensoort bijgewerkt.",
  "costtype-deleted": "Kostensoort verwijderd.",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { msg?: string; err?: string; editCostType?: string };
}) {
  const [users, costTypes] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.additionalCostType.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { costRates: true } } },
    }),
  ]);
  const msg = searchParams.msg ? MESSAGES[searchParams.msg] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Instellingen</h1>
      </div>

      {msg && (
        <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">{msg}</div>
      )}
      {searchParams.err && (
        <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-800">{searchParams.err}</div>
      )}

      <div className="card p-4">
        <h2 className="font-semibold text-gray-800 mb-2">Afrondingsinstellingen</h2>
        <p className="text-sm text-gray-600">
          Interne berekeningen gebruiken minimaal 6 decimalen precisie (decimal arithmetic, geen floating point).
          Verkoopprijzen worden getoond met 2 decimalen, met normale wiskundige afronding (round-half-up). Deze
          instelling is centraal gedefinieerd in de prijsengine en kan per klant worden uitgebreid met afwijkende
          afrondingsregels in een volgende versie.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Naam</th>
              <th>E-mail</th>
              <th>Rol</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  <form action={deleteUser.bind(null, u.id)}>
                    <ConfirmButton
                      message={`Weet je zeker dat je gebruiker "${u.name}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Verwijderen
                    </ConfirmButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-6 max-w-lg">
        <h2 className="font-semibold text-gray-800 mb-4">Nieuwe medewerker</h2>
        <form action={addUser} className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Naam *</label>
            <input className="input" name="name" required />
          </div>
          <div>
            <label className="label">E-mailadres *</label>
            <input className="input" type="email" name="email" required />
          </div>
          <div>
            <label className="label">Wachtwoord *</label>
            <input className="input" type="password" name="password" required minLength={8} />
          </div>
          <div>
            <label className="label">Rol</label>
            <select className="input" name="role" defaultValue="SALES">
              <option value="ADMIN">Admin</option>
              <option value="SALES">Sales</option>
              <option value="READ_ONLY">Alleen-lezen</option>
            </select>
          </div>
          <div className="col-span-2">
            <button className="btn-primary" type="submit">
              Medewerker toevoegen
            </button>
          </div>
        </form>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Aanvullende kostensoorten</h2>
        <p className="text-sm text-gray-500 mt-1">
          De centraal beheerde lijst van kostensoorten (Clearing, Handling, Inspection, ...) waaruit bij Routes &amp;
          vracht wordt gekozen - zo blijft de naamgeving overal consistent. Een kostensoort deactiveren verwijdert 'm
          uit de keuzelijst maar houdt bestaande routekosten en offertes intact.
        </p>
      </div>

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
                        <Link href="/settings" className="text-xs text-gray-500 hover:underline px-2">
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
                    <Link href={`/settings?editCostType=${t.id}`} className="text-xs text-blue-600 hover:underline mr-2">
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
