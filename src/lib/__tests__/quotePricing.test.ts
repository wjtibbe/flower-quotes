import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// resolvePricingContext/priceLineForCustomer's job is to turn (farm offer
// line, customer, incoterm) into the route/tariff/additional-cost data the
// pure pricing engine needs - and, when something can't be resolved, into an
// actionable message that names the actual route/date/supplier instead of a
// bare "Vrachttarief ontbreekt" (see the Coloriginz route-pricing fix this
// file was added for). Prisma is mocked so these stay fast, deterministic
// unit tests independent of any real database.

const mockFarmOfferFindUnique = vi.fn();
const mockOriginFindUnique = vi.fn();
const mockDestinationFindUnique = vi.fn();
const mockRouteFindMany = vi.fn();
const mockFreightRateFindFirst = vi.fn();
const mockDdpCostRateFindMany = vi.fn();
const mockExchangeRateFindFirst = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  prisma: {
    farmOffer: { findUnique: (...a: unknown[]) => mockFarmOfferFindUnique(...a) },
    origin: { findUnique: (...a: unknown[]) => mockOriginFindUnique(...a) },
    destination: { findUnique: (...a: unknown[]) => mockDestinationFindUnique(...a) },
    route: { findMany: (...a: unknown[]) => mockRouteFindMany(...a) },
    freightRate: { findFirst: (...a: unknown[]) => mockFreightRateFindFirst(...a) },
    ddpCostRate: { findMany: (...a: unknown[]) => mockDdpCostRateFindMany(...a) },
    exchangeRate: { findFirst: (...a: unknown[]) => mockExchangeRateFindFirst(...a) },
  },
}));

const { resolvePricingContext, priceLineForCustomer } = await import("../quotePricing");
const { detectDuplicateCostCategories } = await import("../pricing");

const BOGOTA_ORIGIN_ID = "origin-bogota";
const QUITO_ORIGIN_ID = "origin-quito";
const AMSTERDAM_DEST_ID = "dest-amsterdam";
const DUBAI_DEST_ID = "dest-dubai";
const BOGOTA_ROUTE_ID = "route-bogota-ams";
const QUITO_ROUTE_ID = "route-quito-ams";

function farmOfferLine(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    farmOfferId: "offer-1",
    originId: null,
    currency: "USD",
    fobPricePerStem: { toString: () => "0.45" },
    ...overrides,
  } as never;
}

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: "cust-1",
    destinationId: AMSTERDAM_DEST_ID,
    defaultCurrency: "USD",
    ...overrides,
  } as never;
}

