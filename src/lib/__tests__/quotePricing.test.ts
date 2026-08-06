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
const mockOriginFindFirst = vi.fn();
const mockOriginCreate = vi.fn();
const mockDestinationFindUnique = vi.fn();
const mockRouteFindMany = vi.fn();
const mockFreightRateFindUnique = vi.fn();
const mockDdpCostRateFindMany = vi.fn();
const mockExchangeRateFindFirst = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  prisma: {
    farmOffer: { findUnique: (...a: unknown[]) => mockFarmOfferFindUnique(...a) },
    origin: {
      findUnique: (...a: unknown[]) => mockOriginFindUnique(...a),
      findFirst: (...a: unknown[]) => mockOriginFindFirst(...a),
      create: (...a: unknown[]) => mockOriginCreate(...a),
    },
    destination: { findUnique: (...a: unknown[]) => mockDestinationFindUnique(...a) },
    route: { findMany: (...a: unknown[]) => mockRouteFindMany(...a) },
    freightRate: { findUnique: (...a: unknown[]) => mockFreightRateFindUnique(...a) },
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
  // Represents the two EXISTING Origin rows the country-default resolver
  // must reuse (never create) - keyed on the same city+country match the
  // real Prisma query uses.
  mockOriginFindFirst.mockImplementation(({ where }) => {
    const city = (where.city?.equals ?? "").toLowerCase();
    const country = (where.country?.equals ?? "").toLowerCase();
    if (city === "bogotá" && country === "colombia") return Promise.resolve({ id: BOGOTA_ORIGIN_ID });
    if (city === "quito" && country === "ecuador") return Promise.resolve({ id: QUITO_ORIGIN_ID });
    return Promise.resolve(null);
  });
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
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "2.9" }, rateUnit: "PER_KG", updatedAt: NOW });
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
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
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
    mockFreightRateFindUnique.mockResolvedValue(null);
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

