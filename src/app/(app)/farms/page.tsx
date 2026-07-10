import { prisma } from "@/lib/db";
import { saveFarm, toggleFarmActive, addFarmAlias, removeFarmAlias } from "./actions";

export const dynamic = "force-dynamic";

export default async function FarmsPage({ searchParams }: { searchParams: { edit?: string } }) {
  const [farms, origins] = await Promise.all([
    prisma.farm.findMany({ orderBy: { name: "asc" }, include: { aliases: true, origin: true } }),
    prisma.origin.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
  ]);

  const editing = searchParams.edit ? farms.find((f) => f.id === searchParams.edit) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Farms</h1>
        <p className="text-sm text-gray-500 mt-1">Farms, hun vertrekpunt en bekende naamvarianten (aliassen).</p>
      </div>

      <div className="space-y-4">
        {farms.map((farm) => (
          <div key={farm.id} className="card p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-gray-900">
                  {farm.name} <span className="text-gray-400 font-normal">({farm.country})</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">Vertrekpunt: {farm.origin?.city ?? "-"}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={farm.active ? "badge-high" : "badge-low"}>{farm.active ? "actief" : "inactief"}</span>
                <a href={`/farms?edit=${farm.id}`} className="text-xs text-brand-600 hover:underline">
                  Bewerken
                </a>
                <form action={toggleFarmActive.bind(null, farm.id, farm.active)}>
                  <button className="text-xs text-gray-500 hover:underline">
                    {farm.active ? "Deactiveren" : "Activeren"}
                  </button>
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
        <h2 className="font-semibold text-gray-800 mb-4">{editing ? "Farm bewerken" : "Nieuwe farm"}</h2>
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
          <div className="col-span-2">
            <label className="label">Opmerkingen</label>
            <textarea className="input" name="notes" rows={2} defaultValue={editing?.notes ?? ""} />
          </div>
          <div className="col-span-2 flex gap-2">
            <button className="btn-primary" type="submit">
              {editing ? "Opslaan" : "Farm toevoegen"}
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