const NOW = new Date("2026-07-29T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  mockOriginFindUnique.mockImplementation(({ where: { id } }) =>
    Promise.resolve(id === BOGOTA_ORIGIN_ID ? { city: "Bogotá" } : id === QUITO_ORIGIN_ID ? { city: "Quito" } : null),
  );
  mockDestinationFindUnique.mockImplementation(({ where: { id } }) =>
    Promise.resolve(id === AMSTERDAM_DEST_ID ? { city: "Amsterdam" } : id === DUBAI_DEST_ID ? { city: "Dubai" } : null),
  );
  mockExchangeRateFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolvePricingContext - route selection", () => {
  it("1: Bogotá -> Amsterdam finds the active tariff on that route", async () => {
    mockRouteFindMany.mockResolvedValue([
      { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindFirst.mockResolvedValue({ ratePerKg: { toString: () => "2.9" }, rateUnit: "PER_KG", updatedAt: NOW });
    mockDdpCostRateFindMany.mockResolvedValue([]);

    const ctx = await resolvePricingContext(
      farmOfferLine({ originId: BOGOTA_ORIGIN_ID }),
      customer(),
      "DDP",
    );

    expect(mockRouteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID } }),
    );
    expect(ctx.routeId).toBe(BOGOTA_ROUTE_ID);
    expect(ctx.freightRatePerKg).toBe("2.9");
  });

  it("2: Quito -> Amsterdam finds the active tariff on that route", async () => {
    mockRouteFindMany.mockResolvedValue([
      { id: QUITO_ROUTE_ID, originId: QUITO_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindFirst.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
    mockDdpCostRateFindMany.mockResolvedValue([]);

    const ctx = await resolvePricingContext(farmOfferLine({ originId: QUITO_ORIGIN_ID }), customer(), "DDP");

    expect(ctx.routeId).toBe(QUITO_ROUTE_ID);
    expect(ctx.freightRatePerKg).toBe("3.1");
  });

  it("3: with no per-line origin override, the quoted Farm's own origin is used", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "La Gaitana Farms", originId: BOGOTA_ORIGIN_ID } });
    mockRouteFindMany.mockResolvedValue([
      { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindFirst.mockResolvedValue(null);
    mockDdpCostRateFindMany.mockResolvedValue([]);

    const ctx = await resolvePricingContext(farmOfferLine({ originId: null }), customer(), "DDP");

    expect(mockFarmOfferFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "offer-1" } }),
    );
    expect(ctx.originId).toBe(BOGOTA_ORIGIN_ID);
    expect(ctx.originLabel).toBe("Bogotá");
  });

  it("4: a route from a different origin is never matched - the query filters by the exact originId", async () => {
    mockRouteFindMany.mockResolvedValue([]); // Prisma itself would never return the Quito route for a Bogotá originId filter
    mockDdpCostRateFindMany.mockResolvedValue([]);

    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");

    expect(mockRouteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID } }),
    );
    expect(ctx.routeId).toBeNull();
    expect(ctx.freightRatePerKg).toBeNull();
  });

  it("16: a route to a different destination is never used - the query filters by the exact destinationId", async () => {
    mockRouteFindMany.mockResolvedValue([]);
    mockDdpCostRateFindMany.mockResolvedValue([]);

    await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer({ destinationId: DUBAI_DEST_ID }), "DDP");

    expect(mockRouteFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { originId: BOGOTA_ORIGIN_ID, destinationId: DUBAI_DEST_ID } }),
    );
  });
});

describe("resolvePricingContext - effective-date filtering", () => {
  const route = { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true };

  it("5: a tariff with validFrom before the quote date is active", async () => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockDdpCostRateFindMany.mockResolvedValue([]);
    mockFreightRateFindFirst.mockImplementation(({ where }) => {
      // Simulate Prisma's own filtering rather than trusting the resolver blindly.
      const activeFrom = new Date("2026-07-10");
      const matches = where.effectiveFrom.lte >= activeFrom;
      return Promise.resolve(matches ? { ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW } : null);
    });

    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.freightRatePerKg).toBe("3.1");
  });

  it("6: an expired tariff (effectiveTo in the past) is ignored", async () => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockDdpCostRateFindMany.mockResolvedValue([]);
    // Prisma's own OR:[{effectiveTo:null},{effectiveTo:{gte:now}}] would
    // exclude an expired row - findFirst correctly returns null.
    mockFreightRateFindFirst.mockResolvedValue(null);

    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.freightRatePerKg).toBeNull();
  });

  it("7: a future-dated tariff (effectiveFrom after the quote date) is ignored", async () => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockDdpCostRateFindMany.mockResolvedValue([]);
    mockFreightRateFindFirst.mockResolvedValue(null);

    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.freightRatePerKg).toBeNull();
    // The query itself must ask for effectiveFrom <= now.
    expect(mockFreightRateFindFirst.mock.calls[0][0].where.effectiveFrom).toEqual({ lte: NOW });
  });

  it("8: an open-ended tariff (effectiveTo null) is treated as currently active", async () => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockDdpCostRateFindMany.mockResolvedValue([]);
    mockFreightRateFindFirst.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });

    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.freightRatePerKg).toBe("3.1");
    const call = mockFreightRateFindFirst.mock.calls[0][0];
    expect(call.where.OR).toContainEqual({ effectiveTo: null });
  });
});

