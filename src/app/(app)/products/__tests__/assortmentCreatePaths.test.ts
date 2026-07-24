import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockProductFindFirst = vi.fn();
const mockProductCreate = vi.fn();
const mockVariantFindFirst = vi.fn();
const mockVariantCreate = vi.fn();
const mockProfileFindFirst = vi.fn();
const mockProfileCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    product: {
      findFirst: (...a: unknown[]) => mockProductFindFirst(...a),
      create: (...a: unknown[]) => mockProductCreate(...a),
    },
    productVariant: {
      findFirst: (...a: unknown[]) => mockVariantFindFirst(...a),
      create: (...a: unknown[]) => mockVariantCreate(...a),
    },
    packagingWeightProfile: {
      findFirst: (...a: unknown[]) => mockProfileFindFirst(...a),
      create: (...a: unknown[]) => mockProfileCreate(...a),
    },
  },
}));

const { createCentralProduct, bulkAddAssortment } = await import("../actions");

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
  mockVariantFindFirst.mockResolvedValue(null);
  mockVariantCreate.mockResolvedValue({ id: "variant-1" });
  mockProfileFindFirst.mockResolvedValue(null);
  mockProfileCreate.mockResolvedValue({ id: "profile-1" });
});

// `redirect()` from next/navigation is a no-op mock here (it doesn't actually
// throw like the real Next.js implementation), so a successful
// `createCentralProduct` call simply returns after calling it - these tests
// assert on the DB calls made along the way. An invalid length still throws
// for real (a plain `throw new Error(...)`, before `redirect` is ever reached).
describe("createCentralProduct - length normalization (Part A2)", () => {
  it("34: existing manual creation still works with a plain numeric length", async () => {
    await createCentralProduct(formData({ name: "Rose", variety: "Freedom", stemLength: "70" }));
    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: { productId: "product-1", variety: "Freedom", stemLength: "70" },
    });
  });

  it("normalizes '60 cm' to canonical '60' before creating the variant", async () => {
    await createCentralProduct(formData({ name: "Rose", variety: "Freedom", stemLength: "60 cm" }));

    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: { productId: "product-1", variety: "Freedom", stemLength: "60" },
    });
  });

  it("rejects a range without creating anything", async () => {
    await expect(
      createCentralProduct(formData({ name: "Rose", variety: "Freedom", stemLength: "40-60" })),
    ).rejects.toThrow();
    expect(mockVariantCreate).not.toHaveBeenCalled();
  });

  it("allows omitting length entirely (still optional)", async () => {
    await createCentralProduct(formData({ name: "Rose", variety: "Freedom" }));

    expect(mockVariantCreate).toHaveBeenCalledWith({
      data: { productId: "product-1", variety: "Freedom", stemLength: null },
    });
  });
});

describe("bulkAddAssortment - length normalization (Part A2)", () => {
  it("35: existing bulk paste creation still works for a row with no explicit length (falls back to default)", async () => {
    await bulkAddAssortment(
      formData({
        farmId: "farm-1",
        productName: "Rose",
        stemLength: "70 cm",
        rows: "Freedom\t100\tQB\t8",
      }),
    );

    expect(mockVariantCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stemLength: "70" }) }),
    );
    expect(mockProfileCreate).toHaveBeenCalledTimes(1);
  });

  it("skips a row whose own length column is unparseable, without creating it", async () => {
    await bulkAddAssortment(
      formData({
        farmId: "farm-1",
        productName: "Rose",
        rows: "Freedom\t100\tQB\t8\t\t\t40-60",
      }),
    );

    expect(mockVariantCreate).not.toHaveBeenCalled();
    expect(mockProfileCreate).not.toHaveBeenCalled();
  });

  it("normalizes a per-row length override to canonical numeric form", async () => {
    await bulkAddAssortment(
      formData({
        farmId: "farm-1",
        productName: "Rose",
        rows: "Freedom\t100\tQB\t8\t\t\t50cm",
      }),
    );

    expect(mockVariantCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stemLength: "50" }) }),
    );
  });
});
