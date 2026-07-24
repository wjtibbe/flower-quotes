import { prisma } from "@/lib/db";
import ConfirmButton from "@/components/ConfirmButton";
import { saveFarm, bulkAddFarms, deleteFarm, addFarmAlias, removeFarmAlias } from "./actions";

export const dynamic = "force-dynamic";

export default async function FarmsPage({
  searchParams,
}: {
  searchParams: { edit?: string; msg?: string; err?: string; created?: string; dup?: string; invalid?: string };
}) {
  const [farms, origins] = await Promise.all([
    prisma.farm.findMany({ orderBy: { name: "asc" }, include: { aliases: true, origin: true } }),
    prisma.origin.findMany({ orderBy: { city: "asc" } }),
  ]);

  const editing = searchParams.edit ? farms.find((f) => f.id === searchParams.edit) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Leveranciers</h1>
        <p className="text-sm text-gray-500 mt-1">Leveranciers, hun vertrekpunt en bekende naamvarianten (aliassen).</p>
      </div>

      {searchParams.msg === "deleted" && (
        <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">Leverancier verwijderd.</div>
      )}
      {searchParams.msg === "bulkfarms" && (
        <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">
          {searchParams.created ?? 0} leverancier(s) toegevoegd
          {Number(searchParams.dup) > 0 && `, ${searchParams.dup} bestond al (overgeslagen)`}
          {Number(searchParams.invalid) > 0 && `, ${searchParams.invalid} regel(s) ongeldig (overgeslagen)`}.
        </div>
      )}
      {searchParams.err && (
        <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-800">{searchParams.err}</div>
      )}

      <div className="space-y-4">
        {farms.map((farm) => (
          <div key={farm.id} className="card p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-gray-900">
                  {farm.name} <span className="text-gray-400 font-normal">({farm.country})</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Vertrekpunt: {farm.origin?.city ?? "-"} · Standaardvaluta: {farm.defaultCurrency}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <a href={`/farms?edit=${farm.id}`} className="text-xs text-brand-600 hover:underline">
                  Bewerken
                </a>
                <form action={deleteFarm.bind(null, farm.id)}>
                  <ConfirmButton
                    message={`Weet je zeker dat je leverancier "${farm.name}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Verwijderen
                  </ConfirmButton>
                </form>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {farm.aliases.map((a) => (
                <span key={a.id} className="badge bg-gray-100 text-gray-700 gap-1">
                  {a.alias}
                  <form action={removeFarmAlias.bind(null, a.id)} className="inline">
                    <button className="ml-1 text-gray-400 hover:text-red-600" title="Verwijderen">
                      ×
                    </button>
                  </form>
                </span>
              ))}
              <form action={addFarmAlias.bind(null, farm.id)} className="flex items-center gap-1">
                <input name="alias" placeholder="+ alias" className="input py-1 px-2 text-xs w-32" />
                <button className="text-xs text-brand-600 hover:underline">Toevoegen</button>
              </form>
            </div>
          </div>
        ))}
      </div>

      <div className="card p-6 max-w-2xl">
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

      <div className="card p-6 max-w-2xl">
        <h2 className="font-semibold text-gray-800 mb-4">{editing ? "Leverancier bewerken" : "Nieuwe leverancier"}</h2>
        <form action={saveFarm} key={editing?.id ?? "new"} className="grid grid-cols-2 gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div>
            <label className="label">Naam *</label>
            <input className="input" name="name" required defaultValue={editing?.name} />
          </div>
          <div>
            <label className="label">Land *</label>
            <input className="input" name="country" required defaultValue={editing?.country} />
          </div>
          <div>
            <label className="label">Vertrekpunt</label>
            <select className="input" name="originId" defaultValue={editing?.originId ?? ""}>
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
            <select className="input" name="defaultCurrency" defaultValue={editing?.defaultCurrency ?? "USD"}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Opmerkingen</label>
            <textarea className="input" name="notes" rows={2} defaultValue={editing?.notes ?? ""} />
          </div>
          <div className="col-span-2 flex gap-2">
            <button className="btn-primary" type="submit">
              {editing ? "Opslaan" : "Leverancier toevoegen"}
            </button>
            {editing && (
              <a href="/farms" className="btn-secondary">
                Annuleren
              </a>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
