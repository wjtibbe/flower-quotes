import { describe, expect, it } from "vitest";
import { validatePriceLineInput } from "../validation";
import { calculatePriceLine } from "../pipeline";
import type { PriceLineInput } from "../types";

const validDdp: PriceLineInput = {
  incoterm: "DDP",
  fobPricePerStem: 0.45,
  weightPerBoxKg: 6.5,
  freightRatePerKg: 3.1,
  stemsPerBox: 40,
  ddp: { clearingAndInspectionPerStem: 0.03, handlingPerBox: 2.0 },
  sourceCurrency: "USD",
  targetCurrency: "EUR",
  exchangeRate: { baseCurrency: "USD", quoteCurrency: "EUR", rate: 0.92 },
  marginPercent: 20,
};

describe("validatePriceLineInput", () => {
  it("returns no issues for a fully specified DDP line", () => {
    expect(validatePriceLineInput(validDdp)).toEqual([]);
  });

  it.each([
    ["MISSING_FOB_PRICE", { fobPricePerStem: undefined }],
    ["MISSING_STEMS_PER_BOX", { stemsPerBox: undefined }],
    ["ZERO_STEMS_PER_BOX", { stemsPerBox: 0 }],
    ["MISSING_WEIGHT", { weightPerBoxKg: undefined }],
    ["MISSING_FREIGHT_RATE", { freightRatePerKg: undefined }],
    ["MISSING_DDP_CLEARING_INSPECTION", { ddp: { handlingPerBox: 2 } }],
    ["MISSING_DDP_HANDLING", { ddp: { clearingAndInspectionPerStem: 0.03 } }],
    ["MISSING_EXCHANGE_RATE", { exchangeRate: undefined }],
    ["MISSING_MARGIN", { marginPercent: undefined }],
  ] as const)("flags %s when the field is missing", (code, override) => {
    const input = { ...validDdp, ...override } as PriceLineInput;
    const issues = validatePriceLineInput(input);
    expect(issues.map((i) => i.code)).toContain(code);
  });

  it("flags negative prices and weights", () => {
    expect(
      validatePriceLineInput({ ...validDdp, fobPricePerStem: -1 }).map((i) => i.code),
    ).toContain("NEGATIVE_PRICE");
    expect(
      validatePriceLineInput({ ...validDdp, weightPerBoxKg: -1 }).map((i) => i.code),
    ).toContain("NEGATIVE_WEIGHT");
  });

  it("does not require weight/freight/ddp fields for plain FOB lines", () => {
    const fobInput: PriceLineInput = {
      incoterm: "FOB",
      fobPricePerStem: 0.45,
      stemsPerBox: 40,
      sourceCurrency: "USD",
      targetCurrency: "USD",
      marginPercent: 15,
    };
    expect(validatePriceLineInput(fobInput)).toEqual([]);
  });
});

describe("quote snapshot immutability", () => {
  it("a computed breakdown is unaffected by later mutation of the input exchange rate object", () => {
    const exchangeRate = { baseCurrency: "USD" as const, quoteCurrency: "EUR" as const, rate: 0.92 };
    const input: PriceLineInput = { ...validDdp, exchangeRate };
    const breakdown = calculatePriceLine(input);
    const snapshotSellPrice = breakdown.finalSellPricePerStemRounded.toString();

    // Simulate the exchange rate being updated elsewhere in the app later.
    exchangeRate.rate = 1.5;

    // The already-computed breakdown must not change - it holds its own Decimal snapshot.
    expect(breakdown.finalSellPricePerStemRounded.toString()).toBe(snapshotSellPrice);

    // A fresh calculation with the old input object, however, would now use the mutated
    // rate - demonstrating why callers must persist the snapshot value on the Quote/QuoteLine
    // record rather than a live reference (see prisma schema: exchangeRateValue on Quote).
    const recalculated = calculatePriceLine(input);
    expect(recalculated.finalSellPricePerStemRounded.toString()).not.toBe(snapshotSellPrice);
  });
});
