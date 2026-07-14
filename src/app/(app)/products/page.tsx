import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { variantLabel } from "@/lib/variantLabel";
import {
  createCentralProduct,
  addSupplierLink,
  updateSupplierLink,
  duplicateSupplierLink,
  toggleSupplierLinkActive,
  addProductAlias,
  removeProductAlias,
  toggleVariantActive,
} from "./actions";

export const dynamic = "force-dynamic";

interface Filters {
  farmId?: string;
  product?: string;
  variety?: string;
  length?: string;
  box?: string;
  weight?: string;
  status?: string;
  q?: string;
  msg?: string;
}

export default async function AssortmentPage({ searchParams }: { searchParams: Filters }) {
  const [profiles, farms, variants, products] = await Promise.all([
    prisma.packagingWeightProfile.findMany({
      include: { farm: true, productVariant: { include: { product: true } } },
      orderBy: [{ createdAt: "asc" }],
    }),
    prisma.farm.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.productVariant.findMany({
      where: { active: true },
      include: { product: true, weightProfiles: { where: { active: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      include: { aliases: true, variants: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  const status = searchParams.status ?? "active";
  const contains = (haystack: string | null | undefined, needle: string) =>
    (haystack ?? "").toLowerCase().includes(needle.toLowerCase());

  const rows = profiles.filter((p) => {
    const v = p.productVariant;
    if (status === "active" && !p.active) return false;
    if (status === "inactive" && p.active) return false;
    if (searchParams.farmId && p.farmId !== searchParams.farmId) return false;
    if (searchParams.product && v.product.name !== searchParams.product) return false;
    if (searchParams.variety && !contains(v.variety, searchParams.variety)) return false;
    if (searchParams.length && !contains(v.stemLength, searchParams.length)) return false;
    if (searchParams.box && p.boxType !== searchParams.box) return false;
    if (searchParams.weight && p.weightPerBoxKg.toString() !== searchParams.weight) return false;
    if (searchParams.q) {
      const target = [
        p.farm.name,
        v.product.name,
        v.variety,
        v.stemLength,
        v.color,
        v.grade,
        p.boxType,
        p.supplierCode,
        p.notes,
      ]
        .filter(Boolean)
        .join(" ");
      if (!contains(target, searchParams.q)) return false;
    }
    return true;
  });

  const productOptions = [...new Set(profiles.map((p) => p.productVariant.product.name))].sort();
  const boxOptions = [...new Set(profiles.map((p) => p.boxType))].sort();
  const weightOptions = [...new Set(profiles.map((p) => p.weightPerBoxKg.toString()))].sort(
    (a, b) => Number(a) - Number(b),
  );
  const unlinkedVariants = variants.filter((v) => v.weightProfiles.length === 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Assortiment</h1>
        <p className="text-sm text-gray-500 mt-1">
          Centrale producten en per leverancier de verpakking, het doosgewicht en eventuele leverancierscode.
        </p>
      </div>

      {searchParams.msg === "created" && (
        <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">Centraal product aangemaakt.</div>
      )}
      {searchParams.msg === "exists" && (
        <div className="card p-3 bg-amber-50 border-amber-200 text-sm text-amber-800">
          Dit centrale product bestaat al - er is geen duplicaat aangemaakt.
        </div>
      )}

      <form className="card p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Leverancier</label>
          <select name="farmId" defaultValue={searchParams.farmId ?? ""} className="input py-1">
            <option value="">Alle</option>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Product</label>
          <select name="product" defaultValue={searchParams.product ?? ""} className="input py-1">
            <option value="">Alle</option>
            {productOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Variety</label>
          <input name="variety" defaultValue={searchParams.variety ?? ""} className="input py-1 w-32" />
        </div>
        <div>
          <label className="label">Lengte</label>
          <input name="length" defaultValue={searchParams.length ?? ""} className="input py-1 w-24" />
        </div>
        <div>
          <label className="label">Box</label>
          <select name="box" defaultValue={searchParams.box ?? ""} className="input py-1 w-20">
            <option value="">Alle</option>
            {boxOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Doosgewicht</label>
          <select name="weight" defaultValue={searchParams.weight ?? ""} className="input py-1 w-28">
            <option value="">Alle</option>
            {weightOptions.map((w) => (
              <option key={w} value={w}>
                {fmtMoney(w, 3)} kg
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select name="status" defaultValue={status} className="input py-1 w-28">
            <option value="active">Actief</option>
            <option value="inactive">Inactief</option>
            <option value="all">Alle</option>
          </select>
        </div>
        <div className="flex-1 min-w-40">
          <label className="label">Zoeken</label>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Vrij zoeken..." className="input py-1" />
        </div>
        <button className="btn-secondary">Filteren</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Leverancier</th>
              <th>Product</th>
              <th>Variety</th>
              <th>Lengte</th>
              <th>Box/verpakking</th>
              <th>Doosgewicht</th>
              <th>Aantekeningen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const v = p.productVariant;
              return (
                <tr key={p.id} className={p.active ? "" : "opacity-50"}>
                  <td className="font-medium">
                    {p.farm.name}
                    {p.supplierCode && <span className="ml-1 text-xs text-gray-400">({p.supplierCode})</span>}
                  </td>
                  <td>
                    {v.product.name}
                    {(v.color || v.grade) && (
                      <span className="text-xs text-gray-400"> {[v.color, v.grade].filter(Boolean).join(" ")}</span>
                    )}
                  </td>
                  <td>{v.variety ?? "-"}</td>
                  <td>{v.stemLength ?? "-"}</td>
                  <td>
                    {p.boxType} <span className="text-xs text-gray-400">({p.stemsPerBox} st)</span>
                  </td>
                  <td>{fmtMoney(p.weightPerBoxKg, 3)} kg</td>
                  <td className="max-w-48 truncate" title={p.notes ?? ""}>
                    {p.notes ?? "-"}
                  </td>
                  <td className="whitespace-nowrap">
                    <details className="inline-block mr-3">
                      <summary className="text-xs text-brand-600 cursor-pointer inline">Bewerken</summary>
                      <form
                        action={updateSupplierLink.bind(null, p.id)}
                        className="mt-2 flex flex-wrap gap-2 items-end bg-gray-50 p-2 rounded"
                      >
                        <div>
                          <label className="label">Leverancier</label>
                          <select name="farmId" defaultValue={p.farmId} className="input py-1 text-xs">
                            {farms.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">Code</label>
                          <input name="supplierCode" defaultValue={p.supplierCode ?? ""} className="input py-1 text-xs w-24" />
                        </div>
                        <div>
                          <label className="label">Box</label>
                          <input name="boxType" defaultValue={p.boxType} className="input py-1 text-xs w-16" />
                        </div>
                        <div>
                          <label className="label">Stelen/doos</label>
                          <input name="stemsPerBox" type="number" required defaultValue={p.stemsPerBox} className="input py-1 text-xs w-20" />
                        </div>
                        <div>
                          <label className="label">Gewicht (kg)</label>
                          <input
                            name="weightPerBoxKg"
                            type="number"
                            step="0.001"
                            required
                            defaultValue={p.weightPerBoxKg.toString()}
                            className="input py-1 text-xs w-24"
                          />
                        </div>
                        <div>
                          <label className="label">Aantekeningen</label>
                          <input name="notes" defaultValue={p.notes ?? ""} className="input py-1 text-xs w-40" />
                        </div>
                        <button className="btn-primary py-1 px-2 text-xs">Opslaan</button>
                      </form>
                    </details>
                    <details className="inline-block mr-3">
                      <summary className="text-xs text-brand-600 cursor-pointer inline">Dupliceren</summary>
                      <form
                        action={duplicateSupplierLink.bind(null, p.id)}
                        className="mt-2 flex gap-2 items-end bg-gray-50 p-2 rounded"
                      >
                        <div>
                          <label className="label">Naar leverancier</label>
                          <select name="farmId" className="input py-1 text-xs" defaultValue="">
                            <option value="" disabled>
                              Kies leverancier...
                            </option>
                            {farms.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button className="btn-secondary py-1 px-2 text-xs">Kopie maken</button>
                      </form>
                    </details>
                    <form action={toggleSupplierLinkActive.bind(null, p.id, p.active)} className="inline">
                      <button className="text-xs text-gray-500 hover:underline">
                        {p.active ? "Deactiveren" : "Activeren"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-6">
                  Geen leverancierskoppelingen gevonden met deze filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Nieuw centraal product</h2>
          <form action={createCentralProduct} className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Product *</label>
              <input className="input" name="name" required placeholder="bv. Rose" />
            </div>
            <div>
              <label className="label">Productgroep (optioneel)</label>
              <input className="input" name="productGroup" placeholder="standaard gelijk aan product" />
            </div>
            <div>
              <label className="label">Variety</label>
              <input className="input" name="variety" placeholder="bv. Freedom" />
            </div>
            <div>
              <label className="label">Lengte</label>
              <input className="input" name="stemLength" placeholder="bv. 60 cm" />
            </div>
            <div className="col-span-2">
              <button className="btn-primary" type="submit">
                Product toevoegen
              </button>
            </div>
          </form>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-800 mb-4">Leverancier koppelen aan bestaand product</h2>
          <form action={addSupplierLink} className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Centraal product *</label>
              <select className="input" name="productVariantId" required defaultValue="">
                <option value="" disabled>
                  Kies product...
                </option>
                {variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {variantLabel(v, v.product.name)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Leverancier *</label>
              <select className="input" name="farmId" required defaultValue="">
                <option value="" disabled>
                  Kies leverancier...
                </option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Leverancierscode</label>
              <input className="input" name="supplierCode" />
            </div>
            <div>
              <label className="label">Box/verpakking</label>
              <input className="input" name="boxType" defaultValue="QB" />
            </div>
            <div>
              <label className="label">Stelen per doos *</label>
              <input className="input" type="number" name="stemsPerBox" required />
            </div>
            <div>
              <label className="label">Doosgewicht (kg) *</label>
              <input className="input" type="number" step="0.001" name="weightPerBoxKg" required />
            </div>
            <div>
              <label className="label">Aantekeningen</label>
              <input className="input" name="notes" />
            </div>
            <div className="col-span-2">
              <button className="btn-primary" type="submit">
                Koppeling toevoegen
              </button>
            </div>
          </form>
        </div>
      </div>

      {unlinkedVariants.length > 0 && (
        <div className="card p-4">
          <h2 className="font-semibold text-gray-800 mb-2">Centrale producten zonder leverancierskoppeling</h2>
          <ul className="text-sm text-gray-600 space-y-1">
            {unlinkedVariants.map((v) => (
              <li key={v.id}>
                {variantLabel(v, v.product.name)}
                <span className="ml-2 text-xs text-amber-600">koppel hierboven een leverancier</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="card p-4">
        <summary className="font-semibold text-gray-800 cursor-pointer">
          Centrale producten &amp; aliassen (beheer voor de import-herkenning)
        </summary>
        <div className="space-y-4 mt-4">
          {products.map((product) => (
            <div key={product.id} className="border-t border-gray-100 pt-3">
              <div className="font-medium text-gray-900">
                {product.name} <span className="text-xs text-gray-400">({product.productGroup})</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {product.aliases.map((a) => (
                  <span key={a.id} className="badge bg-gray-100 text-gray-700">
                    {a.alias}
                    <form action={removeProductAlias.bind(null, a.id)} className="inline">
                      <button className="ml-1 text-gray-400 hover:text-red-600">×</button>
                    </form>
                  </span>
                ))}
                <form action={addProductAlias.bind(null, product.id)} className="flex items-center gap-1">
                  <input name="alias" placeholder="+ alias" className="input py-1 px-2 text-xs w-28" />
                  <button className="text-xs text-brand-600 hover:underline">Toevoegen</button>
                </form>
              </div>
              <ul className="mt-2 text-xs text-gray-500 space-y-0.5">
                {product.variants.map((v) => (
                  <li key={v.id} className={v.active ? "" : "line-through opacity-60"}>
                    {variantLabel(v, product.name)}
                    {v.treatment && v.treatment !== "normal" ? ` (${v.treatment})` : ""}
                    <form action={toggleVariantActive.bind(null, v.id, v.active)} className="inline ml-2">
                      <button className="text-gray-400 hover:underline">{v.active ? "deactiveren" : "activeren"}</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
