import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { variantLabel } from "@/lib/variantLabel";
import AssortmentTable, { type AssortmentRow } from "./AssortmentTable";
import ConfirmButton from "@/components/ConfirmButton";
import {
  createCentralProduct,
  bulkAddAssortment,
  bulkAddAssortmentMultiSupplier,
  addSupplierLink,
  addProductAlias,
  removeProductAlias,
  deleteVariant,
} from "./actions";

export const dynamic = "force-dynamic";

interface Filters {
  farmId?: string;
  product?: string;
  variety?: string;
  length?: string;
  box?: string;
  weight?: string;
  q?: string;
  msg?: string;
  err?: string;
  created?: string;
  dup?: string;
  invalid?: string;
  unmatched?: string;
}

export default async function AssortmentPage({ searchParams }: { searchParams: Filters }) {
  const [profiles, farms, variants, products] = await Promise.all([
    prisma.packagingWeightProfile.findMany({
      include: { farm: true, productVariant: { include: { product: true } } },
      orderBy: [{ createdAt: "asc" }],
    }),
    prisma.farm.findMany({ orderBy: { name: "asc" } }),
    prisma.productVariant.findMany({
      // _count instead of loading every link row again (the full weightProfiles
      // are only needed to know which variants are unlinked); much lighter with
      // a large assortment.
      include: { product: true, _count: { select: { weightProfiles: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.product.findMany({
      orderBy: { name: "asc" },
      include: { aliases: true, variants: { orderBy: { createdAt: "asc" } } },
    }),
  ]);

  const contains = (haystack: string | null | undefined, needle: string) =>
    (haystack ?? "").toLowerCase().includes(needle.toLowerCase());

  const rows = profiles.filter((p) => {
    const v = p.productVariant;
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
  const unlinkedVariants = variants.filter((v) => v._count.weightProfiles === 0);

  // Cap how many rows the interactive client table renders. With a large
  // assortment (many thousands of supplier links) rendering every row as a
  // checkbox row makes the page unresponsive; the filters above narrow the set,
  // and this keeps the page snappy meanwhile.
  const RENDER_LIMIT = 500;
  const totalRows = rows.length;
  const cappedRows = rows.slice(0, RENDER_LIMIT);

  // Serialize the filtered rows to plain data for the client table (no Decimal
  // / Date instances cross the server->client boundary).
  const tableRows: AssortmentRow[] = cappedRows.map((p) => ({
    id: p.id,
    farmId: p.farmId,
    farmName: p.farm.name,
    supplierCode: p.supplierCode,
    productName: p.productVariant.product.name,
    color: p.productVariant.color,
    grade: p.productVariant.grade,
    variety: p.productVariant.variety,
    stemLength: p.productVariant.stemLength,
    boxType: p.boxType,
    stemsPerBox: p.stemsPerBox,
    weightPerBoxKg: p.weightPerBoxKg.toString(),
    notes: p.notes,
  }));
  const farmOptions = farms.map((f) => ({ id: f.id, name: f.name }));

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
      {searchParams.msg === "bulk" && (
        <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">
          {searchParams.created ?? 0} regel(s) toegevoegd
          {Number(searchParams.dup) > 0 && `, ${searchParams.dup} al aanwezig (overgeslagen)`}
          {Number(searchParams.invalid) > 0 && `, ${searchParams.invalid} regel(s) ongeldig (overgeslagen)`}.
        </div>
      )}
      {searchParams.msg === "multibulk" && (
        <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">
          {searchParams.created ?? 0} regel(s) toegevoegd
          {Number(searchParams.dup) > 0 && `, ${searchParams.dup} al aanwezig (overgeslagen)`}
          {Number(searchParams.invalid) > 0 && `, ${searchParams.invalid} regel(s) ongeldig (overgeslagen)`}.
          {searchParams.unmatched && (
            <span className="block mt-1 text-amber-700">
              Niet-herkende leverancier(s), regels overgeslagen: {searchParams.unmatched}. Controleer of deze
              leveranciers bestaan (of de naam overeenkomt) en plak opnieuw.
            </span>
          )}
        </div>
      )}
      {searchParams.msg === "variant-deleted" && (
        <div className="card p-3 bg-green-50 border-green-200 text-sm text-green-800">Product verwijderd.</div>
      )}
      {searchParams.err && (
        <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-800">{searchParams.err}</div>
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
        <div className="flex-1 min-w-40">
          <label className="label">Zoeken</label>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Vrij zoeken..." className="input py-1" />
        </div>
        <button className="btn-secondary">Filteren</button>
      </form>

      {totalRows > RENDER_LIMIT && (
        <div className="card p-3 bg-amber-50 border-amber-200 text-sm text-amber-800">
          {totalRows} regels gevonden; de eerste {RENDER_LIMIT} worden getoond. Gebruik de filters hierboven om te
          verfijnen.
        </div>
      )}
      <AssortmentTable rows={tableRows} farms={farmOptions} />

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
                  <li key={v.id}>
                    {variantLabel(v, product.name)}
                    {v.treatment && v.treatment !== "normal" ? ` (${v.treatment})` : ""}
                    <form action={deleteVariant.bind(null, v.id)} className="inline ml-2">
                      <ConfirmButton
                        message={`Weet je zeker dat je "${variantLabel(v, product.name)}" wilt verwijderen? Dit kan niet ongedaan worden gemaakt.`}
                        className="text-red-600 hover:underline"
                      >
                        verwijderen
                      </ConfirmButton>
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
