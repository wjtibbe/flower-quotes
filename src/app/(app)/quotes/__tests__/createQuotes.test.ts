import { beforeEach, describe, expect, it, vi } from "vitest";

// createQuotes' own concern is gating + canonical quantity/packaging
// resolution (the quote-pipeline consistency fix) - the actual per-stem
// price calculation is `priceLineForCustomer`'s job and is mocked here so
// these tests stay focused and don't need a full route/rate/exchange fixture.

vi.mock("next-auth", () => ({ getServerSession: () => Promise.resolve({ user: { id: "user-1" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
// Real Next.js `redirect()` always throws a control-flow exception to stop
// execution - this mock replicates that (instead of being a no-op) so the
// business-state validation paths in `actions.ts`, which now redirect back
// to the wizard with a `?err=` message instead of throwing a raw Error, are
// exercised the same way they run in production.
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
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

/**
 * On success `createQuotes` ends with `redirect(...)` too (to the new
 * quote, or back to the list) - real Next.js `redirect()` always throws a
 * control-flow exception, success or not, so a successful run is observed
 * here the same way: the mocked throw, plus the side effects
 * (`prisma.quote.create`) that happened before it.
 */
async function expectRedirectSuccess(promise: Promise<void>) {
  await expect(promise).rejects.toThrow(/^REDIRECT:\/quotes\//);
}

describe("createQuotes - section 18 quote creation", () => {
  it("creates a quote for a valid REVIEWED + AUTO_MATCHED line", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([farmOfferLine()]);

    await expectRedirectSuccess(createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })));

    expect(mockQuoteCreate).toHaveBeenCalledTimes(1);
  });

  it("uses the resolved quantityBoxes (from quantity+unit, not a boxesAvailable default) on the QuoteLine", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([farmOfferLine()]);

    await expectRedirectSuccess(createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })));

    const call = mockQuoteCreate.mock.calls[0][0];
    expect(call.data.lines.create[0].quantityBoxes).toBe(5);
  });

  it("uses the canonical PackagingWeightProfile's stemsPerBox/weightPerBoxKg, not the legacy FarmOfferLine snapshot", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ stemsPerBox: 80, weightPerBoxKg: { toString: () => "7.500" } }),
    ]);

    await expectRedirectSuccess(createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })));

    const call = mockQuoteCreate.mock.calls[0][0];
    expect(call.data.lines.create[0].stemsPerBox).toBe(100);
    expect(call.data.lines.create[0].weightPerBoxKg).toBe("8.000");
  });

  /**
   * Business-state validation failures now redirect back to the wizard with
   * a `?err=` message (see `redirectToWizardWithError` in `actions.ts`)
   * instead of throwing a raw, uncaught Error - there is no error boundary
   * for this route, so an uncaught throw surfaced in production as the
   * generic "Application error: a server-side exception has occurred"
   * crash page. `redirect()` itself still throws (that's how Next.js always
   * behaves - see the mock above), so `.rejects` still applies; this helper
   * additionally decodes the redirect URL to assert on the actual message.
   */
  async function expectRedirectError(promise: Promise<void>, messagePattern: RegExp) {
    await expect(promise).rejects.toThrow(/^REDIRECT:/);
    expect(mockRedirect).toHaveBeenCalledTimes(1);
    const url = mockRedirect.mock.calls[0][0] as string;
    const [path, query] = url.split("?");
    expect(path).toBe("/quotes/new");
    // application/x-www-form-urlencoded decoding (URLSearchParams, not
    // decodeURIComponent) - matches how the app itself builds this URL with
    // URLSearchParams.toString(), which encodes spaces as "+".
    const err = new URLSearchParams(query).get("err");
    expect(err).toMatch(messagePattern);
  }

  it("one invalid line in the batch (DRAFT offer) blocks the entire creation - nothing is created", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ id: "line-1" }),
      farmOfferLine({ id: "line-2", farmOffer: { farmId: "farm-1", status: "DRAFT", farm: { name: "Test Farm" } } }),
    ]);

    await expectRedirectError(
      createQuotes(makeFormData({ lineIds: ["line-1", "line-2"], customerIds: "customer-1" })),
      /Offer has not been reviewed/,
    );

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("missing stemsPerBox (no profile, no legacy value) is a blocking error, never a non-null-assertion crash", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ packagingWeightProfileId: null, packagingWeightProfile: null, matchStatus: "UNMATCHED", stemsPerBox: null }),
    ]);

    await expectRedirectError(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
      /Offer line has no confirmed assortment match/,
    );

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("a packaging profile belonging to a different supplier than the offer is blocking", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({
        packagingWeightProfile: { id: "profile-1", farmId: "farm-OTHER", boxType: "QB", stemsPerBox: 100, weightPerBoxKg: { toString: () => "8.000" } },
      }),
    ]);

    await expectRedirectError(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
      /another supplier/,
    );

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("a manipulated client requesting a DRAFT offer's line id is blocked server-side even if it was never a real wizard candidate", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ farmOffer: { farmId: "farm-1", status: "DRAFT", farm: { name: "Test Farm" } } }),
    ]);

    await expectRedirectError(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
      /Offer has not been reviewed/,
    );

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("a non-divisible STEMS quantity blocks quote creation with a clear message", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([
      farmOfferLine({ unit: "STEMS", quantity: { toString: () => "550" } }),
    ]);

    await expectRedirectError(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
      /cannot be converted to whole boxes/,
    );

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("no product lines selected redirects back with a clear message instead of an uncaught exception", async () => {
    await expectRedirectError(
      createQuotes(makeFormData({ customerIds: "customer-1" })),
      /Geen productregels geselecteerd/,
    );

    expect(mockFarmOfferLineFindMany).not.toHaveBeenCalled();
    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("no customers selected redirects back with a clear message instead of an uncaught exception", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([farmOfferLine()]);

    await expectRedirectError(createQuotes(makeFormData({ lineIds: "line-1" })), /Geen klanten geselecteerd/);

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("every candidate line failing pricing (e.g. no route/freight rate) redirects back with a clear message, not a crash", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([farmOfferLine()]);
    mockPriceLineForCustomer.mockResolvedValue({
      issues: [{ code: "INCOTERM_NOT_SUPPORTED_ON_ROUTE", message: "DDP wordt niet aangeboden op deze route" }],
      breakdown: null,
      context: { originId: null, exchangeRateIsManual: false, exchangeRateDefault: null, freightRatePerKg: null, freightRateUnit: null },
    });

    await expectRedirectError(
      createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-1" })),
      /Geen offerteregels konden worden berekend/,
    );

    expect(mockQuoteCreate).not.toHaveBeenCalled();
  });

  it("different customer ids do not change whether a valid line creates a quote (not customer-specific)", async () => {
    mockFarmOfferLineFindMany.mockResolvedValue([farmOfferLine()]);
    mockCustomerFindUniqueOrThrow.mockResolvedValue({ ...CUSTOMER, id: "customer-2", companyName: "Other Flowers" });

    await expectRedirectSuccess(createQuotes(makeFormData({ lineIds: "line-1", customerIds: "customer-2" })));

    expect(mockQuoteCreate).toHaveBeenCalledTimes(1);
    expect(mockQuoteCreate.mock.calls[0][0].data.customerId).toBe("customer-2");
  });
});
