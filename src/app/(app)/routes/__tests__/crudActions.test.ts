import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockOriginFindFirst = vi.fn();
const mockOriginCreate = vi.fn();
const mockDestinationFindFirst = vi.fn();
const mockDestinationCreate = vi.fn();
const mockRouteFindFirst = vi.fn();
const mockRouteCreate = vi.fn();
const mockFreightRateCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    origin: { findFirst: (...a: unknown[]) => mockOriginFindFirst(...a), create: (...a: unknown[]) => mockOriginCreate(...a) },
    destination: { findFirst: (...a: unknown[]) => mockDestinationFindFirst(...a), create: (...a: unknown[]) => mockDestinationCreate(...a) },
    route: { findFirst: (...a: unknown[]) => mockRouteFindFirst(...a), create: (...a: unknown[]) => mockRouteCreate(...a) },
    freightRate: { upsert: (...a: unknown[]) => mockFreightRateCreate(...a) },
  },
}));

const { createOrigin, createDestination, createRoute, saveFreightRate } = await import("../actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOriginFindFirst.mockResolvedValue(null);
  mockDestinationFindFirst.mockResolvedValue(null);
  mockRouteFindFirst.mockResolvedValue(null);
});

describe("createOrigin/createDestination/createRoute/saveFreightRate - required field validation (regression: used to throw uncaught, crashing the page with a 500 instead of the friendly /routes?err= banner)", () => {
  it("createOrigin rejects a missing city/country via redirect+err instead of throwing", async () => {
    await expect(createOrigin(formData({}))).rejects.toThrow("REDIRECT:/routes?err=");
    expect(mockOriginCreate).not.toHaveBeenCalled();
  });

  it("createOrigin rejects a whitespace-only city the same way", async () => {
    await expect(createOrigin(formData({ city: "   ", country: "Ecuador" }))).rejects.toThrow(
      "REDIRECT:/routes?err=",
    );
  });

  it("createDestination rejects a missing city/country via redirect+err instead of throwing", async () => {
    await expect(createDestination(formData({}))).rejects.toThrow("REDIRECT:/routes?err=");
    expect(mockDestinationCreate).not.toHaveBeenCalled();
  });

  it("createRoute rejects a missing origin/destination via redirect+err instead of throwing", async () => {
    await expect(createRoute(formData({}))).rejects.toThrow("REDIRECT:/routes?err=");
    expect(mockRouteCreate).not.toHaveBeenCalled();
  });

  it("saveFreightRate rejects a missing amount via redirect+err instead of throwing", async () => {
    await expect(saveFreightRate("route-1", formData({}))).rejects.toThrow("REDIRECT:/routes?err=");
    expect(mockFreightRateCreate).not.toHaveBeenCalled();
  });
});

describe("saveFreightRate - upserts on routeId (business rule: exactly one current tariff per route)", () => {
  it("1/2/3: always calls upsert keyed on routeId with both an update and a create branch - never a bare create, so the same call works whether a tariff already exists or not, and can never produce a second row", async () => {
    mockFreightRateCreate.mockResolvedValue({ id: "rate-1", routeId: "route-1" });
    await saveFreightRate("route-1", formData({ ratePerKg: "4.25", currency: "USD", rateUnit: "PER_KG" }));

    expect(mockFreightRateCreate).toHaveBeenCalledTimes(1);
    const call = mockFreightRateCreate.mock.calls[0][0];
    expect(call.where).toEqual({ routeId: "route-1" });
    expect(call.update).toEqual({ ratePerKg: "4.25", currency: "USD", rateUnit: "PER_KG" });
    expect(call.create).toEqual({ routeId: "route-1", ratePerKg: "4.25", currency: "USD", rateUnit: "PER_KG" });
  });

  it("2: saving again for the same route issues another upsert on the SAME routeId key - it updates the existing row in place rather than creating a new one", async () => {
    mockFreightRateCreate.mockResolvedValue({ id: "rate-1", routeId: "route-1" });
    await saveFreightRate("route-1", formData({ ratePerKg: "4.25", currency: "USD", rateUnit: "PER_KG" }));
    await saveFreightRate("route-1", formData({ ratePerKg: "5.00", currency: "USD", rateUnit: "PER_KG" }));

    expect(mockFreightRateCreate).toHaveBeenCalledTimes(2);
    expect(mockFreightRateCreate.mock.calls[0][0].where).toEqual({ routeId: "route-1" });
    expect(mockFreightRateCreate.mock.calls[1][0].where).toEqual({ routeId: "route-1" });
    expect(mockFreightRateCreate.mock.calls[1][0].update.ratePerKg).toBe("5.00");
  });

  it("rejects a non-positive amount", async () => {
    await expect(saveFreightRate("route-1", formData({ ratePerKg: "0", currency: "USD", rateUnit: "PER_KG" }))).rejects.toThrow(
      "REDIRECT:/routes?err=",
    );
    await expect(saveFreightRate("route-1", formData({ ratePerKg: "-1", currency: "USD", rateUnit: "PER_KG" }))).rejects.toThrow(
      "REDIRECT:/routes?err=",
    );
    expect(mockFreightRateCreate).not.toHaveBeenCalled();
  });
});
