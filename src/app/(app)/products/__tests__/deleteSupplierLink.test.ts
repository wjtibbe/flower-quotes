import { beforeEach, describe, expect, it, vi } from "vitest";

// Section 26.H: deleting a PackagingWeightProfile through the application
// (never a raw DB delete) must, in the SAME transaction, flip any linked
// FarmOfferLine back to UNMATCHED - the FK's onDelete:SetNull already nulls
// packagingWeightProfileId once the row is gone, but nothing in the schema can
// also flip matchStatus, so the application does it explicitly (section 25).

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockFarmOfferLineUpdateMany = vi.fn();
const mockPackagingWeightProfileDelete = vi.fn();
const mockPackagingWeightProfileDeleteMany = vi.fn();
const mockPackagingWeightProfileFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    farmOfferLine: {
      updateMany: (...a: unknown[]) => mockFarmOfferLineUpdateMany(...a),
    },
    packagingWeightProfile: {
      delete: (...a: unknown[]) => mockPackagingWeightProfileDelete(...a),
      deleteMany: (...a: unknown[]) => mockPackagingWeightProfileDeleteMany(...a),
      findMany: (...a: unknown[]) => mockPackagingWeightProfileFindMany(...a),
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        farmOfferLine: { updateMany: (...a: unknown[]) => mockFarmOfferLineUpdateMany(...a) },
        packagingWeightProfile: {
          delete: (...a: unknown[]) => mockPackagingWeightProfileDelete(...a),
          deleteMany: (...a: unknown[]) => mockPackagingWeightProfileDeleteMany(...a),
        },
      }),
  },
}));

const { deleteSupplierLink, bulkDeleteSupplierLinks } = await import("../actions");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteSupplierLink - section 26.H delete profile cascade", () => {
  it("nulls packagingWeightProfileId and sets matchStatus UNMATCHED on any linked FarmOfferLine before deleting the profile", async () => {
    mockFarmOfferLineUpdateMany.mockResolvedValue({ count: 1 });
    mockPackagingWeightProfileDelete.mockResolvedValue({ id: "profile-1" });

    await deleteSupplierLink("profile-1");

    expect(mockFarmOfferLineUpdateMany).toHaveBeenCalledWith({
      where: { packagingWeightProfileId: "profile-1" },
      data: { packagingWeightProfileId: null, matchStatus: "UNMATCHED" },
    });
    expect(mockPackagingWeightProfileDelete).toHaveBeenCalledWith({ where: { id: "profile-1" } });
  });

  it("still deletes the profile when no FarmOfferLine was linked to it", async () => {
    mockFarmOfferLineUpdateMany.mockResolvedValue({ count: 0 });
    mockPackagingWeightProfileDelete.mockResolvedValue({ id: "profile-2" });

    await deleteSupplierLink("profile-2");

    expect(mockPackagingWeightProfileDelete).toHaveBeenCalledWith({ where: { id: "profile-2" } });
  });

  it("does not delete the FarmOfferLine row itself - only clears its match fields (the historical line stays)", async () => {
    mockFarmOfferLineUpdateMany.mockResolvedValue({ count: 1 });
    mockPackagingWeightProfileDelete.mockResolvedValue({ id: "profile-1" });

    await deleteSupplierLink("profile-1");

    const call = mockFarmOfferLineUpdateMany.mock.calls[0][0];
    expect(call.data).not.toHaveProperty("delete");
    expect(Object.keys(call.data).sort()).toEqual(["matchStatus", "packagingWeightProfileId"].sort());
  });
});

describe("bulkDeleteSupplierLinks - section 26.H delete profile cascade (bulk)", () => {
  it("nulls packagingWeightProfileId and sets matchStatus UNMATCHED for every selected profile before bulk-deleting them", async () => {
    mockPackagingWeightProfileFindMany.mockResolvedValue([{ id: "profile-1" }, { id: "profile-2" }]);
    mockFarmOfferLineUpdateMany.mockResolvedValue({ count: 3 });
    mockPackagingWeightProfileDeleteMany.mockResolvedValue({ count: 2 });

    const result = await bulkDeleteSupplierLinks(["profile-1", "profile-2"]);

    expect(mockFarmOfferLineUpdateMany).toHaveBeenCalledWith({
      where: { packagingWeightProfileId: { in: ["profile-1", "profile-2"] } },
      data: { packagingWeightProfileId: null, matchStatus: "UNMATCHED" },
    });
    expect(mockPackagingWeightProfileDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["profile-1", "profile-2"] } },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an empty selection without touching FarmOfferLine or the profile table", async () => {
    const result = await bulkDeleteSupplierLinks([]);

    expect(result.ok).toBe(false);
    expect(mockFarmOfferLineUpdateMany).not.toHaveBeenCalled();
    expect(mockPackagingWeightProfileDeleteMany).not.toHaveBeenCalled();
  });
});
