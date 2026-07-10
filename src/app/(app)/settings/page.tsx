import { prisma } from "@/lib/db";
import { addUser, toggleUserActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Instellingen</h1>
      </div>

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
              <th>Status</th>
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
                  <span className={u.active ? "badge-high" : "badge-low"}>{u.active ? "actief" : "inactief"}</span>
                </td>
                <td>
                  <form action={toggleUserActive.bind(null, u.id, u.active)}>
                    <button className="text-xs text-gray-500 hover:underline">
                      {u.active ? "Deactiveren" : "Activeren"}
                    </button>
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
    </div>
  );
}
