import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockProfileFindUnique = vi.fn();
const mockProfileFindFirst = vi.fn();
const mockProfileUpdate = vi.fn();
const mockVariantFindFirst = vi.fn();
const mockVariantCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    packagingWeightProfile: {
      findUnique: (...a: unknown[]) => mockProfileFindUnique(...a),
      findFirst: (...a: unknown[]) => mockProfileFindFirst(...a),
      update: (...a: unknown[]) => mockProfileUpdate(...a),
    },
    productVariant: {
      findFirst: (...a: unknown[]) => mockVariantFindFirst(...a),
      create: (...a: unknown[]) => mockVariantCreate(...a),
    },
  },
}));

const { updateSupplierLink } = await import("../actions");

const EXISTING_PROFILE = {
  id: "profile-1",
  farmId: "farm-1",
  productVariantId: "variant-freedom",
  boxType: "QB",
  stemsPerBox: 100,
  weightPerBoxKg: { toString: () => "8.000" },
  productVariant: {
    id: "variant-freedom",
    productId: "product-rosa",
    variety: "Freedom",
    stemLength: "50",
    color: null,
    grade: null,
    treatment: null,
  },
};

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const BASE_FIELDS = {
  farmId: "farm-1",
  boxType: "QB",
  stemsPerBox: "100",
  weightPerBoxKg: "8.000",
  variety: "Freedom",
  stemLength: "50",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockProfileFindUnique.mockResolvedValue(EXISTING_PROFILE);
  mockProfileFindFirst.mockResolvedValue(null); // no duplicate by default
  mockProfileUpdate.mockResolvedValue({ id: "profile-1" });
});

describe("updateSupplierLink - variety/length editing (Part B)", () => {
  it("10/11: accepts an edited variety and length, normalizes the length, and saves", async () => {
    mockVariantFindFirst.mockResolvedValue(null);
    mockVariantCreate.mockResolvedValue({ id: "variant-explorer" });

    const result = await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, variety: "Explorer", stemLength: "60 cm" }));

    expect(result.ok).toBe(true);
    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: { productId: "product-rosa", variety: "Explorer", stemLength: "60", color: null, grade: null, treatment: null },
    });
    const updateCall = mockProfileUpdate.mock.calls[0][0];
    expect(updateCall.data.productVariantId).toBe("variant-explorer");
  });

  it("12: rejects a non-numeric length without writing anything", async () => {
    const result = await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, stemLength: "abc" }));

    expect(result.ok).toBe(false);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
    expect(mockVariantFindFirst).not.toHaveBeenCalled();
  });

  it("12: rejects a range as one profile length", async () => {
    const result = await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, stemLength: "40-60" }));
    expect(result.ok).toBe(false);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it("13: does not touch the shared ProductVariant row itself when the variety changes (no update() call on productVariant)", async () => {
    mockVariantFindFirst.mockResolvedValue(null);
    mockVariantCreate.mockResolvedValue({ id: "variant-explorer" });

    await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, variety: "Explorer" }));

    // Only find-or-create ever happens on productVariant - never an
    // in-place rename that would affect every other row sharing it.
    expect(mockVariantCreate).toHaveBeenCalled();
  });

  it("14: reuses an existing target ProductVariant instead of creating a duplicate one", async () => {
    mockVariantFindFirst.mockResolvedValue({ id: "variant-explorer-existing" });

    const result = await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, variety: "Explorer" }));

    expect(result.ok).toBe(true);
    expect(mockVariantCreate).not.toHaveBeenCalled();
    const updateCall = mockProfileUpdate.mock.calls[0][0];
    expect(updateCall.data.productVariantId).toBe("variant-explorer-existing");
  });

  it("15: creates and re-links a new ProductVariant only when no matching one exists, preserving color/grade/treatment", async () => {
    mockProfileFindUnique.mockResolvedValue({
      ...EXISTING_PROFILE,
      productVariant: { ...EXISTING_PROFILE.productVariant, color: "White", grade: "Select" },
    });
    mockVariantFindFirst.mockResolvedValue(null);
    mockVariantCreate.mockResolvedValue({ id: "variant-new" });

    await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, variety: "Explorer" }));

    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: { productId: "product-rosa", variety: "Explorer", stemLength: "50", color: "White", grade: "Select", treatment: null },
    });
  });

  it("16: a length change updates only this PackagingWeightProfile - other rows keep pointing at the original variant untouched", async () => {
    mockVariantFindFirst.mockResolvedValue(null);
    mockVariantCreate.mockResolvedValue({ id: "variant-freedom-60" });

    await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, stemLength: "60" }));

    expect(mockProfileUpdate).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: expect.objectContaining({ productVariantId: "variant-freedom-60" }),
    });
    // No bulk/updateMany call anywhere - a single, targeted update.
    expect(mockProfileUpdate).toHaveBeenCalledTimes(1);
  });

  it("17: rejects the edit when the resulting identity would duplicate a different existing profile", async () => {
    mockVariantFindFirst.mockResolvedValue({ id: "variant-explorer" });
    mockProfileFindFirst.mockResolvedValue({ id: "profile-other" });

    const result = await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, variety: "Explorer" }));

    expect(result.ok).toBe(false);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
    const dupCheck = mockProfileFindFirst.mock.calls[0][0];
    expect(dupCheck.where.id).toEqual({ not: "profile-1" });
  });

  it("does not resolve a new variant when neither variety nor length actually changed", async () => {
    await updateSupplierLink("profile-1", formData(BASE_FIELDS));

    expect(mockVariantFindFirst).not.toHaveBeenCalled();
    expect(mockVariantCreate).not.toHaveBeenCalled();
    expect(mockProfileUpdate).toHaveBeenCalledWith({
      where: { id: "profile-1" },
      data: expect.objectContaining({ productVariantId: "variant-freedom" }),
    });
  });

  it("rejects a missing variety/length instead of writing", async () => {
    const noVariety = await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, variety: "" }));
    expect(noVariety.ok).toBe(false);
    const noLength = await updateSupplierLink("profile-1", formData({ ...BASE_FIELDS, stemLength: "" }));
    expect(noLength.ok).toBe(false);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it("returns a clear error when the profile no longer exists", async () => {
    mockProfileFindUnique.mockResolvedValue(null);
    const result = await updateSupplierLink("gone", formData(BASE_FIELDS));
    expect(result.ok).toBe(false);
  });

  it("12: cleans up a legacy row - variety 'Shiny Copper Premium 18cm' + empty length becomes variety 'Shiny Copper Premium' + length 18 in one edit", async () => {
    mockProfileFindUnique.mockResolvedValue({
      ...EXISTING_PROFILE,
      productVariant: {
        ...EXISTING_PROFILE.productVariant,
        variety: "Shiny Copper Premium 18cm",
        stemLength: null,
      },
    });
    mockVariantFindFirst.mockResolvedValue(null);
    mockVariantCreate.mockResolvedValue({ id: "variant-shiny-copper-premium-18" });

    const result = await updateSupplierLink(
      "profile-1",
      formData({ ...BASE_FIELDS, variety: "Shiny Copper Premium", stemLength: "18" }),
    );

    expect(result.ok).toBe(true);
    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: {
        productId: "product-rosa",
        variety: "Shiny Copper Premium",
        stemLength: "18",
        color: null,
        grade: null,
        treatment: null,
      },
    });
    const updateCall = mockProfileUpdate.mock.calls[0][0];
    expect(updateCall.data.productVariantId).toBe("variant-shiny-copper-premium-18");
  });
});
