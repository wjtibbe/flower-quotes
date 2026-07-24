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
    mockPackagingWeightProfileFindUnique.mockResolvedValue({
      id: "profile-hb",
      farmId: FARM_ID,
      productVariantId: "variant-hb",
      boxType: "HB",
      stemsPerBox: 12,
      weightPerBoxKg: { toString: () => "4.500" },
      productVariant: { variety: "Freedom", stemLength: "60 cm", product: { name: "Rosa Ec" } },
    });

    const result = await selectPackagingProfile("line-1", "profile-hb");

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBe("profile-hb");
    expect(data.productVariantId).toBe("variant-hb");
    expect(data.matchStatus).toBe("USER_LINKED");
    // Task 1: the profile's own canonical packaging is now persisted onto the line.
    expect(data.boxType).toBe("HB");
    expect(data.stemsPerBox).toBe(12);
    expect(data.weightPerBoxKg).toBe("4.500");
    // Boulevard fix: canonical product identity is now persisted too.
    expect(data.productGroupRaw).toBe("Rosa Ec");
    expect(data.varietyRaw).toBe("Freedom");
    expect(data.stemLengthCm).toBe(60);
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
    mockProductVariantFindFirst.mockResolvedValue({ id: "variant-1", variety: "Dallas", stemLength: "60 cm" });
    mockPackagingWeightProfileFindFirst.mockResolvedValue(null);
    mockPackagingWeightProfileCreate.mockResolvedValue({
      id: "brand-new-profile",
      boxType: "QB",
      stemsPerBox: 100,
      weightPerBoxKg: { toString: () => "8.000" },
    });

    const result = await createAssortmentItemFromOfferLine("line-1", createFormData());

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.packagingWeightProfileId).toBe("brand-new-profile");
    expect(data.productVariantId).toBe("variant-1");
    expect(data.matchStatus).toBe("USER_LINKED");
    // Task 1: the newly-created profile's own canonical packaging is persisted onto the line.
    expect(data.boxType).toBe("QB");
    expect(data.stemsPerBox).toBe(100);
    expect(data.weightPerBoxKg).toBe("8.000");
    // Boulevard fix: the resolved product's canonical identity is persisted too.
    expect(data.productGroupRaw).toBe("Rose");
    expect(data.varietyRaw).toBe("Dallas");
    expect(data.stemLengthCm).toBe(60);
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
// Task 1: canonical packaging enrichment - regression suite
// ---------------------------------------------------------------------------
// Real-world bug: "5hb candy xpression 60cm" was matched via a saved
// SupplierLineMapping (or a manual "Change match"), showing "Manually
// matched" with the correct product/variety/length/quantity/price, but
// stemsPerBox and box weight stayed empty and the "stemsPerBox not stated" /
// "Totaal aantal stelen kon niet worden berekend" warnings never cleared -
// because `selectPackagingProfile` and `createAssortmentItemFromOfferLine`
// linked the profile without ever copying ITS canonical packaging onto the
// line, unlike the upload-time enrichment AUTO_MATCHED/mapped lines already
// got (see `uploadFarmOffer.test.ts`, tests "1-9" and "17"). This suite
// covers the exact scenario end to end, plus the shared invariants: warnings
// clear, extractedSnapshot is never touched, and enrichment never fires
// without a confirmed single profile or across suppliers.

