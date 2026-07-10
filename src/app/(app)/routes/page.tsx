import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { createRoute, setFreightRate, toggleRouteSupportsCfr, toggleRouteSupportsDdp } from "./actions";

export const dynamic = "force-dynamic";

export default async function RoutesPage() {
  const [routes, origins, destinations] = await Promise.all([
    prisma.route.findMany({
      include: {
        origin: true,
        destination: true,
        freightRates: { where: { active: true }, orderBy: { effectiveFrom: "desc" }, take: 1 },
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
          Eén vrachttarief per route. Een nieuwe waarde vervangt direct de vorige - geen historie of einddatums.
          FOB kan altijd; zet C&amp;F en/of DDP per route aan of uit als die niet worden aangeboden.
        </p>
      </div>

      <div className="space-y-3">
        {routes.map((route) => {
          const current = route.freightRates[0];
          return (
            <div key={route.id} className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="font-medium text-gray-900">
                  {route.origin.city} → {route.destination.city}
                  {current && (
                    <span className="ml-3 text-sm text-gray-500 font-normal">
                      huidig: {current.currency} {fmtMoney(current.ratePerKg, 4)}/kg
                    </span>
                  )}
                </div>

                <form action={setFreightRate.bind(null, route.id)} className="flex flex-wrap gap-2 items-end">
                  <div>
                    <label className="label">Tarief/kg</label>
                    <input
                      name="ratePerKg"
                      type="number"
                      step="0.0001"
                      required
                      defaultValue={current?.ratePerKg.toString()}
                      className="input py-1 px-2 text-xs w-24"
                    />
                  </div>
                  <div>
                    <label className="label">Valuta</label>
                    <select name="currency" className="input py-1 px-2 text-xs w-20" defaultValue={current?.currency ?? "USD"}>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Opmerkingen</label>
                    <input name="notes" defaultValue={current?.notes ?? ""} className="input py-1 px-2 text-xs w-40" />
                  </div>
                  <button className="btn-primary py-1 px-2 text-xs">{current ? "Wijzigen" : "Instellen"}</button>
                </form>
              </div>

              <div className="flex items-center gap-4 pt-2 border-t border-gray-100 text-sm">
                <span className="badge bg-gray-100 text-gray-700">FOB altijd beschikbaar</span>
                <form action={toggleRouteSupportsCfr.bind(null, route.id, route.supportsCfr)}>
                  <button className={route.supportsCfr ? "badge-high" : "badge bg-gray-100 text-gray-500"}>
                    C&amp;F: {route.supportsCfr ? "aan" : "uit"}
                  </button>
                </form>
                <form action={toggleRouteSupportsDdp.bind(null, route.id, route.supportsDdp)}>
                  <button className={route.supportsDdp ? "badge-high" : "badge bg-gray-100 text-gray-500"}>
                    DDP: {route.supportsDdp ? "aan" : "uit"}
                  </button>
                </form>
              </div>
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
