import { describe, expect, it } from "vitest";
import { quoteTotals } from "../quoteTotals";

describe("quoteTotals - som van alle QuoteLines", () => {
  it("sums boxes, stems and value across lines from different suppliers", () => {
    const totals = quoteTotals([
      // supplier A: 10 boxes x 40 stems at 0.50
      { stemsPerBox: 40, quantityBoxes: 10, calculatedSellPricePerStem: "0.50" },
      // supplier B: 5 boxes x 200 stems at 0.12
      { stemsPerBox: 200, quantityBoxes: 5, calculatedSellPricePerStem: "0.12" },
      // supplier C: 2 boxes x 300 stems at 0.08
      { stemsPerBox: 300, quantityBoxes: 2, calculatedSellPricePerStem: "0.08" },
    ]);
    expect(totals.totalBoxes).toBe(17);
    expect(totals.totalStems).toBe(400 + 1000 + 600);
    // 400*0.50 + 1000*0.12 + 600*0.08 = 200 + 120 + 48 = 368
    expect(totals.totalValue.toString()).toBe("368");
  });

  it("uses the manual override price when present", () => {
    const totals = quoteTotals([
      { stemsPerBox: 10, quantityBoxes: 1, calculatedSellPricePerStem: "1.00", manualSellPricePerStem: "2.00" },
      { stemsPerBox: 10, quantityBoxes: 1, calculatedSellPricePerStem: "1.00", manualSellPricePerStem: null },
    ]);
    expect(totals.totalValue.toString()).toBe("30"); // 10*2 + 10*1
  });

  it("returns zeros for an empty quote", () => {
    const totals = quoteTotals([]);
    expect(totals.totalBoxes).toBe(0);
    expect(totals.totalStems).toBe(0);
    expect(totals.totalValue.isZero()).toBe(true);
  });
});
