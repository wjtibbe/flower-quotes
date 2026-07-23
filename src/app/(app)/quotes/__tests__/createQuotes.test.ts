import { beforeEach, describe, expect, it, vi } from "vitest";

// createQuotes' own concern is gating + canonical quantity/packaging
// resolution (the quote-pipeline consistency fix) - the actual per-stem
// price calculation is `priceLineForCustomer`'s job and is mocked here so
// these tests stay focused and don't need a full route/rate/exchange fixture.

vi.mock("next-auth", () => ({ getServerSession: () => Promise.resolve({ user: { id: "user-1" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/quoteNumber", () => ({ generateQuoteNumber: () => Promise.resolve("Q-20260723-0001") }));

const mockFarmOfferLineFindMany = vi.fn();
const mockCustomerFindUniqueOrThrow = vi.fn();
const mockQuoteCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    farmOfferLine: { findMany: (...a: unknown[]) => mockFarmOfferLineFindMany(...a) },
    customer: { findUniqueOrThrow: (...a: unknown[]) => mockCustomerFindUniqueOrThrow(...a) },
    quote: { create: (...a: unknown[]) => mockQuoteCreate(...a) },
  },
}));

const mockPriceLineForCustomer = vi.fn();
vi.mock("@/lib/quotePricing", () => ({
  priceLineForCustomer: (...a: unknown[]) => mockPriceLineForCustomer(...a),
}));

const { createQuotes } = await import("../actions");

function farmOfferLine(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    farmOfferId: "offer-1",
    productVariantId: null,
    packagingWeightProfileId: "profile-1",
    rawText: "1 QB Freedom 60cm",
    productGroupRaw: "Rose",
    varietyRaw: "Freedom",
    boxType: "QB",
    boxesAvailable: null,
    stemsPerBox: null,
    stemLengthCm: 60,
    quantity: { toString: () => "5" },
    unit: "BOXES",
    totalStems: null,
    fobPricePerStem: { toString: () => "0.40" },
    currency: "USD",
    weightPerBoxKg: null,
    matchStatus: "AUTO_MATCHED",
    farmOffer: { farmId: "farm-1", status: "REVIEWED", farm: { name: "Test Farm" } },
    packagingWeightProfile: { id: "profile-1", farmId: "farm-1", boxType: "QB", stemsPerBox: 100, weightPerBoxKg: { toString: () => "8.000" } },
    ...overrides,
  };
}

function makeFormData(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => fd.append(key, v));
    else fd.append(key, value);
  }
  return fd;
}

const CUSTOMER = {
  id: "customer-1",
  companyName: "Acme Flowers",
  defaultIncoterm: "FOB",
  defaultCurrency: "USD",
  defaultMarginPercent: { toString: () => "20" },
  destinationId: "dest-1",
};

const PRICED_RESULT = {
  issues: [],
  breakdown: {
    fobPricePerStem: { toString: () => "0.40" },
    freightPerStem: { toString: () => "0" },
    clearingAndInspectionPerStem: { toString: () => "0" },
    handlingPerStem: { toString: () => "0" },
    additionalCostPerStem: { toString: () => "0" },
    additionalCosts: [],
    totalCostPricePerStemSource: { toString: () => "0.40" },
    costPricePerStemTarget: { toString: () => "0.40" },
    marginPercent: { toString: () => "20" },
    calculatedSellPricePerStemRounded: { toString: () => "0.48" },
    exchangeRateUsed: null,
    sourceCurrency: "USD",
    targetCurrency: "USD",
  },
  context: { originId: null, exchangeRateIsManual: false, exchangeRateDefault: null, freightRatePerKg: null, freightRateUnit: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCustomerFindUniqueOrThrow.mockResolvedValue(CUSTOMER);
  mockPriceLineForCustomer.mockResolvedValue(PRICED_RESULT);
  mockQuoteCreate.mockResolvedValue({ id: "quote-1" });
});

describe("createQuotes - section 18 quote creation", () => {
  it("creates a quote for a valid REVIEWED + AUTO_MATCHED line", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([farmOfferLine()]);

    await createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" }));

    expect(mockQuoteCreate).toHaveBeenCalledTimes(1);
  });

  it("uses the resolved quantityBoxes (from quantity+unit, not a boxesAvailable default) on the QuoteLine", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([farmOfferLine()]);

    await createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" }));

    const call = mockQuoteCreate.mock.calls[0][0];
    expect(call.data.lines.create[0].quantityBoxes).toBe(5);
  });

  it("uses the canonical PackagingWeightProfile's stemsPerBox/weightPerBoxKg, not the legacy FarmOfferLine snapshot", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ stemsPerBox: 80, weightPerBoxKg: { toString: () => "7.500" } }),
    ]);

    await createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" }));

    const call = mockQuoteCreate.mock.calls[0][0];
    expect(call.data.lines.create[0].stemsPerBox).toBe(100);
    expect(call.data.lines.create[0].weightPerBoxKg).toBe("8.000");
  });

  it("one invalid line in the batch (DRAFT offer) blocks the entire creation - nothing is created", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ id: "line-1" }),
      farmOfferLine({ id: "line-2", farmOffer: { farmId: "farm-1", status: "DRAFT", farm: { name: "Test Farm" } } }),
    ]);

    await expect(
      createQuotes(makeFormData({ lineIds: ["line-1", "line-2"], customerIds: "customer-1" })),
    ).rejects.toThrow(/Offer has not been reviewed/);

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("missing stemsPerBox (no profile, no legacy value) is a blocking error, never a non-null-assertion crash", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ packagingWeightProfileId: null, packagingWeightProfile: null, matchStatus: "UNMATCHED", stemsPerBox: null }),
    ]);

    await expect(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
    ).rejects.toThrow(/Offer line has no confirmed assortment match/);

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("a packaging profile belonging to a different supplier than the offer is blocking", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({
        packagingWeightProfile: { id: "profile-1", farmId: "farm-OTHER", boxType: "QB", stemsPerBox: 100, weightPerBoxKg: { toString: () => "8.000" } },
      }),
    ]);

    await expect(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
    ).rejects.toThrow(/another supplier/);

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("a manipulated client requesting a DRAFT offer's line id is blocked server-side even if it was never a real wizard candidate", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ farmOffer: { farmId: "farm-1", status: "DRAFT", farm: { name: "Test Farm" } } }),
    ]);

    await expect(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
    ).rejects.toThrow(/Offer has not been reviewed/);

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("a non-divisible STEMS quantity blocks quote creation with a clear message", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ unit: "STEMS", quantity: { toString: () => "550" } }),
    ]);

    await expect(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
    ).rejects.toThrow(/cannot be converted to whole boxes/);

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });
});
