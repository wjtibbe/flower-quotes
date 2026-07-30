import Link from "next/link";
import { prisma } from "@/lib/db";
import { fmtMoney } from "@/lib/format";
import { variantLabel } from "@/lib/variantLabel";
import AssortmentTable, { type AssortmentRow } from "./AssortmentTable";
import ConfirmButton from "@/components/ConfirmButton";
import { addProductAlias, removeProductAlias, deleteVariant } from "./actions";
import { loadAssortmentPage } from "./assortmentQuery";
import { buildAssortmentPageHref } from "./assortmentPageLinks";
import { ALLOWED_PAGE_SIZES, parsePageParam, parsePageSizeParam } from "@/lib/pagination";

export const dynamic = "force-dynamic";

interface Filters {
  farmId?: string;
  product?: string;
  variety?: string;
  length?: string;
  box?: string;
  weight?: string;
  q?: string;
  page?: string;
  pageSize?: string;
  msg?: string;
  err?: string;
  created?: string;
  dup?: string;
  invalid?: string;
  unmatched?: string;
}

export default async function AssortmentPage({ searchParams }: { searchParams: Filters }) {
  const requestedPage = parsePageParam(searchParams.page);
  const pageSize = parsePageSizeParam(searchParams.pageSize);

  const [{ rows: profiles, pagination }, farms, variants, products, boxOptionRows, weightOptionRows] =
    await Promise.all([
      loadAssortmentPage(searchParams, requestedPage, pageSize),
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
      // Small, bounded-size lookups for the filter dropdowns (section D: not
      // one query per row) - independent of how many assortment rows exist.
      prisma.packagingWeightProfile.findMany({ distinct: ["boxType"], select: { boxType: true }, orderBy: { boxType: "asc" } }),
      prisma.packagingWeightProfile.findMany({ distinct: ["weightPerBoxKg"], select: { weightPerBoxKg: true } }),
    ]);

  const productOptions = products.map((p) => p.name);
  const boxOptions = boxOptionRows.map((r) => r.boxType);
  const weightOptions = weightOptionRows
    .map((r) => r.weightPerBoxKg.toString())
    .sort((a, b) => Number(a) - Number(b));
  const unlinkedVariants = variants.filter((v) => v._count.weightProfiles === 0);

  // Serialize the current page's rows to plain data for the client table (no
  // Decimal / Date instances cross the server->client boundary).
  const tableRows: AssortmentRow[] = profiles.map((p) => ({
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

  const pageLinkParams = { ...searchParams, pageSize: String(pagination.pageSize) };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Assortiment</h1>
          <p className="text-sm text-gray-500 mt-1">
            Centrale producten en per leverancier de verpakking, het doosgewicht en eventuele leverancierscode.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/products/new" className="btn-secondary py-1.5 px-3 text-sm">
            Product toevoegen
          </Link>
          <Link href="/products/bulk" className="btn-secondary py-1.5 px-3 text-sm">
            Bulk toevoegen
          </Link>
          <Link href="/farm-offers/manual" className="btn-secondary py-1.5 px-3 text-sm">
            + Handmatige aanbieding
          </Link>
        </div>
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
          <label className="label">Lengte (cm)</label>
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
        <div>
          <label className="label">Rijen per pagina</label>
          <select name="pageSize" defaultValue={String(pagination.pageSize)} className="input py-1 w-20">
            {ALLOWED_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-secondary">Filteren</button>
      </form>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{pagination.totalCount} assortimentregel(s) gevonden</span>
        <PaginationControls pagination={pagination} linkParams={pageLinkParams} />
      </div>

      <AssortmentTable rows={tableRows} farms={farmOptions} />

      <div className="flex justify-end">
        <PaginationControls pagination={pagination} linkParams={pageLinkParams} />
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

function PaginationControls({
  pagination,
  linkParams,
}: {
  pagination: { page: number; totalPages: number };
  linkParams: Filters;
}) {
  const { page, totalPages } = pagination;
  return (
    <div className="flex items-center gap-3 text-sm">
      {page <= 1 ? (
        <span className="text-gray-300">Vorige</span>
      ) : (
        <Link href={buildAssortmentPageHref(linkParams, page - 1)} className="text-brand-600 hover:underline">
          Vorige
        </Link>
      )}
      <span className="text-gray-500">
        Pagina {page} van {totalPages}
      </span>
      {page >= totalPages ? (
        <span className="text-gray-300">Volgende</span>
      ) : (
        <Link href={buildAssortmentPageHref(linkParams, page + 1)} className="text-brand-600 hover:underline">
          Volgende
        </Link>
      )}
    </div>
  );
}
