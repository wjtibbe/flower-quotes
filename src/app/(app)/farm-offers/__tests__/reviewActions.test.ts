import { beforeEach, describe, expect, it, vi } from "vitest";

// Broad mock of every side-effecting dependency the review-screen server
// actions touch (session, database, navigation) so these tests exercise only
// each action's own control flow - never a real database or AI call.

vi.mock("server-only", () => ({}));

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => mockGetServerSession(...a) }));

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...a: unknown[]) => mockRedirect(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockFarmOfferLineFindUnique = vi.fn();
const mockFarmOfferLineUpdate = vi.fn();
const mockFarmOfferLineCreate = vi.fn();
const mockFarmOfferFindUnique = vi.fn();
const mockFarmOfferFindUniqueOrThrow = vi.fn();
const mockFarmOfferUpdate = vi.fn();
const mockPackagingWeightProfileFindUnique = vi.fn();
const mockPackagingWeightProfileFindMany = vi.fn();
const mockPackagingWeightProfileFindFirst = vi.fn();
const mockPackagingWeightProfileCreate = vi.fn();
const mockProductFindFirst = vi.fn();
const mockProductCreate = vi.fn();
const mockProductVariantFindFirst = vi.fn();
const mockProductVariantCreate = vi.fn();
const mockProductVariantFindMany = vi.fn(); // the OLD, now-removed global lookup - asserted never called
// applySupplierMappingsThenMatch's batch mapping lookup - empty by default so
// these tests exercise the deterministic matcher unless overridden.
const mockSupplierLineMappingFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    farmOfferLine: {
      findUnique: (...a: unknown[]) => mockFarmOfferLineFindUnique(...a),
      update: (...a: unknown[]) => mockFarmOfferLineUpdate(...a),
      create: (...a: unknown[]) => mockFarmOfferLineCreate(...a),
    },
    supplierLineMapping: {
      findMany: (...a: unknown[]) => mockSupplierLineMappingFindMany(...a),
    },
    farmOffer: {
      findUnique: (...a: unknown[]) => mockFarmOfferFindUnique(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockFarmOfferFindUniqueOrThrow(...a),
      update: (...a: unknown[]) => mockFarmOfferUpdate(...a),
    },
    packagingWeightProfile: {
      findUnique: (...a: unknown[]) => mockPackagingWeightProfileFindUnique(...a),
      findMany: (...a: unknown[]) => mockPackagingWeightProfileFindMany(...a),
      findFirst: (...a: unknown[]) => mockPackagingWeightProfileFindFirst(...a),
      create: (...a: unknown[]) => mockPackagingWeightProfileCreate(...a),
    },
    product: {
      findFirst: (...a: unknown[]) => mockProductFindFirst(...a),
      create: (...a: unknown[]) => mockProductCreate(...a),
    },
    productVariant: {
      findFirst: (...a: unknown[]) => mockProductVariantFindFirst(...a),
      create: (...a: unknown[]) => mockProductVariantCreate(...a),
      findMany: (...a: unknown[]) => mockProductVariantFindMany(...a),
    },
  },
}));

const {
  updateOfferLine,
  selectPackagingProfile,
  createAssortmentItemFromOfferLine,
  confirmFarmOffer,
  addManualOfferLine,
  bulkAddOfferLines,
} = await import("../actions");

const FARM_ID = "farm-agrinag";

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-dallas",
    farmId: FARM_ID,
    productVariantId: "variant-dallas",
    boxType: "QB",
    stemsPerBox: 100,
    weightPerBoxKg: { toString: () => "8.000" },
    productVariant: { productId: "product-1", variety: "Dallas", stemLength: "60 cm", product: { name: "Rosa Ec" } },
    ...overrides,
  };
}

