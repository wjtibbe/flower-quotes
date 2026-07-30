import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: () => mockGetServerSession() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const mockGetServerSession = vi.fn();

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

const mockFarmFindUnique = vi.fn();
const mockFarmOfferCreate = vi.fn();
const mockFarmOfferFindUnique = vi.fn();
const mockProfileCount = vi.fn();
const mockProfileFindMany = vi.fn();
const mockFarmOfferLineCreate = vi.fn();
const mockTransaction = vi.fn((ops: unknown[]) => Promise.all(ops));

vi.mock("@/lib/db", () => ({
  prisma: {
    farm: { findUnique: (...a: unknown[]) => mockFarmFindUnique(...a) },
    farmOffer: {
      create: (...a: unknown[]) => mockFarmOfferCreate(...a),
      findUnique: (...a: unknown[]) => mockFarmOfferFindUnique(...a),
    },
    packagingWeightProfile: {
      count: (...a: unknown[]) => mockProfileCount(...a),
      findMany: (...a: unknown[]) => mockProfileFindMany(...a),
    },
    farmOfferLine: { create: (...a: unknown[]) => mockFarmOfferLineCreate(...a) },
    $transaction: (ops: unknown[]) => mockTransaction(ops),
  },
}));

const { createManualFarmOffer, searchManualOfferAssortment, saveManualOfferLines } = await import(
  "../manualOfferActions"
);

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const FARM_ID = "farm-1";
const OFFER_ID = "offer-1";
const PROFILE_A = {
  id: "profile-a",
  farmId: FARM_ID,
  productVariantId: "variant-a",
  boxType: "HB",
  stemsPerBox: 25,
  weightPerBoxKg: { toString: () => "8.5" },
  effectiveFrom: new Date("2020-01-01"),
  effectiveTo: null,
  productVariant: {
    id: "variant-a",
    variety: "Freedom",
    color: "Red",
    grade: "Premium",
    treatment: "normal",
    stemLength: "60 cm",
    product: { name: "Rose" },
  },
};
const PROFILE_B = {
  ...PROFILE_A,
  id: "profile-b",
  productVariantId: "variant-b",
  productVariant: { ...PROFILE_A.productVariant, id: "variant-b", variety: "Vendela" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: "user-1" } });
  mockFarmFindUnique.mockResolvedValue({ id: FARM_ID, name: "Gutimilko", defaultCurrency: "USD" });
  mockFarmOfferCreate.mockResolvedValue({ id: OFFER_ID });
  mockFarmOfferFindUnique.mockResolvedValue({ id: OFFER_ID, farmId: FARM_ID, source: "MANUAL", status: "DRAFT" });
  mockProfileCount.mockResolvedValue(0);
  mockProfileFindMany.mockResolvedValue([PROFILE_A, PROFILE_B]);
  mockFarmOfferLineCreate.mockImplementation((args: unknown) => Promise.resolve({ id: "line-x", ...((args as { data: object }).data) }));
});

describe("createManualFarmOffer", () => {
  it("2: rejects when no supplier is selected", async () => {
    await expect(createManualFarmOffer(formData({}))).rejects.toThrow("REDIRECT:/farm-offers/manual?err=");
    expect(mockFarmOfferCreate).not.toHaveBeenCalled();
  });

  it("5: rejects when validUntil is before the offer date", async () => {
    await expect(
      createManualFarmOffer(formData({ farmId: FARM_ID, offerDate: "2026-06-01", validUntil: "2026-01-01" })),
    ).rejects.toThrow("REDIRECT:/farm-offers/manual?err=");
    expect(mockFarmOfferCreate).not.toHaveBeenCalled();
  });

  it("21: creates a normal FarmOffer with source MANUAL and status DRAFT, then redirects to the builder", async () => {
    await expect(createManualFarmOffer(formData({ farmId: FARM_ID }))).rejects.toThrow(
      `REDIRECT:/farm-offers/manual/${OFFER_ID}`,
    );
    expect(mockFarmOfferCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ farmId: FARM_ID, source: "MANUAL", status: "DRAFT" }),
      }),
    );
  });

  it("33: requires an authenticated session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(createManualFarmOffer(formData({ farmId: FARM_ID }))).rejects.toThrow("Niet ingelogd");
    expect(mockFarmOfferCreate).not.toHaveBeenCalled();
  });
});

describe("searchManualOfferAssortment", () => {
  it("6: returns paginated results (page/pageSize/totalCount/totalPages)", async () => {
    mockProfileCount.mockResolvedValue(45);
    mockProfileFindMany.mockResolvedValue([PROFILE_A]);
    const result = await searchManualOfferAssortment(FARM_ID, {}, 1);
    expect(result.pagination).toEqual(
      expect.objectContaining({ page: 1, pageSize: 20, totalCount: 45, totalPages: 3 }),
    );
  });

  it("7: excludes expired articles by default (only active assortment articles)", async () => {
    await searchManualOfferAssortment(FARM_ID, {}, 1);
    const where = mockProfileFindMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effectiveFrom: expect.anything() }),
        expect.objectContaining({ OR: expect.anything() }),
      ]),
    );
  });

  it("7: includes expired articles when includeInactive is explicitly requested", async () => {
    await searchManualOfferAssortment(FARM_ID, { includeInactive: true }, 1);
    const where = mockProfileFindMany.mock.calls[0][0].where;
    expect(where.AND).toBeUndefined();
  });

  it("is scoped to the given farm", async () => {
    await searchManualOfferAssortment(FARM_ID, {}, 1);
    const where = mockProfileFindMany.mock.calls[0][0].where;
    expect(where.farmId).toBe(FARM_ID);
  });
});

