import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { saveWeightProfile, toggleWeightProfileActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function WeightProfilesPage({ searchParams }: { searchParams: { edit?: string } }) {
  const [profiles, farms, variants] = await Promise.all([
    prisma.packagingWeightProfile.findMany({
      orderBy: { createdAt: "desc" },
      include: { farm: true, productVariant: { include: { product: true } } },
    }),
    prisma.farm.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.productVariant.findMany({
      where: { active: true },
      include: { product: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const editing = searchParams.edit ? profiles.find((p) => p.id === searchParams.edit) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Gewichtsprofielen</h1>
        <p className="text-sm text-gray-500 mt-1">
          Boxgewicht per farm, product, boxtype en aantal stelen - gebruikt om vracht per steel te berekenen.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Farm</th>
              <th>Product</th>
              <th>Box</th>
              <th>Stelen/doos</th>
              <th>Gewicht/doos</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id}>
                <td>{p.farm.name}</td>
                <td>
                  {p.productVariant.product.name}
                  {p.productVariant.color ? ` - ${p.productVariant.color}` : ""}
                  {p.productVariant.grade ? ` - ${p.productVariant.grade}` : ""}
                </td>
                <td>{p.boxType}</td>
                <td>{p.stemsPerBox}</td>
                <td>{fmtMoney(p.weightPerBoxKg, 3)} kg</td>
                <td>
                  <span className={p.active ? "badge-high" : "badge-low"}>{p.active ? "actief" : "inactief"}</span>
                </td>
                <td className="whitespace-nowrap">
                  <a href={`/weight-profiles?edit=${p.id}`} className="text-brand-600 hover:underline text-xs mr-3">
                    Bewerken
                  </a>
                  <form action={toggleWeightProfileActive.bind(null, p.id, p.active)} className="inline">
                    <button className="text-xs text-gray-500 hover:underline">
                      {p.active ? "Deactiveren" : "Activeren"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-6">
                  Nog geen gewichtsprofielen.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card p-6 max-w-2xl">
        <h2 className="font-semibold text-gray-800 mb-4">{editing ? "Gewichtsprofiel bewerken" : "Nieuw gewichtsprofiel"}</h2>
        <form action={saveWeightProfile} key={editing?.id ?? "new"} className="grid grid-cols-2 gap-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div>
            <label className="label">Farm *</label>
            <select className="input" name="farmId" required defaultValue={editing?.farmId ?? ""}>
              <option value="">Kies farm...</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Product *</label>
            <select className="input" name="productVariantId" required defaultValue={editing?.productVariantId ?? ""}>
              <option value="">Kies product...</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.product.name}
                  {v.color ? ` - ${v.color}` : ""}
                  {v.grade ? ` - ${v.grade}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Box type</label>
            <input className="input" name="boxType" defaultValue={editing?.boxType ?? "QB"} />
          </div>
          <div>
            <label className="label">Stelen per doos *</label>
            <input className="input" type="number" name="stemsPerBox" required defaultValue={editing?.stemsPerBox} />
          </div>
          <div>
            <label className="label">Gewicht per doos (kg) *</label>
            <input
              className="input"
              type="number"
              step="0.001"
              name="weightPerBoxKg"
              required
              defaultValue={editing?.weightPerBoxKg?.toString()}
            />
          </div>
          <div className="col-span-2">
            <label className="label">Opmerkingen</label>
            <textarea className="input" name="notes" rows={2} defaultValue={editing?.notes ?? ""} />
          </div>
          <div className="col-span-2 flex gap-2">
            <button className="btn-primary" type="submit">
              {editing ? "Opslaan" : "Profiel toevoegen"}
            </button>
            {editing && (
              <a href="/weight-profiles" className="btn-secondary">
                Annuleren
              </a>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