function baseFarmOfferLine(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    farmOfferId: "offer-1",
    farmOffer: { farmId: FARM_ID },
    rawText: "Dallas 60cm 0.38",
    productGroupRaw: "Rose",
    productNameRaw: null,
    varietyRaw: "Dallas",
    colorRaw: null,
    gradeRaw: null,
    treatmentRaw: "normal",
    boxType: "QB",
    boxesAvailable: 10,
    stemsPerBox: 100,
    stemLengthCm: 60,
    quantity: null,
    unit: null,
    totalStems: null,
    fobPricePerStem: { toString: () => "0.38" },
    currency: "USD",
    weightPerBoxKg: { toString: () => "8.000" },
    notes: null,
    matchStatus: "AUTO_MATCHED",
    packagingWeightProfileId: "profile-dallas",
    productVariantId: "variant-dallas",
    extractedSnapshot: { parserWarnings: [] },
    ...overrides,
  };
}

function updateFormData(fields: Record<string, string>) {
  const fd = new FormData();
  const defaults = {
    productGroupRaw: "Rose",
    varietyRaw: "Dallas",
    stemLengthCm: "60",
    boxType: "QB",
    stemsPerBox: "100",
    fobPricePerStem: "0.38",
    currency: "USD",
    weightPerBoxKg: "8",
    notes: "",
  };
  for (const [key, value] of Object.entries({ ...defaults, ...fields })) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
  mockFarmOfferLineUpdate.mockResolvedValue({});
  mockFarmOfferLineCreate.mockResolvedValue({});
  mockPackagingWeightProfileFindMany.mockResolvedValue([]);
  mockSupplierLineMappingFindMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Section 26.B: correction + rematch
// ---------------------------------------------------------------------------

describe("updateOfferLine - correction + rematch", () => {
  it("Dallas -> Freedom leads to a new match", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindMany.mockResolvedValue([
      profileRow({ id: "profile-dallas", productVariant: { productId: "p1", variety: "Dallas", stemLength: "60 cm", product: { name: "Rosa Ec" } } }),
      profileRow({ id: "profile-freedom", productVariantId: "variant-freedom", productVariant: { productId: "p1", variety: "Freedom", stemLength: "60 cm", product: { name: "Rosa Ec" } } }),
    ]);

    const result = await updateOfferLine("line-1", updateFormData({ varietyRaw: "Freedom" }));

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBe("profile-freedom");
    expect(data.matchStatus).toBe("AUTO_MATCHED");
  });

  it("length 50 -> 60 rematches", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(
      baseFarmOfferLine({ stemLengthCm: 50, matchStatus: "UNMATCHED", packagingWeightProfileId: null, productVariantId: null }),
    );
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]); // profile exists at 60cm only

    const result = await updateOfferLine("line-1", updateFormData({ stemLengthCm: "60" }));

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBe("profile-dallas");
    expect(data.matchStatus).toBe("AUTO_MATCHED");
  });

  it("a typo (Dallas -> Dalas) clears the link and lands on UNMATCHED", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]);

    const result = await updateOfferLine("line-1", updateFormData({ varietyRaw: "Dalas" }));

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBeNull();
    expect(data.matchStatus).toBe("UNMATCHED");
  });

  it("a notes-only change preserves an existing USER_LINKED match and never re-queries the assortment", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(
      baseFarmOfferLine({ matchStatus: "USER_LINKED", packagingWeightProfileId: "user-chosen-profile", productVariantId: "user-chosen-variant" }),
    );

    const result = await updateOfferLine("line-1", updateFormData({ notes: "een opmerking" }));

    expect(result.ok).toBe(true);
    expect(mockPackagingWeightProfileFindMany).not.toHaveBeenCalled();
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBe("user-chosen-profile");
    expect(data.matchStatus).toBe("USER_LINKED");
    expect(data.notes).toBe("een opmerking");
  });
});

// ---------------------------------------------------------------------------
// Section 26.C: manual selection
// ---------------------------------------------------------------------------

