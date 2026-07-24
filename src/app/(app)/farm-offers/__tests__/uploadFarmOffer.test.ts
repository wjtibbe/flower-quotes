import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks every side-effecting dependency `uploadFarmOffer` touches (session,
// database, navigation, and the import pipeline itself) so these tests
// exercise only the action's own control flow - source validation -> import
// -> atomic persistence - never a real database or a real AI call. Section 9
// ("Transactie en partiële opslag") is exactly what these tests verify: a
// parser failure or a mid-transaction database failure must leave nothing
// behind, and only a fully successful import may persist anything at all.

// `@/lib/auth` imports the "server-only" package, whose real implementation
// unconditionally throws outside Next.js's own server-only webpack aliasing -
// harmless in the real app (Next swaps it for a no-op at build time), but it
// needs a no-op mock here so this plain-Node Vitest run can import the auth
// config at all.
vi.mock("server-only", () => ({}));

const mockGetServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...args: unknown[]) => mockGetServerSession(...args) }));

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => mockRedirect(...args) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockFarmFindUnique = vi.fn();
const mockSourceUploadCreate = vi.fn();
const mockFarmOfferCreate = vi.fn();
const mockTransaction = vi.fn();
// Assortment matching (loadFarmAssortmentCandidates) queries this directly -
// empty by default (no assortment configured), which correctly drives every
// line to UNMATCHED unless a test overrides it to exercise matching itself.
const mockPackagingWeightProfileFindMany = vi.fn();
// applySupplierMappingsThenMatch's batch mapping lookup - empty by default
// (no supplier mappings saved), so these tests exercise the deterministic
// matcher exactly as before the supplier-mapping step existed, unless a test
// explicitly overrides it.
const mockSupplierLineMappingFindMany = vi.fn();
const mockSupplierLineMappingUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    farm: { findUnique: (...args: unknown[]) => mockFarmFindUnique(...args) },
    packagingWeightProfile: { findMany: (...args: unknown[]) => mockPackagingWeightProfileFindMany(...args) },
    supplierLineMapping: {
      findMany: (...args: unknown[]) => mockSupplierLineMappingFindMany(...args),
      update: (...args: unknown[]) => mockSupplierLineMappingUpdate(...args),
    },
    $transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

const mockRunImport = vi.fn();
const mockRunPastedTextImport = vi.fn();

vi.mock("@/lib/import", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/import")>();
  return {
    ...actual,
    runImport: (...args: unknown[]) => mockRunImport(...args),
    runPastedTextImport: (...args: unknown[]) => mockRunPastedTextImport(...args),
  };
});

const { uploadFarmOffer } = await import("../actions");

const VALID_FARM = { name: "Test Farm", country: "Colombia", defaultCurrency: "USD" };
const VALID_LINE = {
  rawText: "Dallas 60cm 0.38",
  productGroupRaw: "Rose",
  varietyRaw: "Dallas",
  treatmentRaw: "normal",
  boxType: "QB",
  boxesAvailable: 10,
  stemsPerBox: 100,
  fobPricePerStem: "0.38",
  currency: "USD",
  confidence: "high",
  fieldConfidence: {},
  needsReview: false,
  parserWarnings: [],
};

function formDataWithText(farmId: string, pastedText: string) {
  const fd = new FormData();
  fd.set("farmId", farmId);
  fd.set("pastedText", pastedText);
  return fd;
}

function txMock() {
  return {
    sourceUpload: { create: mockSourceUploadCreate },
    farmOffer: { create: mockFarmOfferCreate },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
  mockFarmFindUnique.mockResolvedValue(VALID_FARM);
  mockPackagingWeightProfileFindMany.mockResolvedValue([]);
  mockSupplierLineMappingFindMany.mockResolvedValue([]);
  mockSupplierLineMappingUpdate.mockResolvedValue({});
  mockSourceUploadCreate.mockResolvedValue({ id: "upload-1" });
  mockFarmOfferCreate.mockResolvedValue({ id: "offer-1" });
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock()));
});

