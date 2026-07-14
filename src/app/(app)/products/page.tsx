import { prisma } from "@/lib/db";
import {
  createProduct,
  toggleProductActive,
  addProductAlias,
  removeProductAlias,
  addProductVariant,
  toggleVariantActive,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await prisma.product.findMany({
    orderBy: { name: "asc" },
    include: { aliases: true, variants: { orderBy: { createdAt: "asc" } } },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Assortiment</h1>
        <p className="text-sm text-gray-500 mt-1">
          Centrale producten met variëteit/kleur/kwaliteit-varianten en bekende aliassen van leveranciers.
        </p>
      </div>

      <div className="space-y-4">
        {products.map((product) => (
          <div key={product.id} className="card p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-medium text-gray-900">{product.name}</div>
                <div className="text-xs text-gray-500">{product.productGroup}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={product.active ? "badge-high" : "badge-low"}>
                  {product.active ? "actief" : "inactief"}
                </span>
                <form action={toggleProductActive.bind(null, product.id, product.active)}>
                  <button className="text-xs text-gray-500 hover:underline">
                    {product.active ? "Deactiveren" : "Activeren"}
                  </button>
                </form>
              </div>
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

            <table className="table-base mt-3">
              <thead>
                <tr>
                  <th>Variëteit</th>
                  <th>Kleur</th>
                  <th>Kwaliteit</th>
                  <th>Behandeling</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {product.variants.map((variant) => (
                  <tr key={variant.id}>
                    <td>{variant.variety ?? "-"}</td>
                    <td>{variant.color ?? "-"}</td>
                    <td>{variant.grade ?? "-"}</td>
                    <td>{variant.treatment ?? "-"}</td>
                    <td>
                      <span className={variant.active ? "badge-high" : "badge-low"}>
                        {variant.active ? "actief" : "inactief"}
                      </span>
                    </td>
                    <td>
                      <form action={toggleVariantActive.bind(null, variant.id, variant.active)}>
                        <button className="text-xs text-gray-500 hover:underline">
                          {variant.active ? "Deactiveren" : "Activeren"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <form action={addProductVariant.bind(null, product.id)} className="mt-3 flex flex-wrap gap-2 items-end">
              <div>
                <label className="label">Variëteit</label>
                <input name="variety" className="input py-1 px-2 text-xs w-28" />
              </div>
              <div>
                <label className="label">Kleur</label>
                <input name="color" className="input py-1 px-2 text-xs w-28" />
              </div>
              <div>
                <label className="label">Kwaliteit</label>
                <input name="grade" className="input py-1 px-2 text-xs w-24" />
              </div>
              <div>
                <label className="label">Behandeling</label>
                <input name="treatment" className="input py-1 px-2 text-xs w-24" />
              </div>
              <button className="btn-secondary py-1 px-2 text-xs">+ Variant</button>
            </form>
          </div>
        ))}
      </div>

      <div className="card p-6 max-w-lg">
        <h2 className="font-semibold text-gray-800 mb-4">Nieuw centraal product</h2>
        <form action={createProduct} className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Productgroep *</label>
            <input className="input" name="productGroup" required placeholder="bv. Hydrangea" />
          </div>
          <div>
            <label className="label">Naam *</label>
            <input className="input" name="name" required placeholder="bv. Hydrangea" />
          </div>
          <div className="col-span-2">
            <button className="btn-primary" type="submit">
              Product toevoegen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
