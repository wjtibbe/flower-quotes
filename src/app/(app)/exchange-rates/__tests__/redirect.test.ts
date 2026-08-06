import { describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));

const { default: ExchangeRatesRedirect } = await import("../page");

describe("B7: old /exchange-rates bookmark stays compatible", () => {
  it("20: redirects to /settings/exchange-rates", () => {
    expect(() => ExchangeRatesRedirect()).toThrow("REDIRECT:/settings/exchange-rates");
  });
});