describe("saveManualOfferLines", () => {
  const validLine = (key = "profile-a") => ({
    key,
    packagingWeightProfileId: key,
    quantity: "2",
    unit: "BOXES" as const,
    fobPricePerStem: "1.25",
    notes: null,
  });

  it("22: creates one FarmOfferLine per selected article, in a single transaction", async () => {
    const result = await saveManualOfferLines(OFFER_ID, "USD" as never, [
      validLine("profile-a"),
      validLine("profile-b"),
    ]);
    expect(result.ok).toBe(true);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockFarmOfferLineCreate).toHaveBeenCalledTimes(2);
  });

  it("11/12: copies canonical assortment identity (product/variety/canonical article id) onto the line", async () => {
    await saveManualOfferLines(OFFER_ID, "USD" as never, [validLine("profile-a")]);
    const data = mockFarmOfferLineCreate.mock.calls[0][0].data;
    expect(data.productGroupRaw).toBe("Rose");
    expect(data.varietyRaw).toBe("Freedom");
    expect(data.packagingWeightProfileId).toBe("profile-a");
    expect(data.productVariantId).toBe("variant-a");
  });

  it("13/29: enriches packaging fields from the assortment profile as frozen scalar columns (survives later profile changes/deactivation)", async () => {
    await saveManualOfferLines(OFFER_ID, "USD" as never, [validLine("profile-a")]);
    const data = mockFarmOfferLineCreate.mock.calls[0][0].data;
    expect(data.boxType).toBe("HB");
    expect(data.stemsPerBox).toBe(25);
    expect(data.weightPerBoxKg).toBe("8.5");
  });

  it("14: uses the fixed manual-entry rawText placeholder, never a live-derived value", async () => {
    await saveManualOfferLines(OFFER_ID, "USD" as never, [validLine("profile-a")]);
    const data = mockFarmOfferLineCreate.mock.calls[0][0].data;
    expect(data.rawText).toBe("(handmatig ingevoerd)");
  });

  it("marks the line USER_LINKED with HIGH confidence and no review needed - a human explicitly picked the exact article", async () => {
    await saveManualOfferLines(OFFER_ID, "USD" as never, [validLine("profile-a")]);
    const data = mockFarmOfferLineCreate.mock.calls[0][0].data;
    expect(data.matchStatus).toBe("USER_LINKED");
    expect(data.confidence).toBe("HIGH");
    expect(data.needsReview).toBe(false);
  });

  it("10: rejects selecting the same canonical article twice in one save", async () => {
    const result = await saveManualOfferLines(OFFER_ID, "USD" as never, [
      validLine("profile-a"),
      { ...validLine("profile-a"), key: "profile-a-dup" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.lineErrors).length).toBeGreaterThan(0);
    expect(mockFarmOfferLineCreate).not.toHaveBeenCalled();
  });

  it("15/16: rejects missing or zero/negative quantity, reported on that line", async () => {
    const result = await saveManualOfferLines(OFFER_ID, "USD" as never, [{ ...validLine(), quantity: "0" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.lineErrors["profile-a"]).toMatch(/positief/);
  });

  it("17/18: rejects missing or zero/negative price, reported on that line", async () => {
    const result = await saveManualOfferLines(OFFER_ID, "USD" as never, [{ ...validLine(), fobPricePerStem: "-1" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.lineErrors["profile-a"]).toMatch(/positief/);
  });

  it("19: always stores the single controlled PER_STEM price unit, never a user-chosen value", async () => {
    await saveManualOfferLines(OFFER_ID, "USD" as never, [validLine("profile-a")]);
    const data = mockFarmOfferLineCreate.mock.calls[0][0].data;
    expect(data.priceUnit).toBe("PER_STEM");
  });

  it("20: every line uses the one header currency passed in, regardless of line count", async () => {
    await saveManualOfferLines(OFFER_ID, "EUR" as never, [validLine("profile-a"), validLine("profile-b")]);
    const currencies = mockFarmOfferLineCreate.mock.calls.map((c) => (c[0] as { data: { currency: string } }).data.currency);
    expect(currencies).toEqual(["EUR", "EUR"]);
  });

  it("rejects a profile belonging to a different supplier than the offer", async () => {
    mockProfileFindMany.mockResolvedValue([{ ...PROFILE_A, farmId: "other-farm" }]);
    const result = await saveManualOfferLines(OFFER_ID, "USD" as never, [validLine("profile-a")]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.lineErrors["profile-a"]).toMatch(/andere leverancier/);
  });

  it("requires at least one selected article", async () => {
    const result = await saveManualOfferLines(OFFER_ID, "USD" as never, []);
    expect(result.ok).toBe(false);
  });

  it("33: requires an authenticated session", async () => {
    mockGetServerSession.mockResolvedValue(null);
    await expect(saveManualOfferLines(OFFER_ID, "USD" as never, [validLine()])).rejects.toThrow("Niet ingelogd");
  });
});
