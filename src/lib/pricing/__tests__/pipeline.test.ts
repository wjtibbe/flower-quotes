import { describe, expect, it } from "vitest";
import { calculatePriceLine } from "../pipeline";
import { PricingError } from "../errors";
import type { PriceLineInput } from "../types";

describe("calculatePriceLine - FOB", () => {
  it("cost price equals FOB price, margin applied, no currency conversion", () => {
    const input: PriceLineInput = {
      incoterm: "FOB",
      fobPricePerStem: 1.0,
      sourceCurrency: "USD",
      targetCurrency: "USD",
      stemsPerBox: 40,
      marginPercent: 15,
    };
    const result = calculatePriceLine(input);
    expect(result.totalCostPricePerStemSource.toString()).toBe("1");
    expect(result.exchangeRateUsed).toBeNull();
    expect(result.calculatedSellPricePerStemRounded.toString()).toBe("1.15");
    expect(result.finalSellPricePerStemRounded.toString()).toBe("1.15");
    expect(result.isManualOverride).toBe(false);
  });
});

describe("calculatePriceLine - C&F", () => {
  it("cost price includes freight per stem", () => {
    const input: PriceLineInput = {
      incoterm: "CFR",
      fobPricePerStem: 0.45,
      weightPerBoxKg: 8,
      freightRatePerKg: 3.0,
      stemsPerBox: 40,
      sourceCurrency: "USD",
      targetCurrency: "USD",
      marginPercent: 10,
    };
    const result = calculatePriceLine(input);
    expect(result.freightPerStem.toString()).toBe("0.6");
    expect(result.totalCostPricePerStemSource.toString()).toBe("1.05");
    expect(result.calculatedSellPricePerStemRounded.toString()).toBe("1.16"); // 1.05 * 1.10 = 1.155 -> round half up -> 1.16
  });
});

describe("calculatePriceLine - DDP with currency conversion", () => {
  it("matches a full hand-computed worked example (USD cost -> EUR sell)", () => {
    const input: PriceLineInput = {
      incoterm: "DDP",
      fobPricePerStem: 0.45,
      weightPerBoxKg: 6.5,
      freightRatePerKg: 3.1,
      stemsPerBox: 40,
      ddp: {
        clearingPerStem: 0.02,
        inspectionPerStem: 0.01,
        handlingPerBox: 2.0,
      },
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      exchangeRate: { baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.92 },
      marginPercent: 20,
    };
    const result = calculatePriceLine(input);

    // freight = 6.5*3.1/40 = 0.50375
    expect(result.freightPerStem.toString()).toBe("0.50375");
    // handling = 2.00/40 = 0.05
    expect(result.handlingPerStem.toString()).toBe("0.05");
    // cost (USD) = 0.45 + 0.50375 + 0.02 + 0.01 + 0.05 = 1.03375
    expect(result.totalCostPricePerStemSource.toString()).toBe("1.03375");
    // cost (EUR) = 1.03375 * 0.92 = 0.95105
    expect(result.costPricePerStemTarget.toString()).toBe("0.95105");
    // sell = 0.95105 * 1.20 = 1.14126
    expect(result.calculatedSellPricePerStem.toString()).toBe("1.14126");
    expect(result.calculatedSellPricePerStemRounded.toString()).toBe("1.14");
    expect(result.finalSellPricePerStemRounded.toString()).toBe("1.14");
  });

  it("throws when currency conversion is needed but no exchange rate snapshot is supplied", () => {
    const input: PriceLineInput = {
      incoterm: "FOB",
      fobPricePerStem: 1,
      stemsPerBox: 40,
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      marginPercent: 10,
    };
    expect(() => calculatePriceLine(input)).toThrow(PricingError);
  });
});

describe("calculatePriceLine - manual override", () => {
  it("keeps the calculated price for audit while final price reflects the manual override", () => {
    const input: PriceLineInput = {
      incoterm: "FOB",
      fobPricePerStem: 1.0,
      stemsPerBox: 40,
      sourceCurrency: "USD",
      targetCurrency: "USD",
      marginPercent: 15,
      manualSellPricePerStem: 1.25,
      manualOverrideReason: "Klant onderhandeld",
    };
    const result = calculatePriceLine(input);
    expect(result.calculatedSellPricePerStemRounded.toString()).toBe("1.15");
    expect(result.isManualOverride).toBe(true);
    expect(result.manualSellPricePerStem?.toString()).toBe("1.25");
    expect(result.finalSellPricePerStemRounded.toString()).toBe("1.25");
  });
});

describe("calculatePriceLine - missing data / validation blockers", () => {
  const base: PriceLineInput = {
    incoterm: "DDP",
    fobPricePerStem: 0.45,
    weightPerBoxKg: 6.5,
    freightRatePerKg: 3.1,
    stemsPerBox: 40,
    ddp: { clearingPerStem: 0.02, inspectionPerStem: 0.01, handlingPerBox: 2.0 },
    sourceCurrency: "USD",
    targetCurrency: "USD",
    marginPercent: 20,
  };

  it("throws when FOB price is missing", () => {
    const input = { ...base, fobPricePerStem: undefined as unknown as number };
    expect(() => calculatePriceLine(input)).toThrow(PricingError);
  });

  it("throws when stems per box is 0", () => {
    expect(() => calculatePriceLine({ ...base, stemsPerBox: 0 })).toThrow(PricingError);
  });

  it("throws when weight is missing for DDP", () => {
    const input = { ...base, weightPerBoxKg: undefined };
    expect(() => calculatePriceLine(input)).toThrow(PricingError);
  });

  it("throws when freight rate is missing for DDP", () => {
    const input = { ...base, freightRatePerKg: undefined };
    expect(() => calculatePriceLine(input)).toThrow(PricingError);
  });

  it("throws when DDP clearing/inspection/handling are missing", () => {
    expect(() => calculatePriceLine({ ...base, ddp: {} })).toThrow(PricingError);
  });

  it("throws when margin is missing", () => {
    const input = { ...base, marginPercent: undefined as unknown as number };
    expect(() => calculatePriceLine(input)).toThrow(PricingError);
  });

  it("throws on negative prices", () => {
    expect(() => calculatePriceLine({ ...base, fobPricePerStem: -0.1 })).toThrow(PricingError);
  });
});