// Interim business rule: a Farm's country alone picks a default departure
// among the EXISTING Quito/Bogotá Origin rows until suppliers can configure
// their own (see defaultDeparture.ts, the single central place the mapping
// lives). These tests exercise that fallback specifically - i.e. no
// per-line originId AND no Farm.originId at all.
describe("resolvePricingContext - country-based default departure (interim rule)", () => {
  it("6: Mystic Flowers (Ecuador) + an Amsterdam customer resolves Quito -> Amsterdam", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "Mystic Flowers", originId: null, country: "Ecuador" } });
    mockRouteFindMany.mockResolvedValue([
      { id: QUITO_ROUTE_ID, originId: QUITO_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
    mockDdpCostRateFindMany.mockResolvedValue([]);

    const ctx = await resolvePricingContext(farmOfferLine({ originId: null }), customer({ destinationId: AMSTERDAM_DEST_ID }), "DDP");

    expect(ctx.originId).toBe(QUITO_ORIGIN_ID);
    expect(ctx.originLabel).toBe("Quito");
    expect(ctx.routeId).toBe(QUITO_ROUTE_ID);
    expect(ctx.originUnresolvedReason).toBeNull();
  });

  it("7: a Colombian supplier + an Amsterdam customer resolves Bogotá -> Amsterdam", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "La Gaitana Farms", originId: null, country: "Colombia" } });
    mockRouteFindMany.mockResolvedValue([
      { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "2.9" }, rateUnit: "PER_KG", updatedAt: NOW });
    mockDdpCostRateFindMany.mockResolvedValue([]);

    const ctx = await resolvePricingContext(farmOfferLine({ originId: null }), customer({ destinationId: AMSTERDAM_DEST_ID }), "DDP");

    expect(ctx.originId).toBe(BOGOTA_ORIGIN_ID);
    expect(ctx.originLabel).toBe("Bogotá");
    expect(ctx.routeId).toBe(BOGOTA_ROUTE_ID);
  });

  it("8: the route lookup uses the resolved Origin's id, never the country/city text", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "Mystic Flowers", originId: null, country: "Ecuador" } });
    mockRouteFindMany.mockResolvedValue([]);
    mockDdpCostRateFindMany.mockResolvedValue([]);

    await resolvePricingContext(farmOfferLine({ originId: null }), customer({ destinationId: AMSTERDAM_DEST_ID }), "DDP");

    const routeQueryWhere = mockRouteFindMany.mock.calls[0][0].where;
    expect(routeQueryWhere).toEqual({ originId: QUITO_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID });
    // Never "Quito"/"Ecuador" strings reaching the route query.
    expect(Object.values(routeQueryWhere)).not.toContain("Quito");
    expect(Object.values(routeQueryWhere)).not.toContain("Ecuador");
  });

  it("9: the existing Quito/Bogotá Origin rows are reused - looked up by city+country, not recreated", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "Mystic Flowers", originId: null, country: "Ecuador" } });
    mockRouteFindMany.mockResolvedValue([]);
    mockDdpCostRateFindMany.mockResolvedValue([]);

    await resolvePricingContext(farmOfferLine({ originId: null }), customer({ destinationId: AMSTERDAM_DEST_ID }), "DDP");

    expect(mockOriginFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          city: { equals: "Quito", mode: "insensitive" },
          country: { equals: "Ecuador", mode: "insensitive" },
        },
      }),
    );
  });

  it("10: no duplicate Origin row is ever created by the default-departure fallback", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "Mystic Flowers", originId: null, country: "Ecuador" } });
    mockRouteFindMany.mockResolvedValue([]);
    mockDdpCostRateFindMany.mockResolvedValue([]);

    await resolvePricingContext(farmOfferLine({ originId: null }), customer({ destinationId: AMSTERDAM_DEST_ID }), "DDP");

    expect(mockOriginCreate).not.toHaveBeenCalled();
  });

  it("11: multiple quote lines from different-country farms independently resolve their own departure", async () => {
    mockRouteFindMany.mockImplementation(({ where }) =>
      Promise.resolve(
        where.originId === QUITO_ORIGIN_ID
          ? [{ id: QUITO_ROUTE_ID, originId: QUITO_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true }]
          : where.originId === BOGOTA_ORIGIN_ID
            ? [{ id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true }]
            : [],
      ),
    );
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "3" }, rateUnit: "PER_KG", updatedAt: NOW });
    mockDdpCostRateFindMany.mockResolvedValue([]);

    mockFarmOfferFindUnique.mockResolvedValueOnce({ farm: { name: "Mystic Flowers", originId: null, country: "Ecuador" } });
    const ecuadorCtx = await resolvePricingContext(
      farmOfferLine({ id: "line-ec", farmOfferId: "offer-ec", originId: null }),
      customer({ destinationId: AMSTERDAM_DEST_ID }),
      "DDP",
    );

    mockFarmOfferFindUnique.mockResolvedValueOnce({ farm: { name: "La Gaitana Farms", originId: null, country: "Colombia" } });
    const colombiaCtx = await resolvePricingContext(
      farmOfferLine({ id: "line-co", farmOfferId: "offer-co", originId: null }),
      customer({ destinationId: AMSTERDAM_DEST_ID }),
      "DDP",
    );

    expect(ecuadorCtx.routeId).toBe(QUITO_ROUTE_ID);
    expect(colombiaCtx.routeId).toBe(BOGOTA_ROUTE_ID);
    expect(ecuadorCtx.routeId).not.toBe(colombiaCtx.routeId);
  });
});

describe("resolvePricingContext - no effective-date filtering (business rule: one current tariff/route, no validity periods)", () => {
  const route = { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true };

  it("4: quote pricing loads the route's current tariff directly via findUnique on routeId - no date filter at all", async () => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockDdpCostRateFindMany.mockResolvedValue([]);
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });

    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");

    expect(ctx.freightRatePerKg).toBe("3.1");
    expect(mockFreightRateFindUnique).toHaveBeenCalledWith({ where: { routeId: BOGOTA_ROUTE_ID } });
  });

  it("5: validFrom/validTo are no longer required - a tariff resolves with no date fields present at all", async () => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockDdpCostRateFindMany.mockResolvedValue([]);
    // No effectiveFrom/effectiveTo on this row at all - the resolver never reads them.
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });

    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.freightRatePerKg).toBe("3.1");
  });

  it("a route with no FreightRate row at all simply has no tariff - never a date-filtering artifact", async () => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockDdpCostRateFindMany.mockResolvedValue([]);
    mockFreightRateFindUnique.mockResolvedValue(null);

    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.freightRatePerKg).toBeNull();
  });
});