describe("selectPackagingProfile - manual selection", () => {
  it("a valid same-farm profile is linked as USER_LINKED", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindUnique.mockResolvedValue({ id: "profile-hb", farmId: FARM_ID, productVariantId: "variant-hb" });

    const result = await selectPackagingProfile("line-1", "profile-hb");

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBe("profile-hb");
    expect(data.productVariantId).toBe("variant-hb");
    expect(data.matchStatus).toBe("USER_LINKED");
  });

  it("rejects a profile belonging to a different farm", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindUnique.mockResolvedValue({ id: "profile-other", farmId: "farm-other", productVariantId: "variant-x" });

    const result = await selectPackagingProfile("line-1", "profile-other");

    expect(result.ok).toBe(false);
    expect(mockFarmOfferLineUpdate).not.toHaveBeenCalled();
  });

  it("rejects a profile id that doesn't exist", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindUnique.mockResolvedValue(null);

    const result = await selectPackagingProfile("line-1", "does-not-exist");

    expect(result.ok).toBe(false);
    expect(mockFarmOfferLineUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 26.D: create assortment (action level - see assortmentCreate.test.ts for the pure find-or-create logic)
// ---------------------------------------------------------------------------

describe("createAssortmentItemFromOfferLine", () => {
  function createFormData(fields: Partial<Record<string, string>> = {}) {
    const fd = new FormData();
    const defaults = {
      productName: "Rose",
      variety: "Dallas",
      stemLength: "60 cm",
      boxType: "QB",
      stemsPerBox: "100",
      weightPerBoxKg: "8",
    };
    for (const [key, value] of Object.entries({ ...defaults, ...fields })) fd.set(key, value);
    return fd;
  }

  it("creates and immediately links a new assortment item, setting USER_LINKED", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine({ matchStatus: "UNMATCHED", packagingWeightProfileId: null }));
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
    mockProductVariantFindFirst.mockResolvedValue({ id: "variant-1" });
    mockPackagingWeightProfileFindFirst.mockResolvedValue(null);
    mockPackagingWeightProfileCreate.mockResolvedValue({ id: "brand-new-profile" });

    const result = await createAssortmentItemFromOfferLine("line-1", createFormData());

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBe("brand-new-profile");
    expect(data.productVariantId).toBe("variant-1");
    expect(data.matchStatus).toBe("USER_LINKED");
  });

  it("rejects when the offer has no supplier at all", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine({ farmOffer: { farmId: null } }));

    const result = await createAssortmentItemFromOfferLine("line-1", createFormData());

    expect(result.ok).toBe(false);
    expect(mockProductFindFirst).not.toHaveBeenCalled();
  });

  it("rejects when a required field (stemsPerBox) is missing", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());

    const result = await createAssortmentItemFromOfferLine("line-1", createFormData({ stemsPerBox: "" }));

    expect(result.ok).toBe(false);
    expect(mockProductFindFirst).not.toHaveBeenCalled();
  });

  it("never accepts a different supplier - the form has no farmId field, the line's own farm is always used", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rose" });
    mockProductVariantFindFirst.mockResolvedValue({ id: "variant-1" });
    mockPackagingWeightProfileFindFirst.mockResolvedValue(null);
    mockPackagingWeightProfileCreate.mockResolvedValue({ id: "new-profile" });

    // Even if a caller tried to smuggle a farmId into the form, the action
    // never reads one - it always uses the offer's own farmId.
    const fd = createFormData();
    fd.set("farmId", "farm-attacker-controlled");
    await createAssortmentItemFromOfferLine("line-1", fd);

    expect(mockPackagingWeightProfileCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ farmId: FARM_ID }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// Section 26.E: finalization
// ---------------------------------------------------------------------------

describe("confirmFarmOffer - finalization validation", () => {
  function offerWithLines(lines: Record<string, unknown>[]) {
    return { id: "offer-1", lines };
  }

  const validLine = {
    packagingWeightProfileId: "profile-1",
    productGroupRaw: "Rose",
    varietyRaw: "Dallas",
    fobPricePerStem: { toString: () => "0.38" },
    currency: "USD",
    unit: "BOXES",
    stemLengthCm: 60,
    quantity: { toString: () => "5" },
    totalStems: 500,
  };

  it("confirms (REVIEWED) when every line is fully valid", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([validLine]));

    const result = await confirmFarmOffer("offer-1");

    expect(result.ok).toBe(true);
    expect(mockFarmOfferUpdate).toHaveBeenCalledWith({ where: { id: "offer-1" }, data: { status: "REVIEWED" } });
  });

  it("blocks when a line is unmatched (no packagingWeightProfileId)", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([{ ...validLine, packagingWeightProfileId: null }]));
    const result = await confirmFarmOffer("offer-1");
    expect(result.ok).toBe(false);
    expect(mockFarmOfferUpdate).not.toHaveBeenCalled();
  });

  it("blocks when price is missing", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([{ ...validLine, fobPricePerStem: null }]));
    const result = await confirmFarmOffer("offer-1");
    expect(result.ok).toBe(false);
  });

  it("blocks when currency is missing", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([{ ...validLine, currency: "" }]));
    const result = await confirmFarmOffer("offer-1");
    expect(result.ok).toBe(false);
  });

  it("blocks when unit is missing", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([{ ...validLine, unit: null }]));
    const result = await confirmFarmOffer("offer-1");
    expect(result.ok).toBe(false);
  });

  it("does not block on warnings alone (e.g. missing length) - confirms per the existing helper's behavior", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([{ ...validLine, stemLengthCm: null }]));
    const result = await confirmFarmOffer("offer-1");
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section 26.G: bulk/manual add matching
// ---------------------------------------------------------------------------

