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
    freightRate: { create: (...a: unknown[]) => mockFreightRateCreate(...a) },
  },
}));

const { createOrigin, createDestination, createRoute, addFreightRate } = await import("../actions");

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

describe("createOrigin/createDestination/createRoute/addFreightRate - required field validation (regression: used to throw uncaught, crashing the page with a 500 instead of the friendly /routes?err= banner)", () => {
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

  it("addFreightRate rejects a missing amount via redirect+err instead of throwing", async () => {
    await expect(addFreightRate("route-1", formData({}))).rejects.toThrow("REDIRECT:/routes?err=");
    expect(mockFreightRateCreate).not.toHaveBeenCalled();
  });
});
