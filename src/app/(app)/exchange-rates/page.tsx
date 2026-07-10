import { prisma } from "@/lib/db";
import { fmtMoney, fmtDateTime } from "@/lib/format";
import { addExchangeRate } from "./actions";

export const dynamic = "force-dynamic";

export default async function ExchangeRatesPage() {
  const rates = await prisma.exchangeRate.findMany({ orderBy: { effectiveFrom: "desc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Wisselkoersen</h1>
        <p className="text-sm text-gray-500 mt-1">
          Handmatig ingevoerd. Elke offerte bewaart een eigen snapshot - latere wijzigingen hier hebben geen invloed op
          bestaande offertes.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Koers</th>
              <th>Ingangsdatum</th>
              <th>Status</th>
              <th>Opmerkingen</th>
            </tr>
          </thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">
                  1 {r.baseCurrency} = {fmtMoney(r.rate, 6)} {r.quoteCurrency}
                </td>
                <td>{fmtDateTime(r.effectiveFrom)}</td>
                <td>
                  <span className={r.active ? "badge-high" : "badge bg-gray-100 text-gray-500"}>
                    {r.active ? "actief" : "historisch"}
                  </span>
                </td>
                <td>{r.notes ?? "-"}</td>
              </tr>
            ))}
            {rates.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-gray-400 py-6">
                  Nog geen wisselkoersen ingevoerd.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-6 max-w-lg">
        <h2 className="font-semibold text-gray-800 mb-4">Nieuwe koers instellen</h2>
        <form action={addExchangeRate} className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Basisvaluta *</label>
            <select className="input" name="baseCurrency" required defaultValue="USD">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className="label">Doelvaluta *</label>
            <select className="input" name="quoteCurrency" required defaultValue="EUR">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Koers (1 basis = ... doel) *</label>
            <input className="input" name="rate" type="number" step="0.000001" required placeholder="0.920000" />
          </div>
          <div className="col-span-2">
            <label className="label">Opmerkingen</label>
            <textarea className="input" name="notes" rows={2} />
          </div>
          <div className="col-span-2">
            <button className="btn-primary" type="submit">
              Koers instellen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
