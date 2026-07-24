import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockCount = vi.fn();
const mockFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    packagingWeightProfile: {
      count: (...a: unknown[]) => mockCount(...a),
      findMany: (...a: unknown[]) => mockFindMany(...a),
    },
  },
}));

const { buildAssortmentWhere, loadAssortmentPage } = await import("../assortmentQuery");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildAssortmentWhere", () => {
  it("returns an empty where clause with no filters", () => {
    expect(buildAssortmentWhere({})).toEqual({});
  });

  it("25/26: applies search (q) as a case-insensitive OR across supplier/product/variety/length/box/code/notes", () => {
    const where = buildAssortmentWhere({ q: "Freedom" });
    expect(where.OR).toBeDefined();
    expect(where.OR!.length).toBeGreaterThan(0);
    for (const clause of where.OR!) {
      expect(JSON.stringify(clause)).toContain("Freedom");
    }
  });

  it("26: applies farmId/box/weight as exact filters", () => {
    const where = buildAssortmentWhere({ farmId: "farm-1", box: "QB", weight: "8.000" });
    expect(where.farmId).toBe("farm-1");
    expect(where.boxType).toBe("QB");
    expect(where.weightPerBoxKg).toBe("8.000");
  });

  it("26: applies product/variety/length as nested productVariant filters", () => {
    const where = buildAssortmentWhere({ product: "Rosa Ec", variety: "Dallas", length: "60" });
    expect(where.productVariant).toEqual({
      product: { name: "Rosa Ec" },
      variety: { contains: "Dallas", mode: "insensitive" },
      stemLength: { contains: "60", mode: "insensitive" },
    });
  });

  it("combines every filter together (implicit AND across top-level keys)", () => {
    const where = buildAssortmentWhere({ farmId: "farm-1", variety: "Dallas", q: "x" });
    expect(where.farmId).toBe("farm-1");
    expect(where.productVariant).toBeDefined();
    expect(where.OR).toBeDefined();
  });
});

describe("loadAssortmentPage", () => {
  it("20/21: issues exactly one count query and one paginated findMany, skip/take derived from the resolved page", async () => {
    mockCount.mockResolvedValue(327);
    mockFindMany.mockResolvedValue([]);

    await loadAssortmentPage({}, 2, 50);

    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledTimes(1);
    const call = mockFindMany.mock.calls[0][0];
    expect(call.skip).toBe(50);
    expect(call.take).toBe(50);
  });

  it("22/23: pagination result carries the correct totalCount/totalPages", async () => {
    mockCount.mockResolvedValue(327);
    mockFindMany.mockResolvedValue([]);

    const { pagination } = await loadAssortmentPage({}, 1, 50);

    expect(pagination.totalCount).toBe(327);
    expect(pagination.totalPages).toBe(7);
  });

  it("24: the last page requests the correct skip for the remainder", async () => {
    mockCount.mockResolvedValue(327);
    mockFindMany.mockResolvedValue([]);

    await loadAssortmentPage({}, 7, 50);

    const call = mockFindMany.mock.calls[0][0];
    expect(call.skip).toBe(300);
  });

  it("28: an out-of-range requested page resets to page 1 (skip=0) once the count is known", async () => {
    mockCount.mockResolvedValue(12);
    mockFindMany.mockResolvedValue([]);

    const { pagination } = await loadAssortmentPage({}, 8, 50);

    expect(pagination.page).toBe(1);
    const call = mockFindMany.mock.calls[0][0];
    expect(call.skip).toBe(0);
  });

  it("25/27: passes the search-derived where clause into BOTH the count and the data query, so search runs over the full table before pagination", async () => {
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue([]);

    await loadAssortmentPage({ variety: "RowTwoForty" }, 1, 50);

    const countWhere = mockCount.mock.calls[0][0].where;
    const findWhere = mockFindMany.mock.calls[0][0].where;
    expect(countWhere).toEqual(findWhere);
    expect(JSON.stringify(findWhere)).toContain("RowTwoForty");
  });

  it("29: uses deterministic ordering with a stable tie-breaker (createdAt then id)", async () => {
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue([]);

    await loadAssortmentPage({}, 1, 50);

    const call = mockFindMany.mock.calls[0][0];
    expect(call.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("includes farm and productVariant/product in one query (no N+1 per row)", async () => {
    mockCount.mockResolvedValue(1);
    mockFindMany.mockResolvedValue([]);

    await loadAssortmentPage({}, 1, 50);

    const call = mockFindMany.mock.calls[0][0];
    expect(call.include).toEqual({ farm: true, productVariant: { include: { product: true } } });
  });
});