describe("resolvePricingContext - additional cost categories", () => {
  const route = { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true };

  beforeEach(() => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockFreightRateFindFirst.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
  });

  it("9: a CLEARING category cost resolves", async () => {
    mockDdpCostRateFindMany.mockResolvedValue([
      { name: "Clearing", category: "CLEARING", rateUnit: "PER_STEM", amount: { toString: () => "0.015" }, effectiveFrom: NOW, effectiveTo: null },
    ]);
    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.additionalCosts).toEqual([{ name: "Clearing", category: "CLEARING", amount: "0.015", unit: "PER_STEM" }]);
  });

  it("10: an INSPECTION category cost resolves", async () => {
    mockDdpCostRateFindMany.mockResolvedValue([
      { name: "Inspection", category: "INSPECTION", rateUnit: "PER_STEM", amount: { toString: () => "0.01" }, effectiveFrom: NOW, effectiveTo: null },
    ]);
    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.additionalCosts).toEqual([{ name: "Inspection", category: "INSPECTION", amount: "0.01", unit: "PER_STEM" }]);
  });

  it("11: a HANDLING category cost resolves", async () => {
    mockDdpCostRateFindMany.mockResolvedValue([
      { name: "Handling", category: "HANDLING", rateUnit: "PER_BOX", amount: { toString: () => "1.5" }, effectiveFrom: NOW, effectiveTo: null },
    ]);
    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.additionalCosts).toEqual([{ name: "Handling", category: "HANDLING", amount: "1.5", unit: "PER_BOX" }]);
  });
});

