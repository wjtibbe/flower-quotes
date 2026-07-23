import { describe, expect, it } from "vitest";
import {
  enrichParsedOfferLine,
  filterResolvedEnrichmentWarnings,
  resolveEffectiveCurrency,
  type MatchedPackagingInfo,
} from "../farmOfferEnrichment";
import { CURRENCY_NOT_STATED_WARNING } from "../provider";
import type { ParsedOfferLine } from "../types";

function line(overrides: Partial<ParsedOfferLine> = {}): ParsedOfferLine {
  return {
    rawText: "2hb Sweetness 40cm",
    productGroupRaw: "Rose",
    varietyRaw: "Sweetness",
    lengthCm: 40,
    boxType: "HB",
    boxesAvailable: 2,
    fobPricePerStem: "0.16",
    confidence: "medium",
    fieldConfidence: {},
    needsReview: true,
    parserWarnings: [],
    ...overrides,
  };
}

const SWEETNESS_PROFILE: MatchedPackagingInfo = { boxType: "QB", stemsPerBox: 125, weightPerBoxKg: "7.000" };

describe("resolveEffectiveCurrency - Colombia/Ecuador USD default", () => {
  it("Colombia + missing currency + price present -> USD, resolved", () => {
    expect(resolveEffectiveCurrency(undefined, "Colombia", true)).toEqual({ currency: "USD", resolved: true });
  });

  it("Ecuador + missing currency + price present -> USD, resolved", () => {
    expect(resolveEffectiveCurrency(undefined, "Ecuador", true)).toEqual({ currency: "USD", resolved: true });
  });

  it("is case-insensitive/trimmed for the country name", () => {
    expect(resolveEffectiveCurrency(undefined, "colombia", true)).toEqual({ currency: "USD", resolved: true });
    expect(resolveEffectiveCurrency(undefined, " ECUADOR ", true)).toEqual({ currency: "USD", resolved: true });
  });

  it("an explicit EUR from a Colombia/Ecuador supplier is preserved, never overwritten", () => {
    expect(resolveEffectiveCurrency("EUR", "Colombia", true)).toEqual({ currency: "EUR", resolved: true });
    expect(resolveEffectiveCurrency("EUR", "Ecuador", true)).toEqual({ currency: "EUR", resolved: true });
  });

  it("an explicit USD is preserved (not merely re-derived from the rule)", () => {
    expect(resolveEffectiveCurrency("USD", "Colombia", true)).toEqual({ currency: "USD", resolved: true });
  });

  it("does not default for a non-Colombia/Ecuador country", () => {
    expect(resolveEffectiveCurrency(undefined, "Netherlands", true)).toEqual({ currency: undefined, resolved: false });
  });

  it("does not default when there is no price at all, even for Colombia/Ecuador", () => {
    expect(resolveEffectiveCurrency(undefined, "Colombia", false)).toEqual({ currency: undefined, resolved: false });
  });

  it("does not default when the farm country is unknown/missing", () => {
    expect(resolveEffectiveCurrency(undefined, null, true)).toEqual({ currency: undefined, resolved: false });
    expect(resolveEffectiveCurrency(undefined, undefined, true)).toEqual({ currency: undefined, resolved: false });
  });
});

describe("filterResolvedEnrichmentWarnings", () => {
  it("drops the exact currency-not-stated warning when currency is resolved", () => {
    const out = filterResolvedEnrichmentWarnings([CURRENCY_NOT_STATED_WARNING], { stemsPerBox: false, currency: true });
    expect(out).toEqual([]);
  });

  it("keeps the currency warning when currency is NOT resolved", () => {
    const out = filterResolvedEnrichmentWarnings([CURRENCY_NOT_STATED_WARNING], { stemsPerBox: false, currency: false });
    expect(out).toEqual([CURRENCY_NOT_STATED_WARNING]);
  });

  it("drops an AI-authored 'stems per box' warning once stemsPerBox is resolved", () => {
    const out = filterResolvedEnrichmentWarnings(["stemsPerBox not stated."], { stemsPerBox: true, currency: false });
    expect(out).toEqual([]);
  });

  it("keeps a genuinely unresolved, unrelated warning untouched", () => {
    const genuine = "Lengte kon niet worden geïnterpreteerd - controleer handmatig.";
    const out = filterResolvedEnrichmentWarnings([genuine], { stemsPerBox: true, currency: true });
    expect(out).toEqual([genuine]);
  });
});

describe("enrichParsedOfferLine - the Sweetness example end to end", () => {
  it("applies canonical packaging, backfills quantity/unit, defaults currency, and cleans up resolved warnings", () => {
    const input = line({
      parserWarnings: ["stemsPerBox not stated.", CURRENCY_NOT_STATED_WARNING],
    });
    const out = enrichParsedOfferLine(input, SWEETNESS_PROFILE, "Colombia");

    expect(out.boxType).toBe("QB");
    expect(out.stemsPerBox).toBe(125);
    expect(out.weightPerBoxKg).toBe("7.000");
    expect(out.quantity).toBe("2");
    expect(out.unit).toBe("BOXES");
    expect(out.currency).toBe("USD");
    expect(out.parserWarnings).toEqual([]);
  });

  it("never mutates rawText", () => {
    const input = line();
    const out = enrichParsedOfferLine(input, SWEETNESS_PROFILE, "Colombia");
    expect(out.rawText).toBe("2hb Sweetness 40cm");
  });

  it("leaves an unmatched line's packaging fields untouched (nothing trusted to enrich from)", () => {
    const input = line({ boxType: "HB", stemsPerBox: undefined, weightPerBoxKg: undefined });
    const out = enrichParsedOfferLine(input, null, "Colombia");
    expect(out.stemsPerBox).toBeUndefined();
    expect(out.weightPerBoxKg).toBeUndefined();
    // boxType HB->QB is a SEPARATE, pre-existing normalization applied later
    // in mapParsedOfferLineToCreateInput - this function does not duplicate it.
    expect(out.boxType).toBe("HB");
  });

  it("does not backfill quantity/unit when quantity/unit were already explicit", () => {
    const input = line({ quantity: "5", unit: "STEMS", boxesAvailable: 2 });
    const out = enrichParsedOfferLine(input, null, "Colombia");
    expect(out.quantity).toBe("5");
    expect(out.unit).toBe("STEMS");
  });

  it("does not default currency for a non-Colombia/Ecuador farm - the warning stays for genuine review", () => {
    const input = line({ parserWarnings: [CURRENCY_NOT_STATED_WARNING] });
    const out = enrichParsedOfferLine(input, SWEETNESS_PROFILE, "Netherlands");
    expect(out.currency).toBeUndefined();
    expect(out.parserWarnings).toContain(CURRENCY_NOT_STATED_WARNING);
  });

  it("preserves an explicit EUR for a Colombia farm", () => {
    const input = line({ currency: "EUR" });
    const out = enrichParsedOfferLine(input, SWEETNESS_PROFILE, "Colombia");
    expect(out.currency).toBe("EUR");
  });
});
