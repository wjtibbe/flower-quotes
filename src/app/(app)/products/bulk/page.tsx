import Link from "next/link";
import { prisma } from "@/lib/db";
import { bulkAddAssortment, bulkAddAssortmentMultiSupplier } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Assortiment -> Bulk toevoegen: the two ASSORTMENT bulk-paste tools (many
 * varieties for one supplier, or many varieties across several suppliers in
 * one paste), split off the Overzicht page (Task 3D). Supplier bulk import
 * (creating new Farm rows) is a separate module - see Leveranciers -> Bulk
 * import. Reuses the SAME `bulkAddAssortment`/`bulkAddAssortmentMultiSupplier`
 * server actions unchanged; both already redirect to `/products` on success,
 * so the success/error banners still render there exactly as before.
 */
export default async function ProductBulkPage() {
  const [farms, products] = await Promise.all([
    prisma.farm.findMany({ orderBy: { name: "asc" } }),
    prisma.product.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <Link href="/products" className="text-sm text-brand-600 hover:underline">
          ← Assortiment overzicht
        </Link>
        <h1 className="text-2xl font-semibold text-gray-900 mt-1">Bulk toevoegen</h1>
        <p className="text-sm text-gray-500 mt-1">
          Meerdere assortimentregels tegelijk toevoegen door een lijst te plakken.
        </p>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-gray-800 mb-1">Meerdere regels tegelijk toevoegen (plakken)</h2>
        <p className="text-sm text-gray-500 mb-4">
          Handig bij een prijslijst van een leverancier met veel variëteiten (bv. een hydrangea-assortiment). Kies
          hieronder eenmalig het centrale product, de leverancier en de lengte, en plak daarna één regel per
          variëteit: <code className="text-xs bg-gray-100 px-1 rounded">Omschrijving</code> gevolgd door{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">stelen per doos</code> (gescheiden door een Tab of komma
          - zoals bij plakken vanuit Excel). Optioneel kun je per regel ook nog doostype, doosgewicht,
          leverancierscode en lengte toevoegen om de standaardwaarden hieronder te overschrijven. Opnieuw plakken van
          dezelfde lijst maakt geen duplicaten aan.
        </p>
        <form action={bulkAddAssortment} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="label">Centraal product *</label>
              <input className="input" name="productName" required list="bulkProductNames" placeholder="bv. Hydrangea" />
              <datalist id="bulkProductNames">
                {products.map((p) => (
                  <option key={p.id} value={p.name} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="label">Productgroep (optioneel)</label>
              <input className="input" name="productGroup" placeholder="standaard gelijk aan product" />
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
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="label">Doostype (standaard)</label>
                <input className="input" name="boxType" defaultValue="QB" />
              </div>
              <div>
                <label className="label">Doosgewicht kg (standaard) *</label>
                <input className="input" type="number" step="0.001" name="weightPerBoxKg" required />
              </div>
              <div>
                <label className="label">Lengte (standaard)</label>
                <input className="input" name="stemLength" placeholder="bv. 70cm" />
              </div>
            </div>
          </div>
          <div>
            <label className="label">Regels (één per variëteit)</label>
            <textarea
              className="input font-mono text-xs"
              name="rows"
              rows={8}
              required
              placeholder={"White Select 15/16cm\t40\nWhite Premium 18/20cm\t30\nWhite Jumbo 22+\t20"}
            />
          </div>
          <button className="btn-primary" type="submit">
            Regels toevoegen
          </button>
        </form>
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-gray-800 mb-1">
          Meerdere leveranciers tegelijk importeren (plakken met leverancier-kolom)
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Handig voor een complete lijst die meerdere leveranciers omvat - plak in één keer. Plak per regel exact deze
          zes kolommen (gescheiden door een Tab, zoals uit Excel):{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">Leverancier</code>,{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">Inkoop Artikel</code>,{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">Lengte</code>,{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">Doos</code>,{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">Stelen per doos</code>,{" "}
          <code className="text-xs bg-gray-100 px-1 rounded">KG per doos</code>. De leverancier wordt gezocht bij een
          bestaande leverancier (kleine naamsverschillen zoals &quot;S.A.S.&quot; worden genegeerd); onbekende
          leveranciers worden overgeslagen en gemeld. Het artikel wordt gesplitst in centraal product + variety
          (&quot;Dianthus St Bridal Damascus&quot; → product <em>Dianthus St</em>, variety <em>Bridal Damascus</em>;
          &quot;Rosa Ec Absolut in Pink&quot; → product <em>Rosa Ec</em>, variety <em>Absolut in Pink</em>). Een
          kopregel en het opnieuw plakken van dezelfde lijst maken geen duplicaten aan.
        </p>
        <form action={bulkAddAssortmentMultiSupplier} className="space-y-4">
          <div>
            <label className="label">Regels (één per variëteit, mét leverancier-kolom)</label>
            <textarea
              className="input font-mono text-xs"
              name="rows"
              rows={8}
              required
              placeholder={
                "C.I Flores de Aposentos\tDianthus St Bridal Damascus\t50\tQB\t280\t7.8\nCOLIBRI FLOWERS.S.A\tDianthus Sp Athena\t60\tQB\t260\t7.8"
              }
            />
          </div>
          <button className="btn-primary" type="submit">
            Importeren
          </button>
        </form>
      </div>
    </div>
  );
}
