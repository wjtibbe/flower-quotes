import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    packagingWeightProfile: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}));

const { loadFarmAssortmentCandidates } = await import("../assortmentRepository");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadFarmAssortmentCandidates", () => {
  it("issues exactly one Prisma query, scoped to the given farmId, with the required nested include", async () => {
    mockFindMany.mockResolvedValue([]);

    await loadFarmAssortmentCandidates("farm-1");

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { farmId: "farm-1" },
      include: { productVariant: { include: { product: true } } },
    });
  });

  it("maps a Prisma row to the flat AssortmentCandidate shape, including a stringified Decimal weight", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "profile-1",
        farmId: "farm-1",
        productVariantId: "variant-1",
        boxType: "QB",
        stemsPerBox: 100,
        weightPerBoxKg: { toString: () => "8.000" },
        productVariant: {
          productId: "product-1",
          variety: "Dallas",
          stemLength: "60 cm",
          product: { name: "Rose" },
        },
      },
    ]);

    const [candidate] = await loadFarmAssortmentCandidates("farm-1");

    expect(candidate).toEqual({
      packagingWeightProfileId: "profile-1",
      farmId: "farm-1",
      productVariantId: "variant-1",
      productId: "product-1",
      productName: "Rose",
      variety: "Dallas",
      stemLength: "60 cm",
      boxType: "QB",
      stemsPerBox: 100,
      boxWeight: "8.000",
    });
  });

  it("returns an empty array when the farm has no assortment yet", async () => {
    mockFindMany.mockResolvedValue([]);
    const candidates = await loadFarmAssortmentCandidates("farm-without-assortment");
    expect(candidates).toEqual([]);
  });
});
