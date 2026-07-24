import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolvePagination, type ResolvedPagination } from "@/lib/pagination";

/** The Assortiment overview's filter/search query params (same shape as the page's `searchParams`). */
export interface AssortmentFilters {
  farmId?: string;
  product?: string;
  variety?: string;
  length?: string;
  box?: string;
  weight?: string;
  q?: string;
}

/**
 * Builds the Prisma `where` clause for the Assortiment overview from the
 * current filters - pure (no I/O) so it's directly testable. Search/filter
 * criteria are applied HERE, at the database level, so they run over the
 * FULL result set rather than only whatever page happens to already be
 * loaded (section C5) - a match on row 240 is still found even though it
 * isn't on page 1.
 */
export function buildAssortmentWhere(filters: AssortmentFilters): Prisma.PackagingWeightProfileWhereInput {
  const productVariant: Prisma.ProductVariantWhereInput = {};
  if (filters.product) productVariant.product = { name: filters.product };
  if (filters.variety) productVariant.variety = { contains: filters.variety, mode: "insensitive" };
  if (filters.length) productVariant.stemLength = { contains: filters.length, mode: "insensitive" };

  const where: Prisma.PackagingWeightProfileWhereInput = {};
  if (filters.farmId) where.farmId = filters.farmId;
  if (filters.box) where.boxType = filters.box;
  if (filters.weight) where.weightPerBoxKg = filters.weight;
  if (Object.keys(productVariant).length > 0) where.productVariant = productVariant;

  if (filters.q) {
    const q = filters.q;
    where.OR = [
      { farm: { name: { contains: q, mode: "insensitive" } } },
      { boxType: { contains: q, mode: "insensitive" } },
      { supplierCode: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
      { productVariant: { product: { name: { contains: q, mode: "insensitive" } } } },
      { productVariant: { variety: { contains: q, mode: "insensitive" } } },
      { productVariant: { stemLength: { contains: q, mode: "insensitive" } } },
      { productVariant: { color: { contains: q, mode: "insensitive" } } },
      { productVariant: { grade: { contains: q, mode: "insensitive" } } },
    ];
  }

  return where;
}

// Deterministic ordering (section C7): `createdAt` alone is not guaranteed
// unique (bulk-created rows can share the same millisecond timestamp), so a
// stable `id` tie-breaker is added - rows never randomly reorder between
// pages.
const ASSORTMENT_ORDER_BY: Prisma.PackagingWeightProfileOrderByWithRelationInput[] = [
  { createdAt: "asc" },
  { id: "asc" },
];

const ASSORTMENT_INCLUDE = { farm: true, productVariant: { include: { product: true } } } as const;

export type AssortmentProfileRow = Prisma.PackagingWeightProfileGetPayload<{ include: typeof ASSORTMENT_INCLUDE }>;

export interface AssortmentPage {
  rows: AssortmentProfileRow[];
  pagination: ResolvedPagination;
}

/**
 * Loads exactly one page of the Assortiment overview (section D: one count
 * query + one paginated data query, never the full table). The count and
 * effective page are resolved BEFORE the data query so an out-of-range page
 * (e.g. a filter narrowed the result set) is served from page 1 instead of
 * an empty page (section C6).
 */
export async function loadAssortmentPage(
  filters: AssortmentFilters,
  requestedPage: number,
  pageSize: number,
): Promise<AssortmentPage> {
  const where = buildAssortmentWhere(filters);
  const totalCount = await prisma.packagingWeightProfile.count({ where });
  const pagination = resolvePagination(requestedPage, pageSize, totalCount);

  const rows = await prisma.packagingWeightProfile.findMany({
    where,
    include: ASSORTMENT_INCLUDE,
    orderBy: ASSORTMENT_ORDER_BY,
    skip: pagination.skip,
    take: pagination.take,
  });

  return { rows, pagination };
}
