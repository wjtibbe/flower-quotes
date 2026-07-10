import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { setDdpCostRate } from "./actions";

export const dynamic = "force-dynamic";

const COST_TYPE_LABELS: Record<string, string> = {
  CLEARING_AND_INSPECTION_PER_STEM: "Clearing & Inspection per steel",
  HANDLING_PER_BOX: "Handling per doos",
};

export default async function DdpCostsPage() {
  const allRoutes = await prisma.route.findMany({
    include: {
      origin: true,
      destination: true,
      ddpCostRates: { where: { active: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const ddpRoutes = allRoutes.filter((r) => r.supportsDdp);
  const nonDdpRoutes = allRoutes.filter((r) => !r.supportsDdp);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">DDP-kosten</h1>
        <p className="text-sm text-gray-500 mt-1">
          Eén gecombineerde clearing &amp; inspection-prijs per steel, plus handling per doos - per route. Alleen
          nodig voor routes waarop DDP wordt aangeboden (in te stellen bij Routes &amp; vracht).
        </p>
      </div>

      <div className="space-y-4">
        {ddpRoutes.map((route) => (
          <div key={route.id} className="card p-4">
            <div className="font-medium text-gray-900 mb-2">
              {route.origin.city} → {route.destination.city}
            </div>
            <table className="table-base">
              <thead>
                <tr>
                  <th>Kostentype</th>
                  <th>Bedrag</th>
                  <th>Valuta</th>
                  <th>Opmerkingen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(COST_TYPE_LABELS).map(([type, label]) => {
                  const rate = route.ddpCostRates.find((r) => r.costType === type);
                  return (
                    <tr key={type}>
                      <td>{label}</td>
                      <td>{rate ? fmtMoney(rate.amount, 4) : <span className="text-red-500">ontbreekt</span>}</td>
                      <td>{rate?.currency ?? "-"}</td>
                      <td>{rate?.notes ?? "-"}</td>
                      <td>
                        <details>
                          <summary className="text-xs text-brand-600 cursor-pointer">
                            {rate ? "Wijzigen" : "Instellen"}
                          </summary>
                          <form action={setDdpCostRate} className="mt-2 flex flex-wrap gap-2 items-end">
                            <input type="hidden" name="routeId" value={route.id} />
                            <input type="hidden" name="costType" value={type} />
                            <input
                              name="amount"
                              type="number"
                              step="0.0001"
                              required
                              defaultValue={rate?.amount.toString()}
                              className="input py-1 px-2 text-xs w-24"
                            />
                            <select name="currency" className="input py-1 px-2 text-xs w-20" defaultValue={rate?.currency ?? "USD"}>
                              <option value="USD">USD</option>
                              <option value="EUR">EUR</option>
                            </select>
                            <input
                              name="notes"
                              defaultValue={rate?.notes ?? ""}
                              placeholder="Opmerkingen"
                              className="input py-1 px-2 text-xs w-40"
                            />
                            <button className="btn-primary py-1 px-2 text-xs">Opslaan</button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {ddpRoutes.length === 0 && (
          <div className="card p-6 text-center text-gray-400">
            Geen enkele route biedt DDP aan. Zet dit aan bij "Routes &amp; vracht".
          </div>
        )}
      </div>

      {nonDdpRoutes.length > 0 && (
        <div className="text-xs text-gray-400">
          Routes zonder DDP-optie (niet getoond hierboven):{" "}
          {nonDdpRoutes.map((r) => `${r.origin.city} → ${r.destination.city}`).join(", ")}
        </div>
      )}
    </div>
  );
}
