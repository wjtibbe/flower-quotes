import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { saveCustomer, toggleCustomerActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: { edit?: string };
}) {
  const [customers, destinations] = await Promise.all([
    prisma.customer.findMany({ orderBy: { companyName: "asc" }, include: { destination: true } }),
    prisma.destination.findMany({ where: { active: true }, orderBy: { city: "asc" } }),
  ]);

  const editing = searchParams.edit ? customers.find((c) => c.id === searchParams.edit) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Klanten</h1>
        <p className="text-sm text-gray-500 mt-1">Klantprofielen met standaard bestemming, valuta, incoterm en marge.</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Bedrijf</th>
              <th>Contact</th>
              <th>Bestemming</th>
              <th>Valuta</th>
              <th>Incoterm</th>
              <th>Marge</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.companyName}</td>
                <td>{c.contactName ?? "-"}</td>
                <td>{c.destination?.city ?? "-"}</td>
                <td>{c.defaultCurrency}</td>
                <td>{c.defaultIncoterm}</td>
                <td>{fmtMoney(c.defaultMarginPercent, 1)}%</td>
                <td>
                  <span className={c.active ? "badge-high" : "badge-low"}>{c.active ? "actief" : "inactief"}</span>
                </td>
                <td className="whitespace-nowrap">
                  <a href={`/customers?edit=${c.id}`} className="text-brand-600 hover:underline text-xs mr-3">
                    Bewerken
                  </a>
                  <form action={toggleCustomerActive.bind(null, c.id, c.active)} className="inline">
                    <button className="text-xs text-gray-500 hover:underline">
                      {c.active ? "Deactiveren" : "Activeren"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-6">
                  Nog geen klanten toegevoegd.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-6 max-w-2xl">
        <h2 className="font-semibold text-gray-800 mb-4">{editing ? "Klant bewerken" : "Nieuwe klant"}</h2>
        <form action={saveCustomer} key={editing?.id ?? "new"} className="grid grid-cols-2 gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <div className="col-span-2">
            <label className="label">Bedrijfsnaam *</label>
            <input className="input" name="companyName" required defaultValue={editing?.companyName} />
          </div>
          <div>
            <label className="label">Contactpersoon</label>
            <input className="input" name="contactName" defaultValue={editing?.contactName ?? ""} />
          </div>
          <div>
            <label className="label">WhatsApp-nummer</label>
            <input className="input" name="whatsappNumber" defaultValue={editing?.whatsappNumber ?? ""} />
          </div>
          <div>
            <label className="label">E-mailadres</label>
            <input className="input" type="email" name="email" defaultValue={editing?.email ?? ""} />
          </div>
          <div>
            <label className="label">Bestemming</label>
            <select className="input" name="destinationId" defaultValue={editing?.destinationId ?? ""}>
              <option value="">-</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.city}
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
          <div>
            <label className="label">Standaard-incoterm</label>
            <select className="input" name="defaultIncoterm" defaultValue={editing?.defaultIncoterm ?? "FOB"}>
              <option value="FOB">FOB</option>
              <option value="CFR">C&F</option>
              <option value="DDP">DDP</option>
            </select>
          </div>
          <div>
            <label className="label">Standaardmarge (%)</label>
            <input
              className="input"
              name="defaultMarginPercent"
              type="number"
              step="0.001"
              min="0"
              defaultValue={editing?.defaultMarginPercent?.toString() ?? "15"}
            />
          </div>
          <div className="col-span-2">
            <label className="label">Opmerkingen</label>
            <textarea className="input" name="notes" rows={2} defaultValue={editing?.notes ?? ""} />
          </div>

          <div className="col-span-2 flex gap-2">
            <button className="btn-primary" type="submit">
              {editing ? "Opslaan" : "Klant toevoegen"}
            </button>
            {editing && (
              <a href="/customers" className="btn-secondary">
                Annuleren
              </a>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
