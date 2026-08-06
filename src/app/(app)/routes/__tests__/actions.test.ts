import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

const mockCostTypeFindUnique = vi.fn();
const mockDdpCostRateFindUnique = vi.fn();
const mockDdpCostRateCreate = vi.fn();
const mockDdpCostRateUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    additionalCostType: { findUnique: (...a: unknown[]) => mockCostTypeFindUnique(...a) },
    ddpCostRate: {
      findUnique: (...a: unknown[]) => mockDdpCostRateFindUnique(...a),
      create: (...a: unknown[]) => mockDdpCostRateCreate(...a),
      update: (...a: unknown[]) => mockDdpCostRateUpdate(...a),
    },
  },
}));

const { addRouteCost, updateRouteCost } = await import("../actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const clearingType = {
  id: "type-clearing",
  name: "Clearing",
  category: "CLEARING",
  defaultUnit: "PER_STEM",
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCostTypeFindUnique.mockResolvedValue(clearingType);
  // No existing row for this (route, type) by default - addRouteCost's
  // duplicate check passes through unless a test explicitly overrides it.
  mockDdpCostRateFindUnique.mockResolvedValue(null);
  mockDdpCostRateCreate.mockResolvedValue({ id: "cost-new" });
  mockDdpCostRateUpdate.mockResolvedValue({ id: "cost-1" });
});

describe("addRouteCost", () => {
  it("4: stores the new cost referencing the chosen cost type by id, snapshotting name/category", async () => {
    await addRouteCost(
      "route-1",
      formData({ additionalCostTypeId: "type-clearing", amount: "1.5", currency: "USD", rateUnit: "PER_STEM" }),
    );
    expect(mockDdpCostRateCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          routeId: "route-1",
          additionalCostTypeId: "type-clearing",
          name: "Clearing",
          category: "CLEARING",
          amount: "1.5",
          currency: "USD",
        }),
      }),
    );
    // Business rule: no validity periods at all - the create payload never
    // carries effectiveFrom/effectiveTo.
    const data = mockDdpCostRateCreate.mock.calls[0][0].data;
    expect(data.effectiveFrom).toBeUndefined();
    expect(data.effectiveTo).toBeUndefined();
  });

  it("8: a duplicate route + cost type is rejected, not silently created or overwritten", async () => {
    mockDdpCostRateFindUnique.mockResolvedValue({ id: "cost-existing", routeId: "route-1", additionalCostTypeId: "type-clearing" });
    await expect(
      addRouteCost(
        "route-1",
        formData({ additionalCostTypeId: "type-clearing", amount: "1.5", currency: "USD", rateUnit: "PER_STEM" }),
      ),
    ).rejects.toThrow("REDIRECT:/routes?err=");
    expect(mockDdpCostRateCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown cost type id without creating a row", async () => {
    mockCostTypeFindUnique.mockResolvedValue(null);
    await expect(
      addRouteCost(
        "route-1",
        formData({ additionalCostTypeId: "type-missing", amount: "1.5", currency: "USD", rateUnit: "PER_STEM" }),
      ),
    ).rejects.toThrow("REDIRECT:/routes?err=");
    expect(mockDdpCostRateCreate).not.toHaveBeenCalled();
  });

  it("requires a cost type to be selected", async () => {
    await expect(
      addRouteCost("route-1", formData({ amount: "1.5", currency: "USD", rateUnit: "PER_STEM" })),
    ).rejects.toThrow("REDIRECT:");
    expect(mockDdpCostRateCreate).not.toHaveBeenCalled();
  });
});

describe("updateRouteCost", () => {
  const validEdit = { additionalCostTypeId: "type-clearing", amount: "2.25", currency: "EUR", rateUnit: "PER_BOX" };
  const existingRow = { id: "cost-1", routeId: "route-1", additionalCostTypeId: "type-clearing" };

  beforeEach(() => {
    // updateRouteCost always re-reads the row it's editing first.
    mockDdpCostRateFindUnique.mockResolvedValue(existingRow);
  });

  it("7: editing the amount updates the existing row (never creates a new one)", async () => {
    await expect(updateRouteCost("cost-1", formData(validEdit))).rejects.toThrow("REDIRECT:/routes?msg=cost-updated");
    expect(mockDdpCostRateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cost-1" }, data: expect.objectContaining({ amount: "2.25" }) }),
    );
    expect(mockDdpCostRateCreate).not.toHaveBeenCalled();
  });

  it("6: editing the currency is applied", async () => {
    await expect(updateRouteCost("cost-1", formData(validEdit))).rejects.toThrow("REDIRECT:");
    expect(mockDdpCostRateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: "EUR" }) }),
    );
  });

  it("the update payload never carries effectiveFrom/effectiveTo (business rule: no validity periods)", async () => {
    await expect(updateRouteCost("cost-1", formData(validEdit))).rejects.toThrow("REDIRECT:");
    const data = mockDdpCostRateUpdate.mock.calls[0][0].data;
    expect(data.effectiveFrom).toBeUndefined();
    expect(data.effectiveTo).toBeUndefined();
  });

  it("8: editing the cost type re-snapshots name/category from the newly chosen type", async () => {
    mockCostTypeFindUnique.mockResolvedValue({
      id: "type-handling",
      name: "Handling",
      category: "HANDLING",
      defaultUnit: "PER_BOX",
      isActive: true,
    });
    // No existing row for (route-1, type-handling), so the type change is allowed.
    mockDdpCostRateFindUnique.mockImplementation(({ where }: { where: { id?: string } }) =>
      Promise.resolve(where.id === "cost-1" ? existingRow : null),
    );
    await expect(
      updateRouteCost("cost-1", formData({ ...validEdit, additionalCostTypeId: "type-handling" })),
    ).rejects.toThrow("REDIRECT:");
    expect(mockDdpCostRateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ additionalCostTypeId: "type-handling", name: "Handling", category: "HANDLING" }),
      }),
    );
  });

  it("8: changing the cost type to one this route already has a different row for is rejected", async () => {
    mockCostTypeFindUnique.mockResolvedValue({
      id: "type-handling",
      name: "Handling",
      category: "HANDLING",
      defaultUnit: "PER_BOX",
      isActive: true,
    });
    mockDdpCostRateFindUnique.mockImplementation(({ where }: { where: { id?: string; routeId_additionalCostTypeId?: unknown } }) => {
      if (where.id === "cost-1") return Promise.resolve(existingRow);
      // A different row already has (route-1, type-handling).
      if (where.routeId_additionalCostTypeId) return Promise.resolve({ id: "cost-other", routeId: "route-1", additionalCostTypeId: "type-handling" });
      return Promise.resolve(null);
    });
    await expect(
      updateRouteCost("cost-1", formData({ ...validEdit, additionalCostTypeId: "type-handling" })),
    ).rejects.toThrow("REDIRECT:/routes?err=");
    expect(mockDdpCostRateUpdate).not.toHaveBeenCalled();
  });

  it("18: revalidates the routes path so the page refreshes without a full reload", async () => {
    await expect(updateRouteCost("cost-1", formData(validEdit))).rejects.toThrow("REDIRECT:");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/routes");
  });
});
