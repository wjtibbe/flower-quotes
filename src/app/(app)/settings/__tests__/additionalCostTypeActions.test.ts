import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn() } }));

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockDdpCostRateCount = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    additionalCostType: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      delete: (...a: unknown[]) => mockDelete(...a),
    },
    ddpCostRate: { count: (...a: unknown[]) => mockDdpCostRateCount(...a) },
  },
}));

const {
  addAdditionalCostType,
  updateAdditionalCostType,
  toggleAdditionalCostTypeActive,
  deleteAdditionalCostType,
} = await import("../actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue(null);
  mockCreate.mockResolvedValue({ id: "type-new" });
  mockUpdate.mockResolvedValue({ id: "type-1" });
  mockDelete.mockResolvedValue({ id: "type-1" });
  mockDdpCostRateCount.mockResolvedValue(0);
});

describe("addAdditionalCostType - case-insensitive uniqueness", () => {
  it("1: creates a new type with its normalized name when no duplicate exists", async () => {
    await expect(
      addAdditionalCostType(formData({ name: "Clearing", category: "CLEARING", defaultUnit: "PER_STEM" })),
    ).rejects.toThrow("REDIRECT:/settings?msg=costtype-created");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Clearing", normalizedName: "clearing" }) }),
    );
  });

  it("1: rejects a name that only differs in case from an existing type", async () => {
    mockFindUnique.mockResolvedValue({ id: "type-1", name: "Clearing" });
    await expect(
      addAdditionalCostType(formData({ name: "CLEARING", category: "CLEARING", defaultUnit: "PER_STEM" })),
    ).rejects.toThrow(/bestaat%20al%20een%20kostensoort/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("1: rejects a name that only differs in whitespace from an existing type", async () => {
    mockFindUnique.mockResolvedValue({ id: "type-1", name: "Clearing" });
    await expect(
      addAdditionalCostType(formData({ name: "  clearing  ", category: "CLEARING", defaultUnit: "PER_STEM" })),
    ).rejects.toThrow(/bestaat%20al%20een%20kostensoort/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("updateAdditionalCostType - rename keeps uniqueness case-insensitive", () => {
  it("1: allows keeping its own (unchanged) name", async () => {
    mockFindUnique.mockResolvedValue({ id: "type-1", name: "Clearing" });
    await expect(
      updateAdditionalCostType("type-1", formData({ name: "Clearing", category: "CLEARING", defaultUnit: "PER_STEM" })),
    ).rejects.toThrow("REDIRECT:/settings?msg=costtype-updated");
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("1: rejects renaming to another type's name in a different case", async () => {
    mockFindUnique.mockResolvedValue({ id: "type-2", name: "Handling" });
    await expect(
      updateAdditionalCostType("type-1", formData({ name: "HANDLING", category: "CLEARING", defaultUnit: "PER_STEM" })),
    ).rejects.toThrow(/bestaat%20al%20een%20kostensoort/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("deleteAdditionalCostType - hard delete only when unused", () => {
  it("10: is blocked when route additional costs still reference the type", async () => {
    mockDdpCostRateCount.mockResolvedValue(3);
    await expect(deleteAdditionalCostType("type-1")).rejects.toThrow(/kan%20niet%20worden%20verwijderd/);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes the type when nothing references it", async () => {
    mockDdpCostRateCount.mockResolvedValue(0);
    await expect(deleteAdditionalCostType("type-1")).rejects.toThrow("REDIRECT:/settings?msg=costtype-deleted");
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "type-1" } });
  });
});

describe("toggleAdditionalCostTypeActive - deactivate/reactivate", () => {
  it("11: deactivates a type that is currently active, even while referenced", async () => {
    await toggleAdditionalCostTypeActive("type-1", true);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "type-1" }, data: { isActive: false } });
  });

  it("11: reactivates a type that is currently inactive", async () => {
    await toggleAdditionalCostTypeActive("type-1", false);
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "type-1" }, data: { isActive: true } });
  });
});
