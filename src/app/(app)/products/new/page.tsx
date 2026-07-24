import Link from "next/link";
import { prisma } from "@/lib/db";
import { variantLabel } from "@/lib/variantLabel";
import { createCentralProduct, addSupplierLink } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Assortiment -> Product toevoegen: single-item creation, split off the
 * Overzicht page (Task 3C) so the overview stays a table, not a form page.
 * Reuses the SAME `createCentralProduct`/`addSupplierLink` server actions
 * unchanged - both already redirect back to `/products` on success (or, for
 * `addSupplierLink`, simply revalidate), so no action/redirect behavior
 * changes by moving these forms here.
 */
export default async function ProductNewPage() {
  const [farms, variants] = await Promise.all([
    prisma.farm.findMany({ orderBy: { name: "asc" } }),
    prisma.productVariant.findMany({
      include: { product: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <Link href="/products" className="text-sm text-brand-600 hover:underline">
          ← Assortiment overzicht
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">Product toevoegen</h1>
        <p className="text-sm text-gray-500 mt-1">
          Maak een nieuw centraal product aan, of koppel een leverancier aan een bestaand product.
        </p>
      </div>

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
  );
}
