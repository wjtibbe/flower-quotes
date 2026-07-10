import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { addDdpCostRate } from "./actions";

export const dynamic = "force-dynamic";

const COST_TYPE_LABELS: Record<string, string> = {
  CLEARING_PER_STEM: "Clearing per steel",
  INSPECTION_PER_STEM: "Inspection per steel",
  HANDLING_PER_BOX: "Handling per doos",
};

export default async function DdpCostsPage() {
  const routes = await prisma.route.findMany({
    include: {
      origin: true,
      destination: true,
      ddpCostRates: { where: { active: true }, orderBy: { costType: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">DDP-kosten</h1>
        <p className="text-sm text-gray-500 mt-1">
          Clearing, inspection (per steel) en handling (per doos) per route - nodig voor DDP-offertes.
        </p>
      </div>

      <div className="space-y-4">
        {routes.map((route) => (
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
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <form action={addDdpCostRate} className="mt-3 flex flex-wrap gap-2 items-end">
              <input type="hidden" name="routeId" value={route.id} />
              <div>
                <label className="label">Kostentype</label>
                <select name="costType" className="input py-1 px-2 text-xs" required>
                  {Object.entries(COST_TYPE_LABELS).map(([type, label]) => (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Bedrag</label>
                <input name="amount" type="number" step="0.0001" required className="input py-1 px-2 text-xs w-24" />
              </div>
              <div>
                <label className="label">Valuta</label>
                <select name="currency" className="input py-1 px-2 text-xs w-20" defaultValue="USD">
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
              <div>
                <label className="label">Opmerkingen</label>
                <input name="notes" className="input py-1 px-2 text-xs w-40" />
              </div>
              <button className="btn-secondary py-1 px-2 text-xs">Instellen</button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