describe("resolvePricingContext - additional cost categories", () => {
  const route = { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true };

  beforeEach(() => {
    mockRouteFindMany.mockResolvedValue([route]);
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
  });

  it("9: a CLEARING category cost resolves", async () => {
    mockDdpCostRateFindMany.mockResolvedValue([
      { name: "Clearing", category: "CLEARING", rateUnit: "PER_STEM", amount: { toString: () => "0.015" }, effectiveFrom: NOW, effectiveTo: null },
    ]);
    const ctx = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");
    expect(ctx.additionalCosts).toEqual([{ name: "Clearing", category: "CLEARING", amount: "0.015", unit: "PER_STEM" }]);
  });

  it("9: additional costs are loaded via the route's current rows directly - no effective-date filter in the query at all", async () => {
    mockDdpCostRateFindMany.mockResolvedValue([]);
    await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");

    expect(mockDdpCostRateFindMany).toHaveBeenCalledWith({
      where: { routeId: BOGOTA_ROUTE_ID, additionalCostTypeId: { not: null } },
    });
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

  it("15: linking a cost to an AdditionalCostType (additionalCostTypeId set) does not change the resolved amount/category/unit - only the terminology source changed, not the math", async () => {
    const rowWithoutLink = { name: "Clearing", category: "CLEARING", rateUnit: "PER_STEM", amount: { toString: () => "0.015" }, effectiveFrom: NOW, effectiveTo: null };
    const rowWithLink = { ...rowWithoutLink, additionalCostTypeId: "type-clearing" };

    mockDdpCostRateFindMany.mockResolvedValue([rowWithoutLink]);
    const before = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");

    mockDdpCostRateFindMany.mockResolvedValue([rowWithLink]);
    const after = await resolvePricingContext(farmOfferLine({ originId: BOGOTA_ORIGIN_ID }), customer(), "DDP");

    expect(after.additionalCosts).toEqual(before.additionalCosts);
    expect(after.additionalCosts).toEqual([{ name: "Clearing", category: "CLEARING", amount: "0.015", unit: "PER_STEM" }]);
  });
});

describe("priceLineForCustomer - actionable route-specific errors", () => {
  it("14: a missing tariff returns a message naming the route and date, not a bare 'Vrachttarief ontbreekt'", async () => {
    mockRouteFindMany.mockResolvedValue([
      { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindUnique.mockResolvedValue(null);
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
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
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

  it("5: a supplier with no origin AND an unsupported country collapses the 3 generic blockers into one clear business error", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "Coloriginz Supplier", originId: null, country: "Kenya" } });
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
      message: "Geen standaard vertreklocatie ingesteld voor leverancier Coloriginz Supplier uit Kenya",
    });
    // The route lookup must never even run - there is no origin to search from,
    // and an unsupported country is never guessed at.
    expect(mockRouteFindMany).not.toHaveBeenCalled();
  });

  it("a supplier with no origin AND no country at all still gets a clear message (no dangling 'uit ')", async () => {
    mockFarmOfferFindUnique.mockResolvedValue({ farm: { name: "Mystery Farm", originId: null, country: null } });
    mockDdpCostRateFindMany.mockResolvedValue([]);

    const result = await priceLineForCustomer(
      farmOfferLine({ originId: null }),
      customer(),
      "DDP",
      "USD",
      "15",
      { stemsPerBox: 20, weightPerBoxKg: "8" },
    );

    expect(result.issues).toEqual([
      { code: "ORIGIN_NOT_CONFIGURED", message: "Geen standaard vertreklocatie ingesteld voor leverancier Mystery Farm" },
    ]);
  });

  it("12/13: a fully-resolved route prices freight (per kg) and handling (per box) correctly", async () => {
    mockRouteFindMany.mockResolvedValue([
      { id: BOGOTA_ROUTE_ID, originId: BOGOTA_ORIGIN_ID, destinationId: AMSTERDAM_DEST_ID, transportType: "AIR", supportsCfr: true, supportsDdp: true },
    ]);
    mockFreightRateFindUnique.mockResolvedValue({ ratePerKg: { toString: () => "3.1" }, rateUnit: "PER_KG", updatedAt: NOW });
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