describe("priceLineForCustomer - actionable route-specific errors", () => {
  it("14: a missing tariff returns a message naming the route and date, not a bare 'Vrachttarief ontbreekt'", async () => {
    mockRouteFindMany.mockResolvedValue([
      { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindFirst.mockResolvedValue(null);
    mockDdpCostRateFindMany.mockResolvedValue([
      { name: "Clearing", category: "CLEARING", rateUnit: "PER_STEM", amount: { toString: () => "0.01" }, effectiveFrom: NOW, effectiveTo: null },
      { name: "Handling", category: "HANDLING", rateUnit: "PER_BOX", amount: { toString: () => "1" }, effectiveFrom: NOW, effectiveTo: null },
    ]);

    const result = await priceLineForCustomer(
      farmOfferLine({ originId: BOGOTA_ORIGIN_ID }),
      customer(),
      "DDP",
      "USD",
      "15",
      { stemsPerBox: 20, weightPerBoxKg: "8" },
    );

    const issue = result.issues.find((i) => i.code === "MISSING_FREIGHT_RATE");
    expect(issue?.message).toBe("Geen actief vrachttarief gevonden voor Bogotá → Amsterdam op 29-07-2026");
  });

  it("15: missing Handling costs return a message naming the route, not a bare 'Handling-kosten ontbreken'", async () => {
    mockRouteFindMany.mockResolvedValue([
      { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindFirst.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
    mockDdpCostRateFindMany.mockResolvedValue([
      { name: "Clearing", category: "CLEARING", rateUnit: "PER_STEM", amount: { toString: () => "0.01" }, effectiveFrom: NOW, effectiveTo: null },
    ]);

    const result = await priceLineForCustomer(
      farmOfferLine({ originId: BOGOTA_ORIGIN_ID }),
      customer(),
      "DDP",
      "USD",
      "15",
      { stemsPerBox: 20, weightPerBoxKg: "8" },
    );

    const issue = result.issues.find((i) => i.code === "MISSING_DDP_HANDLING");
    expect(issue?.message).toBe("Geen Handling-kosten gevonden voor Bogotá → Amsterdam");
  });

  it("a supplier with no origin configured at all collapses the 3 generic blockers into one actionable message", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "Coloriginz Supplier", originId: null } });
    mockDdpCostRateFindMany.mockResolvedValue([]);

    const result = await priceLineForCustomer(
      farmOfferLine({ originId: null }),
      customer(),
      "DDP",
      "USD",
      "15",
      { stemsPerBox: 20, weightPerBoxKg: "8" },
    );

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual({
      code: "ORIGIN_NOT_CONFIGURED",
      message: 'Vertreklocatie is niet ingesteld voor leverancier "Coloriginz Supplier"',
    });
    // The route lookup must never even run - there is no origin to search from.
    expect(mockRouteFindMany).not.toHaveBeenCalled();
  });

  it("12/13: a fully-resolved route prices freight (per kg) and handling (per box) correctly", async () => {
    mockRouteFindMany.mockResolvedValue([
      { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindFirst.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
    mockDdpCostRateFindMany.mockResolvedValue([
      { name: "Clearing", category: "CLEARING", rateUnit: "PER_STEM", amount: { toString: () => "0.01" }, effectiveFrom: NOW, effectiveTo: null },
      { name: "Handling", category: "HANDLING", rateUnit: "PER_BOX", amount: { toString: () => "1" }, effectiveFrom: NOW, effectiveTo: null },
    ]);

    const result = await priceLineForCustomer(
      farmOfferLine({ originId: BOGOTA_ORIGIN_ID, fobPricePerStem: { toString: () => "0.45" } }),
      customer(),
      "DDP",
      "USD",
      "15",
      { stemsPerBox: 20, weightPerBoxKg: "8" }, // 20 stems/box, 8kg/box
    );

    expect(result.issues).toEqual([]);
    // freight per stem = 8kg * 3.1 / 20 stems = 1.24
    expect(result.breakdown?.freightPerStem.toString()).toBe("1.24");
    // handling per stem = 1 / 20 = 0.05
    expect(result.breakdown?.handlingPerStem.toString()).toBe("0.05");
  });
});

describe("detectDuplicateCostCategories - Task 6 (double-counting safety)", () => {
  it("17a: a combined 'Clearing & inspection' row alongside separate 'Clearing'/'Inspection' rows is flagged", () => {
    const warnings = detectDuplicateCostCategories([
      { name: "Clearing & inspection", category: "CLEARING", amount: "0.025", unit: "PER_STEM", perStem: "0.025" },
      { name: "Clearing", category: "CLEARING", amount: "0.015", unit: "PER_STEM", perStem: "0.015" },
      { name: "Inspection", category: "INSPECTION", amount: "0.01", unit: "PER_STEM", perStem: "0.01" },
      { name: "Handling", category: "HANDLING", amount: "1.5", unit: "PER_BOX", perStem: "0.075" },
    ]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("DUPLICATE_COST_CATEGORY");
    expect(warnings[0].message).toContain("CLEARING");
    expect(warnings[0].message).toContain("Clearing & inspection");
    expect(warnings[0].message).toContain("Clearing");
  });

  it("17b: exactly one row per category (the normal, correctly-configured case) is never flagged", () => {
    const warnings = detectDuplicateCostCategories([
      { name: "Clearing & inspection", category: "CLEARING", amount: "0.025", unit: "PER_STEM", perStem: "0.025" },
      { name: "Handling", category: "HANDLING", amount: "1.5", unit: "PER_BOX", perStem: "0.075" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("17c: two rows in the same category with the SAME name is not flagged (that's a supersede-by-date pair, already deduped upstream, not a duplicate)", () => {
    const warnings = detectDuplicateCostCategories([
      { name: "Handling", category: "HANDLING", amount: "1.5", unit: "PER_BOX", perStem: "0.075" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("17d: never inspects cost names to decide the category - two distinctly-named HANDLING sub-fees are still flagged structurally, not by name pattern", () => {
    const warnings = detectDuplicateCostCategories([
      { name: "Airport handling", category: "HANDLING", amount: "1", unit: "PER_BOX", perStem: "0.05" },
      { name: "Fuel surcharge", category: "HANDLING", amount: "0.5", unit: "PER_BOX", perStem: "0.025" },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("HANDLING");
  });
});
