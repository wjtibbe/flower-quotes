import { describe, expect, it } from "vitest";
import {
  detectWarningTopics,
  enrichParsedOfferLine,
  isWarningResolved,
  reconcileWarnings,
  resolveEffectiveCurrency,
  type MatchedPackagingInfo,
  type ResolvedWarningTopics,
} from "../farmOfferEnrichment";
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

function resolved(overrides: Partial<ResolvedWarningTopics> = {}): ResolvedWarningTopics {
  return { stemsPerBox: false, boxWeight: false, price: false, currency: false, totalStems: false, ...overrides };
}

describe("resolveEffectiveCurrency - supplier defaultCurrency", () => {
  it("supplier default USD resolves a missing source currency", () => {
    expect(resolveEffectiveCurrency({ explicitCurrency: undefined, supplierDefaultCurrency: "USD" })).toEqual({
      currency: "USD",
      resolved: true,
    });
  });

  it("supplier default EUR resolves a missing source currency", () => {
    expect(resolveEffectiveCurrency({ explicitCurrency: undefined, supplierDefaultCurrency: "EUR" })).toEqual({
      currency: "EUR",
      resolved: true,
    });
  });

  it("an explicit EUR from a supplier defaulting to USD is preserved, never overwritten", () => {
    expect(resolveEffectiveCurrency({ explicitCurrency: "EUR", supplierDefaultCurrency: "USD" })).toEqual({
      currency: "EUR",
      resolved: true,
    });
  });

  it("an explicit USD from a supplier defaulting to EUR is preserved", () => {
    expect(resolveEffectiveCurrency({ explicitCurrency: "USD", supplierDefaultCurrency: "EUR" })).toEqual({
      currency: "USD",
      resolved: true,
    });
  });

  it("is unresolved when neither an explicit currency nor a supplier default exists", () => {
    expect(resolveEffectiveCurrency({ explicitCurrency: undefined, supplierDefaultCurrency: undefined })).toEqual({
      currency: undefined,
      resolved: false,
    });
  });
});

describe("detectWarningTopics", () => {
  it("detects a single topic", () => {
    expect(detectWarningTopics("stemsPerBox not stated.")).toEqual(["STEMS_PER_BOX"]);
    expect(detectWarningTopics("Valuta niet vermeld in de bron - controleer bij review.")).toEqual(["CURRENCY"]);
  });

  it("detects every topic referenced in a combined AI sentence", () => {
    const combined =
      "stemsPerBox not stated so price-per-stem could not be derived; price for this length must be resolved from the shared price table (40 cm = 0.16) but currency is not stated anywhere in the source";
    const topics = detectWarningTopics(combined);
    expect(topics).toContain("STEMS_PER_BOX");
    expect(topics).toContain("PRICE");
    expect(topics).toContain("CURRENCY");
  });

  it("returns an empty array for an OTHER/unrecognized warning", () => {
    expect(detectWarningTopics("Lengte kon niet worden geïnterpreteerd - controleer handmatig.")).toEqual([]);
  });
});

describe("isWarningResolved / reconcileWarnings", () => {
  it("a single-topic warning is resolved once that topic is resolved", () => {
    expect(isWarningResolved("stemsPerBox not stated.", resolved({ stemsPerBox: true }))).toBe(true);
    expect(isWarningResolved("stemsPerBox not stated.", resolved({ stemsPerBox: false }))).toBe(false);
  });

  it("a combined warning is resolved ONLY once EVERY referenced topic is resolved", () => {
    const combined =
      "stemsPerBox not stated so price-per-stem could not be derived; price for this length must be resolved from the shared price table (40 cm = 0.16) but currency is not stated anywhere in the source";
    expect(isWarningResolved(combined, resolved({ stemsPerBox: true, price: true, currency: true }))).toBe(true);
    // one referenced issue (currency) still unresolved -> the whole warning stays
    expect(isWarningResolved(combined, resolved({ stemsPerBox: true, price: true, currency: false }))).toBe(false);
  });

  it("an OTHER/unrecognized warning is never resolved, no matter what's resolved", () => {
    const genuine = "Lengte kon niet worden geïnterpreteerd - controleer handmatig.";
    expect(isWarningResolved(genuine, resolved({ stemsPerBox: true, boxWeight: true, price: true, currency: true, totalStems: true }))).toBe(
      false,
    );
  });

  it("reconcileWarnings drops only the resolved warnings, keeping unrelated ones", () => {
    const genuine = "Lengte kon niet worden geïnterpreteerd - controleer handmatig.";
    const out = reconcileWarnings(["stemsPerBox not stated.", genuine], resolved({ stemsPerBox: true }));
    expect(out).toEqual([genuine]);
  });

  it("box weight and total stems topics resolve independently", () => {
    expect(isWarningResolved("box weight not stated.", resolved({ boxWeight: true }))).toBe(true);
    expect(isWarningResolved("Totaal aantal stelen kon niet worden berekend.", resolved({ totalStems: true }))).toBe(true);
  });
});

describe("enrichParsedOfferLine - the Sweetness example end to end", () => {
  it("applies canonical packaging, backfills quantity/unit, resolves currency via supplier default, and cleans up resolved warnings", () => {
    const input = line({
      parserWarnings: ["stemsPerBox not stated.", "Valuta niet vermeld in de bron - controleer bij review."],
    });
    const out = enrichParsedOfferLine(input, SWEETNESS_PROFILE, "USD");

    expect(out.boxType).toBe("QB");
    expect(out.stemsPerBox).toBe(125);
    expect(out.weightPerBoxKg).toBe("7.000");
    expect(out.quantity).toBe("2");
    expect(out.unit).toBe("BOXES");
    expect(out.currency).toBe("USD");
    expect(out.parserWarnings).toEqual([]);
  });

  it("drops a combined warning once every referenced topic is resolved", () => {
    const combined =
      "stemsPerBox not stated so price-per-stem could not be derived; price for this length must be resolved from the shared price table (40 cm = 0.16) but currency is not stated anywhere in the source";
    const input = line({ parserWarnings: [combined] });
    const out = enrichParsedOfferLine(input, SWEETNESS_PROFILE, "USD");
    expect(out.parserWarnings).toEqual([]);
  });

  it("never mutates rawText", () => {
    const out = enrichParsedOfferLine(line(), SWEETNESS_PROFILE, "USD");
    expect(out.rawText).toBe("2hb Sweetness 40cm");
  });

  it("leaves an unmatched line's packaging fields untouched (nothing trusted to enrich from)", () => {
    const input = line({ boxType: "HB", stemsPerBox: undefined, weightPerBoxKg: undefined });
    const out = enrichParsedOfferLine(input, null, "USD");
    expect(out.stemsPerBox).toBeUndefined();
    expect(out.weightPerBoxKg).toBeUndefined();
    expect(out.boxType).toBe("HB");
  });

  it("preserves an explicit EUR even when the supplier default is USD", () => {
    const input = line({ currency: "EUR" });
    const out = enrichParsedOfferLine(input, SWEETNESS_PROFILE, "USD");
    expect(out.currency).toBe("EUR");
  });

  it("does not backfill quantity/unit when already explicit", () => {
    const input = line({ quantity: "5", unit: "STEMS", boxesAvailable: 2 });
    const out = enrichParsedOfferLine(input, null, "USD");
    expect(out.quantity).toBe("5");
    expect(out.unit).toBe("STEMS");
  });
});
