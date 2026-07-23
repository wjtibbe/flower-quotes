import { prisma } from "@/lib/db";
import { loadFarmAssortmentCandidates } from "@/lib/import/matching/assortmentRepository";
import { toAssortmentOption } from "../[id]/review/buildOfferLineViewModel";
import { MappingsTable, type MappingRow } from "./MappingsTable";

export const dynamic = "force-dynamic";

/**
 * Supplier mapping management (supplier-mapping step, sections 14-19): a
 * simple list/edit/delete screen for the explicit, per-supplier mappings
 * saved from the review screen. No fuzzy search, no bulk actions, no
 * deactivate - real delete only, matching the rest of this app.
 */
export default async function SupplierMappingsPage({
  searchParams,
}: {
  searchParams: { farmId?: string; q?: string };
}) {
  const farms = await prisma.farm.findMany({ orderBy: { name: "asc" } });

  const q = (searchParams.q ?? "").trim();
  const mappings = await prisma.supplierLineMapping.findMany({
    where: {
      farmId: searchParams.farmId || undefined,
      ...(q
        ? {
            OR: [
              { rawSource: { contains: q, mode: "insensitive" as const } },
              { normalizedSource: { contains: q.toLowerCase(), mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      farm: true,
      createdBy: true,
      packagingWeightProfile: { include: { productVariant: { include: { product: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  // The edit modal needs each mapping's own farm's assortment to pick a new
  // target from - loaded once per DISTINCT farm present on this page, never
  // once per mapping row (section 36: no N+1).
  const distinctFarmIds = [...new Set(mappings.map((m) => m.farmId))];
  const candidateEntries = await Promise.all(
    distinctFarmIds.map(async (farmId) => [farmId, await loadFarmAssortmentCandidates(farmId)] as const),
  );
  const candidatesByFarmId = new Map(candidateEntries);

  const rows: MappingRow[] = mappings.map((m) => ({
    id: m.id,
    farmId: m.farmId,
    farmName: m.farm.name,
    rawSource: m.rawSource,
    packagingWeightProfileId: m.packagingWeightProfileId,
    target: {
      productName: m.packagingWeightProfile.productVariant.product.name,
      variety: m.packagingWeightProfile.productVariant.variety,
      stemLength: m.packagingWeightProfile.productVariant.stemLength,
      boxType: m.packagingWeightProfile.boxType,
      stemsPerBox: m.packagingWeightProfile.stemsPerBox,
      weightPerBoxKg: m.packagingWeightProfile.weightPerBoxKg.toString(),
    },
    timesUsed: m.timesUsed,
    lastUsedAt: m.lastUsedAt ? m.lastUsedAt.toISOString() : null,
    createdByName: m.createdBy.name,
    createdAt: m.createdAt.toISOString(),
    candidateOptions: (candidatesByFarmId.get(m.farmId) ?? []).map(toAssortmentOption),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Supplier mappings</h1>
        <p className="text-sm text-gray-500 mt-1">
          Expliciete, per-leverancier koppelingen: wanneer deze leverancier deze exacte tekst schrijft, wordt dit
          assortimentartikel direct gebruikt bij een volgende import - vóór automatische matching.
        </p>
      </div>

      <form className="flex gap-3 items-end">
        <div>
          <label className="label">Supplier</label>
          <select name="farmId" className="input" defaultValue={searchParams.farmId ?? ""}>
            <option value="">Alle leveranciers</option>
            {farms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Zoeken</label>
          <input className="input" name="q" placeholder="Brontekst..." defaultValue={searchParams.q ?? ""} />
        </div>
        <button className="btn-secondary" type="submit">
          Filteren
        </button>
      </form>

      <MappingsTable rows={rows} />
    </div>
  );
}