describe("addManualOfferLine - routes through the supplier-scoped matcher", () => {
  it("a manually added line gets matched against the farm's assortment, not left unconditionally UNMATCHED", async () => {
    mockFarmOfferFindUniqueOrThrow.mockResolvedValue({ farmId: FARM_ID });
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]);

    const fd = new FormData();
    fd.set("productGroupRaw", "Rose");
    fd.set("varietyRaw", "Dallas");
    fd.set("stemLengthCm", "60");
    fd.set("fobPricePerStem", "0.38");

    await addManualOfferLine("offer-1", fd);

    expect(mockPackagingWeightProfileFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { farmId: FARM_ID } }));
    const data = mockFarmOfferLineCreate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBe("profile-dallas");
    expect(data.matchStatus).toBe("AUTO_MATCHED");
  });

  it("never uses the old global, unscoped ProductVariant.variety lookup", async () => {
    mockFarmOfferFindUniqueOrThrow.mockResolvedValue({ farmId: FARM_ID });
    mockPackagingWeightProfileFindMany.mockResolvedValue([]);

    const fd = new FormData();
    fd.set("varietyRaw", "Dallas");
    await addManualOfferLine("offer-1", fd);

    expect(mockProductVariantFindMany).not.toHaveBeenCalled();
  });
});

describe("bulkAddOfferLines - routes through the supplier-scoped matcher", () => {
  it("matches a pasted description against this farm's assortment (loaded once), never the old global lookup", async () => {
    mockFarmOfferFindUniqueOrThrow.mockResolvedValue({ id: "offer-1", farmId: FARM_ID });
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]);

    const fd = new FormData();
    fd.set("rows", "Dallas\t100\t0.38\nNonexistent\t50\t0.20");
    await bulkAddOfferLines("offer-1", fd);

    expect(mockPackagingWeightProfileFindMany).toHaveBeenCalledTimes(1);
    expect(mockProductVariantFindMany).not.toHaveBeenCalled();
    expect(mockFarmOfferLineCreate).toHaveBeenCalledTimes(2);

    const firstLine = mockFarmOfferLineCreate.mock.calls[0][0].data;
    const secondLine = mockFarmOfferLineCreate.mock.calls[1][0].data;
    expect(firstLine.matchStatus).not.toBe("UNMATCHED");
    expect(secondLine.matchStatus).toBe("UNMATCHED");
    expect(secondLine.packagingWeightProfileId).toBeNull();
  });
});
