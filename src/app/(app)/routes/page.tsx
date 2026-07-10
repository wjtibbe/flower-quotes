import { prisma } from "@/lib/db";
import { fmtMoney, fmtDate } from "@/lib/format";
import { createRoute, addFreightRate } from "./actions";

export const dynamic = "force-dynamic";

export default async function RoutesPage() {
  const [routes, origins, destinations] = await Promise.all([
    prisma.route.findMany({
      include: {
        origin: true,
        destination: true,
        freightRates: { orderBy: { effectiveFrom: "desc" }, take: 5 },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.origin.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
    prisma.destination.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Routes & vrachttarieven</h1>
        <p className="text-sm text-gray-500 mt-1">
          Gemiddeld vrachttarief in USD per kg per route. Een nieuw tarief maakt het vorige tarief historisch.
        </p>
      </div>

      <div className="space-y-4">
        {routes.map((route) => {
          const current = route.freightRates.find((r) => r.active);
          return (
            <div key={route.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="font-medium text-gray-900">
                  {route.origin.city} → {route.destination.city}
                </div>
                {current ? (
                  <span className="badge-high">
                    {current.currency} {fmtMoney(current.ratePerKg, 4)}/kg
                    {current.effectiveTo ? ` (tot ${fmtDate(current.effectiveTo)})` : ""}
                  </span>
                ) : (
                  <span className="badge-low">Geen actief tarief</span>
                )}
              </div>

              {route.freightRates.length > 0 && (
                <table className="table-base mt-3">
                  <thead>
                    <tr>
                      <th>Tarief</th>
                      <th>Ingangsdatum</th>
                      <th>Einddatum</th>
                      <th>Status</th>
                      <th>Opmerkingen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {route.freightRates.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.currency} {fmtMoney(r.ratePerKg, 4)}
                        </td>
                        <td>{fmtDate(r.effectiveFrom)}</td>
                        <td>{fmtDate(r.effectiveTo)}</td>
                        <td>{r.active ? <span className="badge-high">actief</span> : <span className="badge bg-gray-100 text-gray-500">historisch</span>}</td>
                        <td>{r.notes ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <form action={addFreightRate.bind(null, route.id)} className="mt-3 flex flex-wrap gap-2 items-end">
                <div>
                  <label className="label">Tarief/kg</label>
                  <input name="ratePerKg" type="number" step="0.0001" required className="input py-1 px-2 text-xs w-24" />
                </div>
                <div>
                  <label className="label">Valuta</label>
                  <select name="currency" className="input py-1 px-2 text-xs w-20" defaultValue="USD">
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
                <div>
                  <label className="label">Einddatum</label>
                  <input name="effectiveTo" type="date" className="input py-1 px-2 text-xs" />
                </div>
                <div>
                  <label className="label">Opmerkingen</label>
                  <input name="notes" className="input py-1 px-2 text-xs w-40" />
                </div>
                <button className="btn-secondary py-1 px-2 text-xs">Nieuw tarief instellen</button>
              </form>
            </div>
          );
        })}
      </div>

      <div className="card p-6 max-w-lg">
        <h2 className="font-semibold text-gray-800 mb-4">Nieuwe route</h2>
        <form action={createRoute} className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Vertrekpunt *</label>
            <select className="input" name="originId" required>
              <option value="">Kies...</option>
              {origins.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.city}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Bestemming *</label>
            <select className="input" name="destinationId" required>
              <option value="">Kies...</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.city}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <button className="btn-primary" type="submit">
              Route toevoegen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
