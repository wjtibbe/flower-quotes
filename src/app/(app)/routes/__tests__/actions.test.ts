import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

const mockCostTypeFindUnique = vi.fn();
const mockDdpCostRateCreate = vi.fn();
const mockDdpCostRateUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    additionalCostType: { findUnique: (...a: unknown[]) => mockCostTypeFindUnique(...a) },
    ddpCostRate: {
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
  });

  it("9: rejects when validUntil (effectiveTo) is before validFrom (effectiveFrom)", async () => {
    await expect(
      addRouteCost(
        "route-1",
        formData({
          additionalCostTypeId: "type-clearing",
          amount: "1.5",
          currency: "USD",
          rateUnit: "PER_STEM",
          effectiveFrom: "2026-06-01",
          effectiveTo: "2026-01-01",
        }),
      ),
    ).rejects.toThrow("REDIRECT:");
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

  it("5: editing the amount is applied", async () => {
    await expect(updateRouteCost("cost-1", formData(validEdit))).rejects.toThrow("REDIRECT:/routes?msg=cost-updated");
    expect(mockDdpCostRateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cost-1" }, data: expect.objectContaining({ amount: "2.25" }) }),
    );
  });

  it("6: editing the currency is applied", async () => {
    await expect(updateRouteCost("cost-1", formData(validEdit))).rejects.toThrow("REDIRECT:");
    expect(mockDdpCostRateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: "EUR" }) }),
    );
  });

  it("7: editing the validity dates is applied", async () => {
    await expect(
      updateRouteCost("cost-1", formData({ ...validEdit, effectiveFrom: "2026-02-01", effectiveTo: "2026-08-01" })),
    ).rejects.toThrow("REDIRECT:");
    const data = mockDdpCostRateUpdate.mock.calls[0][0].data;
    expect(data.effectiveFrom.toISOString().slice(0, 10)).toBe("2026-02-01");
    expect(data.effectiveTo.toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("8: editing the cost type re-snapshots name/category from the newly chosen type", async () => {
    mockCostTypeFindUnique.mockResolvedValue({
      id: "type-handling",
      name: "Handling",
      category: "HANDLING",
      defaultUnit: "PER_BOX",
      isActive: true,
    });
    await expect(
      updateRouteCost("cost-1", formData({ ...validEdit, additionalCostTypeId: "type-handling" })),
    ).rejects.toThrow("REDIRECT:");
    expect(mockDdpCostRateUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ additionalCostTypeId: "type-handling", name: "Handling", category: "HANDLING" }),
      }),
    );
  });

  it("9: rejects when validUntil is before validFrom on edit", async () => {
    await expect(
      updateRouteCost("cost-1", formData({ ...validEdit, effectiveFrom: "2026-06-01", effectiveTo: "2026-01-01" })),
    ).rejects.toThrow("REDIRECT:");
    expect(mockDdpCostRateUpdate).not.toHaveBeenCalled();
  });

  it("18: revalidates the routes path so the page refreshes without a full reload", async () => {
    await expect(updateRouteCost("cost-1", formData(validEdit))).rejects.toThrow("REDIRECT:");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/routes");
  });
});
