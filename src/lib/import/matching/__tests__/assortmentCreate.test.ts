import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockProductFindFirst = vi.fn();
const mockProductCreate = vi.fn();
const mockVariantFindFirst = vi.fn();
const mockVariantCreate = vi.fn();
const mockProfileFindFirst = vi.fn();
const mockProfileCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    product: { findFirst: (...a: unknown[]) => mockProductFindFirst(...a), create: (...a: unknown[]) => mockProductCreate(...a) },
    productVariant: { findFirst: (...a: unknown[]) => mockVariantFindFirst(...a), create: (...a: unknown[]) => mockVariantCreate(...a) },
    packagingWeightProfile: { findFirst: (...a: unknown[]) => mockProfileFindFirst(...a), create: (...a: unknown[]) => mockProfileCreate(...a) },
  },
}));

const { findOrCreatePackagingWeightProfile } = await import("../assortmentCreate");

const INPUT = {
  farmId: "farm-1",
  productName: "Rose",
  variety: "Dallas",
  stemLength: "60 cm",
  boxType: "QB",
  stemsPerBox: 100,
  weightPerBoxKg: "8.000",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findOrCreatePackagingWeightProfile - section 26.D", () => {
  it("reuses an existing Product by name (case-insensitive) instead of creating a duplicate", async () => {
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
    mockVariantFindFirst.mockResolvedValue({ id: "variant-1" });
    mockProfileFindFirst.mockResolvedValue({ id: "profile-1" });

    const result = await findOrCreatePackagingWeightProfile(INPUT);

    expect(mockProductCreate).not.toHaveBeenCalled();
    expect(result.createdProduct).toBe(false);
    expect(result.productId).toBe("product-1");
  });

  it("reuses an existing ProductVariant for product+variety+length instead of creating a duplicate", async () => {
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
    mockVariantFindFirst.mockResolvedValue({ id: "variant-1" });
    mockProfileFindFirst.mockResolvedValue({ id: "profile-1" });

    const result = await findOrCreatePackagingWeightProfile(INPUT);

    expect(mockVariantCreate).not.toHaveBeenCalled();
    expect(result.createdVariant).toBe(false);
    expect(result.productVariantId).toBe("variant-1");
  });

  it("creates a new ProductVariant when none matches product+variety+length", async () => {
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
    mockVariantFindFirst.mockResolvedValue(null);
    mockVariantCreate.mockResolvedValue({ id: "new-variant" });
    mockProfileFindFirst.mockResolvedValue({ id: "profile-1" });

    const result = await findOrCreatePackagingWeightProfile(INPUT);

    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: { productId: "product-1", variety: "Dallas", stemLength: "60 cm" },
    });
    expect(result.createdVariant).toBe(true);
    expect(result.productVariantId).toBe("new-variant");
  });

  it("reuses an exact existing PackagingWeightProfile (farm+variant+boxType+stemsPerBox) instead of duplicating it", async () => {
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
    mockVariantFindFirst.mockResolvedValue({ id: "variant-1" });
    mockProfileFindFirst.mockResolvedValue({ id: "existing-profile" });

    const result = await findOrCreatePackagingWeightProfile(INPUT);

    expect(mockProfileCreate).not.toHaveBeenCalled();
    expect(result.createdProfile).toBe(false);
    expect(result.packagingWeightProfileId).toBe("existing-profile");
  });

  it("creates a new PackagingWeightProfile when none matches exactly", async () => {
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
    mockVariantFindFirst.mockResolvedValue({ id: "variant-1" });
    mockProfileFindFirst.mockResolvedValue(null);
    mockProfileCreate.mockResolvedValue({ id: "new-profile" });

    const result = await findOrCreatePackagingWeightProfile(INPUT);

    expect(mockProfileCreate).toHaveBeenCalledWith({
      data: {
        farmId: "farm-1",
        productVariantId: "variant-1",
        boxType: "QB",
        stemsPerBox: 100,
        weightPerBoxKg: "8.000",
        notes: expect.any(String),
      },
    });
    expect(result.createdProfile).toBe(true);
    expect(result.packagingWeightProfileId).toBe("new-profile");
  });

  it("creates a brand new Product when no matching name exists at all", async () => {
    mockProductFindFirst.mockResolvedValue(null);
    mockProductCreate.mockResolvedValue({ id: "brand-new-product" });
    mockVariantFindFirst.mockResolvedValue(null);
    mockVariantCreate.mockResolvedValue({ id: "brand-new-variant" });
    mockProfileFindFirst.mockResolvedValue(null);
    mockProfileCreate.mockResolvedValue({ id: "brand-new-profile" });

    const result = await findOrCreatePackagingWeightProfile(INPUT);

    expect(mockProductCreate).toHaveBeenCalledWith({ data: { name: "Rose", productGroup: "Rose" } });
    expect(result.createdProduct).toBe(true);
    expect(result.productId).toBe("brand-new-product");
  });

  it("never creates a profile for a different farm than the one requested", async () => {
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
    mockVariantFindFirst.mockResolvedValue({ id: "variant-1" });
    mockProfileFindFirst.mockResolvedValue(null);
    mockProfileCreate.mockResolvedValue({ id: "new-profile" });

    await findOrCreatePackagingWeightProfile({ ...INPUT, farmId: "farm-999" });

    expect(mockProfileFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ farmId: "farm-999" }) }));
    expect(mockProfileCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ farmId: "farm-999" }) }));
  });
});