describe("uploadFarmOffer - transaction behavior", () => {
  it("does not create SourceUpload/FarmOffer when the parser reports a fatalError", async () => {
    mockRunPastedTextImport.mockResolvedValue({ sourceKind: "MANUAL", rawText: "hi", lines: [], fatalError: "Geen regels gevonden." });

    const state = await uploadFarmOffer({}, formDataWithText("farm-1", "hallo, geen aanbieding hier"));

    expect(state).toEqual({ error: "Geen regels gevonden." });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockSourceUploadCreate).not.toHaveBeenCalled();
    expect(mockFarmOfferCreate).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("rolls back (persists nothing visible) when the database transaction itself fails", async () => {
    mockRunPastedTextImport.mockResolvedValue({ sourceKind: "MANUAL", rawText: "Dallas 60cm 0.38", lines: [VALID_LINE] });
    mockTransaction.mockRejectedValue(new Error("connection reset"));

    const state = await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    expect(state).toEqual({ error: "Opslaan is mislukt door een databasefout. Probeer het opnieuw." });
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it("creates SourceUpload + FarmOffer + lines and redirects only on a fully successful import", async () => {
    mockRunPastedTextImport.mockResolvedValue({ sourceKind: "MANUAL", rawText: "Dallas 60cm 0.38", lines: [VALID_LINE] });

    const state = await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockSourceUploadCreate).toHaveBeenCalledTimes(1);
    expect(mockFarmOfferCreate).toHaveBeenCalledTimes(1);
    expect(mockRedirect).toHaveBeenCalledWith("/farm-offers/offer-1/review");
    // In the real app `redirect()` always throws to interrupt rendering, so
    // nothing after it ever runs; the mock here doesn't throw, so the
    // function simply falls through and returns undefined - what actually
    // matters is that it did NOT return an `{ error }` state.
    expect(state).toBeUndefined();
  });

  it("persists lengthCm as the dedicated stemLengthCm column, via the shared mapping helper - never folded into varietyRaw", async () => {
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "Dallas 60cm 0.38",
      lines: [{ ...VALID_LINE, lengthCm: 60 }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    const createArgs = mockFarmOfferCreate.mock.calls[0][0];
    const createdLine = createArgs.data.lines.create[0];
    expect(createdLine.varietyRaw).toBe("Dallas");
    expect(createdLine.stemLengthCm).toBe(60);
    expect(createdLine).not.toHaveProperty("lengthCm");
  });
});

describe("uploadFarmOffer - pasted text source", () => {
  it("routes pasted text through runPastedTextImport with the selected supplier's context", async () => {
    mockRunPastedTextImport.mockResolvedValue({ sourceKind: "MANUAL", rawText: "Dallas 60cm 0.38", lines: [VALID_LINE] });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    expect(mockRunPastedTextImport).toHaveBeenCalledWith(
      "Dallas 60cm 0.38",
      expect.objectContaining({ supplierName: "Test Farm", supplierCountry: "Colombia" }),
    );
    expect(mockRunImport).not.toHaveBeenCalled();
  });

  it("stores the exact pasted text as SourceUpload.rawText with no file bytes", async () => {
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "Dallas 60cm 0.38",
      lines: [VALID_LINE],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    const createArgs = mockSourceUploadCreate.mock.calls[0][0];
    expect(createArgs.data.rawText).toBe("Dallas 60cm 0.38");
    expect(createArgs.data.fileData).toBeNull();
    expect(createArgs.data.originalName).toBe("Pasted text");
    expect(createArgs.data.fileType).toBe("MANUAL");
  });
});

// A single PackagingWeightProfile row, shaped exactly like the nested
// Prisma result `loadFarmAssortmentCandidates` maps from (see
// assortmentRepository.test.ts for that mapping in isolation).
function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    farmId: "farm-1",
    productVariantId: "variant-1",
    boxType: "QB",
    stemsPerBox: 100,
    weightPerBoxKg: { toString: () => "8.000" },
    productVariant: {
      productId: "product-1",
      variety: "Dallas",
      stemLength: "60 cm",
      product: { name: "Rosa Ec" },
    },
    ...overrides,
  };
}

describe("uploadFarmOffer - assortment matching (section 21)", () => {
  it("persists AUTO_MATCHED with its packagingWeightProfileId and productVariantId when exactly one assortment article matches", async () => {
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "Dallas 60cm 0.38",
      lines: [{ ...VALID_LINE, lengthCm: 60 }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.matchStatus).toBe("AUTO_MATCHED");
    expect(createdLine.packagingWeightProfileId).toBe("profile-1");
    expect(createdLine.productVariantId).toBe("variant-1");
  });

  it("persists AMBIGUOUS with a null packagingWeightProfileId when two packagings match the same product/variety/length", async () => {
    mockPackagingWeightProfileFindMany.mockResolvedValue([
      profileRow({ id: "p-qb", boxType: "QB", stemsPerBox: 100 }),
      profileRow({ id: "p-hb", boxType: "HB", stemsPerBox: 200 }),
    ]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "Dallas 60cm 0.38",
      lines: [{ ...VALID_LINE, lengthCm: 60 }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.matchStatus).toBe("AMBIGUOUS");
    expect(createdLine.packagingWeightProfileId).toBeNull();
    // Still resolvable since both packagings share the exact same ProductVariant.
    expect(createdLine.productVariantId).toBe("variant-1");
  });

  it("persists DERIVED when the product is missing but variety+length uniquely determine one", async () => {
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "Dallas 60cm 0.38",
      lines: [{ ...VALID_LINE, productGroupRaw: undefined, lengthCm: 60 }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.matchStatus).toBe("DERIVED");
    expect(createdLine.packagingWeightProfileId).toBe("profile-1");
    expect(createdLine.productVariantId).toBe("variant-1");
  });

  it("stays UNMATCHED with a null packagingWeightProfileId when nothing in the assortment matches", async () => {
    mockPackagingWeightProfileFindMany.mockResolvedValue([]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "Dallas 60cm 0.38",
      lines: [{ ...VALID_LINE, lengthCm: 60 }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.matchStatus).toBe("UNMATCHED");
    expect(createdLine.packagingWeightProfileId).toBeNull();
  });

  it("loads the farm's assortment exactly once per offer, regardless of how many lines it has", async () => {
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "many lines",
      lines: Array.from({ length: 5 }, () => ({ ...VALID_LINE, lengthCm: 60 })),
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "many lines"));

    expect(mockPackagingWeightProfileFindMany).toHaveBeenCalledTimes(1);
    expect(mockFarmOfferCreate.mock.calls[0][0].data.lines.create).toHaveLength(5);
  });

  it("never persists a profile belonging to a different farm, even if the loaded candidate list somehow contained one", async () => {
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow({ id: "p-other-farm", farmId: "farm-999" })]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "Dallas 60cm 0.38",
      lines: [{ ...VALID_LINE, lengthCm: 60 }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.packagingWeightProfileId).not.toBe("p-other-farm");
    expect(createdLine.matchStatus).toBe("UNMATCHED");
  });

  it("never writes matching data (packagingWeightProfileId/matchStatus) into extractedSnapshot", async () => {
    mockPackagingWeightProfileFindMany.mockResolvedValue([profileRow()]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "Dallas 60cm 0.38",
      lines: [{ ...VALID_LINE, lengthCm: 60 }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "Dallas 60cm 0.38"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.extractedSnapshot).not.toHaveProperty("packagingWeightProfileId");
    expect(createdLine.extractedSnapshot).not.toHaveProperty("matchStatus");
  });
});

describe("uploadFarmOffer - validation", () => {
  it("rejects the upload when no supplier is selected", async () => {
    const state = await uploadFarmOffer({}, formDataWithText("", "Dallas 60cm 0.38"));
    expect(state.error).toMatch(/leverancier/i);
    expect(mockRunPastedTextImport).not.toHaveBeenCalled();
  });

  it("rejects a supplier id that no longer resolves to a real farm", async () => {
    mockFarmFindUnique.mockResolvedValue(null);
    const state = await uploadFarmOffer({}, formDataWithText("farm-deleted", "Dallas 60cm 0.38"));
    expect(state.error).toMatch(/leverancier/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects when both a file and pasted text are present", async () => {
    const fd = new FormData();
    fd.set("farmId", "farm-1");
    fd.set("pastedText", "Dallas 60cm 0.38");
    fd.set("file", new File(["hi"], "offer.txt", { type: "text/plain" }));

    const state = await uploadFarmOffer({}, fd);
    expect(state.error).toMatch(/niet allebei/i);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects when neither a file nor pasted text is present", async () => {
    const state = await uploadFarmOffer({}, formDataWithText("farm-1", ""));
    expect(state.error).toBeTruthy();
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Deterministic enrichment from trusted data (the "Sweetness" example):
// once a line matches a concrete PackagingWeightProfile, that profile's own
// canonical packaging becomes the CURRENT line, quantity/unit are backfilled
// from boxesAvailable, a Colombia/Ecuador farm defaults missing currency to
// USD, totalStems is calculated, and the warnings this resolves disappear -
// while rawText/extractedSnapshot keep the ORIGINAL extraction (HB included).
// ---------------------------------------------------------------------------

function sweetnessProfileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-sweetness",
    farmId: "farm-1",
    productVariantId: "variant-sweetness",
    boxType: "QB",
    stemsPerBox: 125,
    weightPerBoxKg: { toString: () => "7.000" },
    productVariant: {
      productId: "product-rosa-ec",
      variety: "Sweetness",
      stemLength: "40 cm",
      product: { name: "Rosa Ec" },
    },
    ...overrides,
  };
}

const SWEETNESS_LINE = {
  rawText: "2hb Sweetness 40cm",
  productGroupRaw: "Rose",
  varietyRaw: "Sweetness",
  lengthCm: 40,
  boxType: "HB",
  boxesAvailable: 2,
  fobPricePerStem: "0.16",
  confidence: "medium",
  fieldConfidence: {},
  needsReview: true,
  parserWarnings: ["stemsPerBox not stated.", "Valuta niet vermeld in de bron - controleer bij review."],
};

describe("uploadFarmOffer - deterministic enrichment from trusted data", () => {
  it("1-9: canonical packaging, backfilled quantity/unit, supplier default currency, totalStems, and rawText/snapshot preserved", async () => {
    mockFarmFindUnique.mockResolvedValue({ name: "Mystic Flowers", country: "Colombia", defaultCurrency: "USD" });
    mockPackagingWeightProfileFindMany.mockResolvedValue([sweetnessProfileRow()]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "2hb Sweetness 40cm",
      lines: [SWEETNESS_LINE],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "2hb Sweetness 40cm"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];

    // 1: source normalizes to QB.
    expect(createdLine.boxType).toBe("QB");
    // 2: rawText is exactly the original supplier text.
    expect(createdLine.rawText).toBe("2hb Sweetness 40cm");
    // 3: extractedSnapshot preserves the original HB extraction.
    expect(createdLine.extractedSnapshot.boxType).toBe("HB");
    expect(createdLine.extractedSnapshot.rawText).toBe("2hb Sweetness 40cm");
    // 4: matched the Rosa Ec/Sweetness/40 profile.
    expect(createdLine.matchStatus).toBe("AUTO_MATCHED");
    expect(createdLine.packagingWeightProfileId).toBe("profile-sweetness");
    // 5/6: canonical stemsPerBox/weightPerBoxKg from the matched profile.
    expect(createdLine.stemsPerBox).toBe(125);
    expect(createdLine.weightPerBoxKg).toBe("7.000");
    // 7: quantity(2 boxes) x stemsPerBox(125) = totalStems 250.
    expect(createdLine.quantity).toBe("2");
    expect(createdLine.unit).toBe("BOXES");
    expect(createdLine.totalStems).toBe(250);
    // 8: supplier defaultCurrency USD + no explicit currency -> USD.
    expect(createdLine.currency).toBe("USD");
    // 20: extractedSnapshot keeps the ORIGINAL, unfiltered parserWarnings.
    expect(createdLine.extractedSnapshot.parserWarnings).toEqual([
      "stemsPerBox not stated.",
      "Valuta niet vermeld in de bron - controleer bij review.",
    ]);
    // 12/13: the resolved stemsPerBox/currency warnings are gone from the
    // CURRENT validationWarnings, even though they remain in the snapshot.
    expect(createdLine.validationWarnings ?? []).toEqual([]);
  });

  it("5: a supplier defaulting to EUR resolves a missing source currency to EUR", async () => {
    mockFarmFindUnique.mockResolvedValue({ name: "Euro Farm", country: "Netherlands", defaultCurrency: "EUR" });
    mockPackagingWeightProfileFindMany.mockResolvedValue([sweetnessProfileRow()]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "2hb Sweetness 40cm",
      lines: [{ ...SWEETNESS_LINE, parserWarnings: [] }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "2hb Sweetness 40cm"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.currency).toBe("EUR");
  });

  it("6: an explicit EUR from a supplier defaulting to USD is preserved, never overwritten", async () => {
    mockFarmFindUnique.mockResolvedValue({ name: "Mystic Flowers", country: "Colombia", defaultCurrency: "USD" });
    mockPackagingWeightProfileFindMany.mockResolvedValue([sweetnessProfileRow()]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "2hb Sweetness 40cm EUR 0.20",
      lines: [{ ...SWEETNESS_LINE, currency: "EUR", fobPricePerStem: "0.20", parserWarnings: [] }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "2hb Sweetness 40cm EUR 0.20"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.currency).toBe("EUR");
  });

  it("7: an explicit USD from a supplier defaulting to EUR is preserved", async () => {
    mockFarmFindUnique.mockResolvedValue({ name: "Euro Farm", country: "Netherlands", defaultCurrency: "EUR" });
    mockPackagingWeightProfileFindMany.mockResolvedValue([sweetnessProfileRow()]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "2hb Sweetness 40cm USD 0.16",
      lines: [{ ...SWEETNESS_LINE, currency: "USD", parserWarnings: [] }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "2hb Sweetness 40cm USD 0.16"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.currency).toBe("USD");
  });

  it("15: a genuinely unresolved field (no assortment match at all) still generates a warning/needs review", async () => {
    mockFarmFindUnique.mockResolvedValue({ name: "Mystic Flowers", country: "Colombia", defaultCurrency: "USD" });
    mockPackagingWeightProfileFindMany.mockResolvedValue([]); // nothing to match against
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "2hb Sweetness 40cm",
      lines: [{ ...SWEETNESS_LINE, parserWarnings: ["stemsPerBox not stated."] }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "2hb Sweetness 40cm"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.matchStatus).toBe("UNMATCHED");
    // No matched profile - stemsPerBox truly is still unknown, so the
    // warning about it must NOT be suppressed.
    expect(createdLine.validationWarnings).toContain("stemsPerBox not stated.");
  });

  it("12/16: two consecutive imports both use the supplier default currency and the same matched profile automatically, no human confirmation", async () => {
    mockFarmFindUnique.mockResolvedValue({ name: "Mystic Flowers", country: "Colombia", defaultCurrency: "USD" });
    mockPackagingWeightProfileFindMany.mockResolvedValue([sweetnessProfileRow()]);
    mockSupplierLineMappingFindMany.mockResolvedValue([]); // no saved mapping exists
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "2hb Sweetness 40cm",
      lines: [{ ...SWEETNESS_LINE, parserWarnings: [] }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "2hb Sweetness 40cm"));
    await uploadFarmOffer({}, formDataWithText("farm-1", "2hb Sweetness 40cm"));

    const firstLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    const secondLine = mockFarmOfferCreate.mock.calls[1][0].data.lines.create[0];
    for (const created of [firstLine, secondLine]) {
      expect(created.matchStatus).toBe("AUTO_MATCHED");
      expect(created.packagingWeightProfileId).toBe("profile-sweetness");
      expect(created.stemsPerBox).toBe(125);
      expect(created.totalStems).toBe(250);
      expect(created.currency).toBe("USD");
    }
  });

  it("17: an existing SupplierLineMapping still takes precedence over the deterministic engine", async () => {
    mockFarmFindUnique.mockResolvedValue({ name: "Mystic Flowers", country: "Colombia", defaultCurrency: "USD" });
    mockPackagingWeightProfileFindMany.mockResolvedValue([
      sweetnessProfileRow({ id: "profile-sweetness" }),
      sweetnessProfileRow({
        id: "profile-mapped",
        productVariantId: "variant-mapped",
        stemsPerBox: 200,
        weightPerBoxKg: { toString: () => "9.000" },
      }),
    ]);
    mockSupplierLineMappingFindMany.mockResolvedValue([
      {
        id: "mapping-1",
        farmId: "farm-1",
        normalizedSource: "2hb sweetness 40cm",
        packagingWeightProfileId: "profile-mapped",
        packagingWeightProfile: { farmId: "farm-1", productVariantId: "variant-mapped" },
      },
    ]);
    mockRunPastedTextImport.mockResolvedValue({
      sourceKind: "MANUAL",
      rawText: "2hb Sweetness 40cm",
      lines: [{ ...SWEETNESS_LINE, parserWarnings: [] }],
    });

    await uploadFarmOffer({}, formDataWithText("farm-1", "2hb Sweetness 40cm"));

    const createdLine = mockFarmOfferCreate.mock.calls[0][0].data.lines.create[0];
    expect(createdLine.matchStatus).toBe("USER_LINKED");
    expect(createdLine.packagingWeightProfileId).toBe("profile-mapped");
    // Enrichment used the MAPPED profile's own canonical packaging, not the
    // deterministic engine's candidate.
    expect(createdLine.stemsPerBox).toBe(200);
    expect(createdLine.weightPerBoxKg).toBe("9.000");
  });
});
