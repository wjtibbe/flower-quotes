import { describe, expect, it } from "vitest";
import { calculatePriceLine } from "../pipeline";
import { convertCurrency } from "../calculations";
import type { CurrencyCode, ExchangeRateSnapshot, PriceLineInput } from "../types";

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

describe("EUR-based rate derivation generalizes beyond a single non-EUR currency", () => {
  // CurrencyCode is currently "USD" | "EUR" only - COP is not a real,
  // supported currency in this system (see
  // src/app/(app)/farms/__tests__/actions.test.ts, where an unsupported
  // currency such as COP is explicitly rejected rather than accepted). These
  // three tests use `as unknown as ExchangeRateSnapshot`/`as CurrencyCode` to
  // prove that convertCurrency's existing algebra already derives a
  // cross-currency conversion by chaining two EUR-based rates, with no
  // separate manually maintained rate for the non-EUR pair - the business
  // rule this module enforces (see src/lib/exchangeRate.ts), demonstrated
  // generically in case a third currency is ever added.
  const eurToUsd: ExchangeRateSnapshot = { baseCurrency: "EUR", quoteCurrency: "USD", rate: 1.17 };
  const eurToCop = { baseCurrency: "EUR", quoteCurrency: "COP", rate: 4500 } as unknown as ExchangeRateSnapshot;

  it("EUR -> COP works directly from a stored EUR-based rate", () => {
    const result = convertCurrency(1, "EUR" as CurrencyCode, "COP" as CurrencyCode, eurToCop);
    expect(result.toString()).toBe("4500");
  });

  it("COP -> EUR is derived by dividing the same stored rate (no inverse row needed)", () => {
    const result = convertCurrency(4500, "COP" as CurrencyCode, "EUR" as CurrencyCode, eurToCop);
    expect(result.toString()).toBe("1");
  });

  it("USD -> COP derives via EUR by chaining the two EUR-based rates - no manually maintained USD/COP rate is required", () => {
    const amountUsd = 117;
    const amountEur = convertCurrency(amountUsd, "USD", "EUR", eurToUsd);
    const amountCop = convertCurrency(amountEur, "EUR" as CurrencyCode, "COP" as CurrencyCode, eurToCop);
    // 117 USD -> 100 EUR -> 450000 COP
    expect(amountCop.toString()).toBe("450000");
  });
});
