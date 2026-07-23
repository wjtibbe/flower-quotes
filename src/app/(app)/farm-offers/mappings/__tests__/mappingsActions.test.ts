import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: () => Promise.resolve({ user: { id: "user-1" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockMappingFindUnique = vi.fn();
const mockMappingUpdate = vi.fn();
const mockMappingDelete = vi.fn();
const mockProfileFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    supplierLineMapping: {
      findUnique: (...a: unknown[]) => mockMappingFindUnique(...a),
      update: (...a: unknown[]) => mockMappingUpdate(...a),
      delete: (...a: unknown[]) => mockMappingDelete(...a),
    },
    packagingWeightProfile: {
      findUnique: (...a: unknown[]) => mockProfileFindUnique(...a),
    },
  },
}));

const { updateSupplierLineMappingTarget, deleteSupplierLineMapping } = await import("../actions");

beforeEach(() => {
  vi.clearAllMocks();
  mockMappingUpdate.mockResolvedValue({});
  mockMappingDelete.mockResolvedValue({});
});

describe("updateSupplierLineMappingTarget - section 31 edit", () => {
  it("changing to a profile of the SAME supplier succeeds", async () => {
    mockMappingFindUnique.mockResolvedValue({ id: "mapping-1", farmId: "farm-1" });
    mockProfileFindUnique.mockResolvedValue({ id: "profile-2", farmId: "farm-1" });

    const result = await updateSupplierLineMappingTarget("mapping-1", "profile-2");

    expect(result.ok).toBe(true);
    expect(mockMappingUpdate).toHaveBeenCalledWith({ where: { id: "mapping-1" }, data: { packagingWeightProfileId: "profile-2" } });
  });

  it("changing to a profile of ANOTHER supplier is blocked", async () => {
    mockMappingFindUnique.mockResolvedValue({ id: "mapping-1", farmId: "farm-1" });
    mockProfileFindUnique.mockResolvedValue({ id: "profile-2", farmId: "farm-OTHER" });

    const result = await updateSupplierLineMappingTarget("mapping-1", "profile-2");

    expect(result.ok).toBe(false);
    expect(mockMappingUpdate).not.toHaveBeenCalled();
  });

  it("a nonexistent target profile is blocked", async () => {
    mockMappingFindUnique.mockResolvedValue({ id: "mapping-1", farmId: "farm-1" });
    mockProfileFindUnique.mockResolvedValue(null);

    const result = await updateSupplierLineMappingTarget("mapping-1", "profile-2");

    expect(result.ok).toBe(false);
    expect(mockMappingUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteSupplierLineMapping - section 31/17 delete", () => {
  it("deletes the mapping", async () => {
    mockMappingFindUnique.mockResolvedValue({ id: "mapping-1", rawSource: "Dallas 60cm" });

    const result = await deleteSupplierLineMapping("mapping-1");

    expect(result.ok).toBe(true);
    expect(mockMappingDelete).toHaveBeenCalledWith({ where: { id: "mapping-1" } });
  });

  it("a nonexistent mapping is reported cleanly, not as a database error", async () => {
    mockMappingFindUnique.mockResolvedValue(null);

    const result = await deleteSupplierLineMapping("mapping-1");

    expect(result.ok).toBe(false);
    expect(mockMappingDelete).not.toHaveBeenCalled();
  });
});
