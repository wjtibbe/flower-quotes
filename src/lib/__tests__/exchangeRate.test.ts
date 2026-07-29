import { describe, expect, it } from "vitest";
import { BASE_CURRENCY, findEurRate, displayRate, type StoredExchangeRate } from "../exchangeRate";

const rate = (base: string, quote: string, value: string): StoredExchangeRate => ({
  baseCurrency: base as StoredExchangeRate["baseCurrency"],
  quoteCurrency: quote as StoredExchangeRate["quoteCurrency"],
  rate: { toString: () => value },
});

describe("exchangeRate - EUR as the single base currency", () => {
  it("EUR is the fixed base currency", () => {
    expect(BASE_CURRENCY).toBe("EUR");
  });

  it("finds the EUR-based row for a target currency (EUR -> USD)", () => {
    const rows = [rate("EUR", "USD", "1.17")];
    expect(findEurRate(rows, "USD")).toBe(rows[0]);
  });

  it("never resolves a rate for EUR itself", () => {
    const rows = [rate("EUR", "USD", "1.17")];
    expect(findEurRate(rows, "EUR")).toBeNull();
  });

  it("ignores a legacy reversed row and does not use it as a competing source of truth (rule 13)", () => {
    const legacyReversed = rate("USD", "EUR", "0.85"); // pre-fix data: "1 USD = X EUR"
    expect(findEurRate([legacyReversed], "USD")).toBeNull();
  });

  it("prefers the canonical EUR-based row even when a legacy reversed row for the same pair also exists", () => {
    const canonical = rate("EUR", "USD", "1.17");
    const legacyReversed = rate("USD", "EUR", "0.85");
    expect(findEurRate([legacyReversed, canonical], "USD")).toBe(canonical);
  });

  it("EUR -> USD conversion reads the rate directly", () => {
    const rows = [rate("EUR", "USD", "1.17")];
    expect(displayRate(rows, "EUR", "USD")).toBe("1.17");
  });

  it("USD -> EUR is derived by dividing the stored EUR-based rate (no inverse row needed)", () => {
    const rows = [rate("EUR", "USD", "1.20")];
    expect(displayRate(rows, "USD", "EUR")).toBe((1 / 1.2).toFixed(6));
  });

  it("returns null for the same currency on both sides", () => {
    expect(displayRate([rate("EUR", "USD", "1.17")], "EUR", "EUR")).toBeNull();
  });

  it("returns null when no EUR-based rate is configured for the currency", () => {
    expect(displayRate([], "EUR", "USD")).toBeNull();
  });
});
