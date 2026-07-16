import { describe, expect, it } from "vitest";
import { calculatePriceLine } from "../pipeline";
import { convertCurrency } from "../calculations";
import type { PriceLineInput } from "../types";

/**
 * These tests pin the exchange-rate snapshot behaviour that the Wisselkoersen
 * work depends on: the used rate flows straight into the cost/sell price, a
 * manual (overridden) rate produces a different result than the default one,
 * and conversion works in both stored directions.
 */
describe("exchange-rate snapshot behaviour", () => {
  const base: PriceLineInput = {
    incoterm: "FOB",
    fobPricePerStem: 1.0,
    sourceCurrency: "USD",
    targetCurrency: "EUR",
    stemsPerBox: 40,
    marginPercent: 0, // isolate the conversion
  };

  it("applies the exact rate provided in the snapshot (1 USD = 0.92 EUR)", () => {
    const result = calculatePriceLine({
      ...base,
      exchangeRate: { baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.92 },
    });
    expect(result.exchangeRateUsed?.toString()).toBe("0.92");
    expect(result.costPricePerStemTarget.toString()).toBe("0.92");
  });

  it("a manual override rate yields a different result than the default rate", () => {
    const withDefault = calculatePriceLine({
      ...base,
      exchangeRate: { baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.92 },
    });
    const withManual = calculatePriceLine({
      ...base,
      exchangeRate: { baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.85 },
    });
    expect(withManual.costPricePerStemTarget.toString()).not.toBe(withDefault.costPricePerStemTarget.toString());
    expect(withManual.costPricePerStemTarget.toString()).toBe("0.85");
  });

  it("no rate is used when source and target currency are equal", () => {
    const result = calculatePriceLine({ ...base, targetCurrency: "USD" });
    expect(result.exchangeRateUsed).toBeNull();
    expect(result.costPricePerStemTarget.toString()).toBe("1");
  });

  it("converts using a rate stored in the opposite direction (EUR->USD used for USD->EUR)", () => {
    // 1 EUR = 1.10 USD  =>  1 USD = 1/1.10 EUR
    const converted = convertCurrency(1.1, "USD", "EUR", {
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      rate: 1.1,
    });
    expect(converted.toString()).toBe("1");
  });
});