describe("Task 1: canonical packaging enrichment - regression suite", () => {
  it("3/5/6: Candy X-Pression - manual selection resolves stemsPerBox/weight, computes totalStems (5x100=500), and clears the stale warnings", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(
      baseFarmOfferLine({
        rawText: "5hb candy xpression 60cm",
        varietyRaw: "Candy X-Pression",
        boxType: null,
        stemsPerBox: null,
        weightPerBoxKg: null,
        quantity: { toString: () => "5" },
        unit: "BOXES",
        matchStatus: "UNMATCHED",
        packagingWeightProfileId: null,
        extractedSnapshot: {
          parserWarnings: ["stemsPerBox not stated.", "Totaal aantal stelen kon niet worden berekend."],
        },
      }),
    );
    mockPackagingWeightProfileFindUnique.mockResolvedValue({
      id: "profile-candy",
      farmId: FARM_ID,
      productVariantId: "variant-candy",
      boxType: "QB",
      stemsPerBox: 100,
      weightPerBoxKg: { toString: () => "8.000" },
      productVariant: { variety: "Candy X-Pression", stemLength: "60 cm", product: { name: "Rosa Ec" } },
    });

    const result = await selectPackagingProfile("line-1", "profile-candy");

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.boxType).toBe("QB");
    expect(data.stemsPerBox).toBe(100);
    expect(data.weightPerBoxKg).toBe("8.000");
    expect(data.totalStems).toBe(500);
    // 6: the now-resolved warnings are gone from the CURRENT validationWarnings.
    expect(data.validationWarnings ?? []).not.toContain("stemsPerBox not stated.");
    expect(data.validationWarnings ?? []).not.toContain("Totaal aantal stelen kon niet worden berekend.");
  });

  it("4: a newly-created assortment item also resolves stemsPerBox/weight and totalStems", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(
      baseFarmOfferLine({
        boxType: null,
        stemsPerBox: null,
        weightPerBoxKg: null,
        quantity: { toString: () => "5" },
        unit: "BOXES",
        matchStatus: "UNMATCHED",
        packagingWeightProfileId: null,
      }),
    );
    mockProductFindFirst.mockResolvedValue({ id: "product-1", name: "Rosa Ec" });
    mockProductVariantFindFirst.mockResolvedValue({ id: "variant-candy" });
    mockPackagingWeightProfileFindFirst.mockResolvedValue(null);
    mockPackagingWeightProfileCreate.mockResolvedValue({
      id: "profile-candy",
      boxType: "QB",
      stemsPerBox: 100,
      weightPerBoxKg: { toString: () => "8.000" },
    });

    const fd = new FormData();
    fd.set("productName", "Rosa Ec");
    fd.set("variety", "Candy X-Pression");
    fd.set("stemLength", "60");
    fd.set("boxType", "QB");
    fd.set("stemsPerBox", "100");
    fd.set("weightPerBoxKg", "8");
    const result = await createAssortmentItemFromOfferLine("line-1", fd);

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.stemsPerBox).toBe(100);
    expect(data.weightPerBoxKg).toBe("8.000");
    expect(data.totalStems).toBe(500);
  });

  it("1/2 (regression guard): a rematch onto AUTO_MATCHED also applies the new profile's canonical packaging, not the stale form values", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindMany.mockResolvedValue([
      profileRow({
        id: "profile-freedom",
        productVariantId: "variant-freedom",
        boxType: "HB",
        stemsPerBox: 12,
        weightPerBoxKg: { toString: () => "4.500" },
        productVariant: { productId: "p1", variety: "Freedom", stemLength: "60 cm", product: { name: "Rosa Ec" } },
      }),
    ]);

    // The form still carries the OLD product's packaging (100/QB/8) - the
    // corrected variety rematches to a DIFFERENT profile whose own canonical
    // values (HB/12/4.500) must win instead.
    const result = await updateOfferLine(
      "line-1",
      updateFormData({ varietyRaw: "Freedom", quantity: "5", unit: "BOXES" }),
    );

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.matchStatus).toBe("AUTO_MATCHED");
    expect(data.boxType).toBe("HB");
    expect(data.stemsPerBox).toBe(12);
    expect(data.weightPerBoxKg).toBe("4.500");
    expect(data.totalStems).toBe(60); // 5 boxes x 12 stems
  });

  it("8: no enrichment occurs for AMBIGUOUS - the reviewer's own typed packaging is preserved untouched", async () => {
    // Existing variety differs from the submitted one, so a rematch actually
    // triggers (a no-op edit never re-queries the assortment at all).
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine({ varietyRaw: "OldVariety" }));
    // Two packagings for the SAME product/variety/length -> AMBIGUOUS status,
    // no single profile to trust.
    mockPackagingWeightProfileFindMany.mockResolvedValue([
      profileRow({ id: "p-qb", boxType: "QB", stemsPerBox: 100 }),
      profileRow({ id: "p-hb", boxType: "HB", stemsPerBox: 200 }),
    ]);

    const result = await updateOfferLine(
      "line-1",
      updateFormData({ varietyRaw: "Dallas", boxType: "FB", stemsPerBox: "77", weightPerBoxKg: "3.3" }),
    );

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.matchStatus).toBe("AMBIGUOUS");
    // No confirmed single profile - the reviewer's own typed values survive.
    expect(data.boxType).toBe("FB");
    expect(data.stemsPerBox).toBe(77);
    expect(data.weightPerBoxKg).toBe("3.3");
  });

  it("8 (UNMATCHED): no enrichment occurs when correction lands on UNMATCHED either", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]);

    const result = await updateOfferLine(
      "line-1",
      updateFormData({ varietyRaw: "Dalas", boxType: "FB", stemsPerBox: "77", weightPerBoxKg: "3.3" }),
    );

    expect(result.ok).toBe(true);
    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data.matchStatus).toBe("UNMATCHED");
    expect(data.boxType).toBe("FB");
    expect(data.stemsPerBox).toBe(77);
    expect(data.weightPerBoxKg).toBe("3.3");
  });

  it("7: extractedSnapshot is never part of the update payload - the audit trail stays untouched by enrichment", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindUnique.mockResolvedValue({
      id: "profile-hb",
      farmId: FARM_ID,
      productVariantId: "variant-hb",
      boxType: "HB",
      stemsPerBox: 12,
      weightPerBoxKg: { toString: () => "4.500" },
      productVariant: { variety: "Freedom", stemLength: "60 cm", product: { name: "Rosa Ec" } },
    });

    await selectPackagingProfile("line-1", "profile-hb");

    const data = mockFarmOfferLineUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty("extractedSnapshot");
    expect(data).not.toHaveProperty("rawText");
  });

  it("9: a profile from another supplier can never enrich the line (rejected before any update)", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(baseFarmOfferLine());
    mockPackagingWeightProfileFindUnique.mockResolvedValue({
      id: "profile-other-farm",
      farmId: "farm-other",
      productVariantId: "variant-x",
      boxType: "FB",
      stemsPerBox: 999,
      weightPerBoxKg: { toString: () => "1.000" },
    });

    const result = await selectPackagingProfile("line-1", "profile-other-farm");

    expect(result.ok).toBe(false);
    expect(mockFarmOfferLineUpdate).not.toHaveBeenCalled();
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

  // G/H (streamline-reviewed-workflow fix): the client only ever navigates to
  // the reviewed detail page (/farm-offers/[id]) when this action resolves
  // {ok:true} - it stays on the review page and shows the message otherwise.
  // These two tests pin down that contract at the server-action boundary
  // (the actual client-side router.push/stay-put branching lives in
  // ReviewOfferClient.tsx and is exercised by its own component logic, which
  // this repo has no DOM-rendering test harness for - see the PR/report).
  it("G: a successful confirmation resolves {ok:true} - the client's sole redirect signal", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([validLine]));
    const result = await confirmFarmOffer("offer-1");
    expect(result.ok).toBe(true);
  });

  it("H: a blocked confirmation resolves {ok:false} without ever updating the offer status - the client never navigates away", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([{ ...validLine, currency: "" }]));
    const result = await confirmFarmOffer("offer-1");
    expect(result.ok).toBe(false);
    expect(mockFarmOfferUpdate).not.toHaveBeenCalled();
  });

  // Task 4 (hanging confirm): confirmFarmOffer used to have NO try/catch
  // around its database calls, so a thrown error (a transient DB failure,
  // here simulated) propagated uncaught instead of resolving to an
  // ActionResult - the exact condition that left the client's pending state
  // stuck with no feedback. It must now always resolve.
  it("a database failure while reading the offer resolves {ok:false} instead of throwing (never hangs the caller)", async () => {
    mockFarmOfferFindUnique.mockRejectedValue(new Error("connection reset"));
    await expect(confirmFarmOffer("offer-1")).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(mockFarmOfferUpdate).not.toHaveBeenCalled();
  });

  it("a database failure while writing the REVIEWED status resolves {ok:false} instead of throwing", async () => {
    mockFarmOfferFindUnique.mockResolvedValue(offerWithLines([validLine]));
    mockFarmOfferUpdate.mockRejectedValueOnce(new Error("connection reset"));
    await expect(confirmFarmOffer("offer-1")).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
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
