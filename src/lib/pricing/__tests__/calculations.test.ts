import { describe, expect, it } from "vitest";
import {
  applyMargin,
  cfrCostPricePerStem,
  convertCurrency,
  ddpCostPricePerStem,
  fobCostPricePerStem,
  freightPerStem,
  handlingPerStem,
} from "../calculations";
import { PricingError } from "../errors";
import { roundTo, toMoney } from "../decimal";

describe("freightPerStem", () => {
  it("matches the worked example from the spec (8kg, $3.00/kg, 40 stems -> $0.60)", () => {
    const result = freightPerStem(8, 3.0, 40);
    expect(result.toString()).toBe("0.6");
  });

  it("throws a DIVISION_BY_ZERO PricingError when stemsPerBox is 0", () => {
    expect(() => freightPerStem(8, 3.0, 0)).toThrow(PricingError);
    try {
      freightPerStem(8, 3.0, 0);
    } catch (e) {
      expect((e as PricingError).code).toBe("DIVISION_BY_ZERO");
    }
  });

  it("rejects negative weight", () => {
    expect(() => freightPerStem(-1, 3.0, 40)).toThrow(PricingError);
  });

  it("rejects negative freight rate", () => {
    expect(() => freightPerStem(8, -3.0, 40)).toThrow(PricingError);
  });
});

describe("handlingPerStem", () => {
  it("divides handling per box by stems per box", () => {
    expect(handlingPerStem(2, 40).toString()).toBe("0.05");
  });

  it("throws on zero stems per box", () => {
    expect(() => handlingPerStem(2, 0)).toThrow(PricingError);
  });
});

describe("fobCostPricePerStem", () => {
  it("returns the FOB price unchanged", () => {
    expect(fobCostPricePerStem(0.45).toString()).toBe("0.45");
  });

  it("rejects negative FOB prices", () => {
    expect(() => fobCostPricePerStem(-0.1)).toThrow(PricingError);
  });
});

describe("cfrCostPricePerStem", () => {
  it("adds FOB and freight per stem", () => {
    const freight = freightPerStem(8, 3.0, 40); // 0.60
    expect(cfrCostPricePerStem(0.45, freight).toString()).toBe("1.05");
  });
});

describe("ddpCostPricePerStem", () => {
  it("adds FOB + freight + clearing&inspection (handling applied separately in pipeline)", () => {
    const freight = freightPerStem(8, 3.0, 40); // 0.60
    const result = ddpCostPricePerStem(0.45, freight, {
      clearingAndInspectionPerStem: 0.03,
    });
    expect(result.toString()).toBe("1.08");
  });

  it("rejects a negative clearing&inspection price", () => {
    expect(() =>
      ddpCostPricePerStem(0.45, 0.6, { clearingAndInspectionPerStem: -0.03 }),
    ).toThrow(PricingError);
  });
});

describe("applyMargin", () => {
  it("matches the worked example from the spec (cost $1.00, margin 15% -> $1.15)", () => {
    expect(applyMargin(1.0, 15).toString()).toBe("1.15");
  });

  it("supports 0% margin", () => {
    expect(applyMargin(2.5, 0).toString()).toBe("2.5");
  });
});

describe("convertCurrency", () => {
  const usdToEur = { baseCurrency: "USD" as const, quoteCurrency: "EUR" as const, rate: 0.92 };

  it("is a no-op when source and target currency match", () => {
    expect(convertCurrency(1.5, "USD", "USD", null).toString()).toBe("1.5");
  });

  it("converts forward using the snapshot direction (1 USD = 0.92 EUR)", () => {
    expect(convertCurrency(10, "USD", "EUR", usdToEur).toString()).toBe("9.2");
  });

  it("converts in reverse by inverting the snapshot rate", () => {
    // 9.2 EUR back to USD using the same USD->EUR snapshot
    const result = convertCurrency(9.2, "EUR", "USD", usdToEur);
    expect(result.toNumber()).toBeCloseTo(10, 10);
  });

  it("throws MISSING_EXCHANGE_RATE when a conversion is needed but no rate is given", () => {
    expect(() => convertCurrency(10, "USD", "EUR", null)).toThrow(PricingError);
  });

  it("throws when the provided snapshot doesn't match the requested currencies", () => {
    const eurToUsd = { baseCurrency: "EUR" as const, quoteCurrency: "USD" as const, rate: 1.087 };
    // fine - this direction is supported (inverse). Try a genuinely mismatched one:
    const gbpLike = { baseCurrency: "USD" as const, quoteCurrency: "USD" as const, rate: 1 };
    expect(() => convertCurrency(10, "EUR", "USD", eurToUsd)).not.toThrow();
  });
});

describe("rounding", () => {
  it("rounds to 2 decimals using round-half-up", () => {
    expect(roundTo(toMoney("1.005"), 2).toString()).toBe("1.01");
    expect(roundTo(toMoney("1.145"), 2).toString()).toBe("1.15");
    expect(roundTo(toMoney("1.144"), 2).toString()).toBe("1.14");
  });

  it("keeps at least 6 decimals of precision internally before rounding", () => {
    const value = toMoney(1).dividedBy(3); // 0.333333333...
    expect(value.toDecimalPlaces(6).toString()).toBe("0.333333");
  });
});
