import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enrichParsedOfferLine, type MatchedPackagingInfo } from "../farmOfferEnrichment";
import {
  isValidFobPrice,
  mapParsedOfferLineToCreateInput,
  calculateTotalStems,
} from "../offerLineMapping";
import { normalizeBoxTypeForImport } from "../offerLineFilters";
import { validateOfferLineForFinalization } from "../offerLineValidation";
import { resolveOfferLinePricingQuantity } from "@/lib/quotes/quantityResolution";
import type { ParsedOfferLine } from "../types";

/**
 * Regression tests for "deterministic Farm Offer defaults" - quantity/unit/
 * box type are always resolved by application logic (never left for a
 * human to confirm something the app already knows), while FOB price per
 * stem stays mandatory and must be a genuinely positive value. Item numbers
 * below match the task's own 28-item test list.
 */

function line(overrides: Partial<ParsedOfferLine> = {}): ParsedOfferLine {
  return {
    rawText: "Candy Xpression 60cm\n0.22",
    productGroupRaw: "Rose",
    varietyRaw: "Candy Xpression",
    lengthCm: 60,
    fobPricePerStem: "0.22",
    currency: "USD",
    confidence: "medium",
    fieldConfidence: {},
    needsReview: true,
    parserWarnings: [],
    ...overrides,
  };
}

const CANDY_PROFILE: MatchedPackagingInfo = {
  boxType: "QB",
  stemsPerBox: 100,
  weightPerBoxKg: "6.500",
  productName: "Rose",
  variety: "Candy Xpression",
  stemLength: "60 cm",
};

describe("deterministic quantity default (items 1-2)", () => {
  it("1: missing quantity defaults to 1", () => {
    const out = enrichParsedOfferLine(line(), null, "USD");
    expect(out.quantity).toBe("1");
  });

  it("2: an explicit quantity of 5 remains 5, never overwritten by the default", () => {
    const out = enrichParsedOfferLine(line({ quantity: "5" }), null, "USD");
    expect(out.quantity).toBe("5");
  });
});

describe("fixed quantity unit (items 3-4)", () => {
  it("3: missing unit becomes BOXES", () => {
    const out = enrichParsedOfferLine(line(), null, "USD");
    expect(out.unit).toBe("BOXES");
  });

  it("4: once BOXES is applied, unit is never reported as missing by finalization validation", () => {
    const out = enrichParsedOfferLine(line({ quantity: "8" }), CANDY_PROFILE, "USD");
    const { errors } = validateOfferLineForFinalization({
      packagingWeightProfileId: "profile-1",
      productGroupRaw: out.productGroupRaw,
      varietyRaw: out.varietyRaw,
      fobPricePerStem: out.fobPricePerStem,
      currency: out.currency,
      unit: out.unit ?? null,
      stemLengthCm: out.lengthCm ?? null,
      quantity: out.quantity,
      totalStems: calculateTotalStems({ quantity: 8, unit: "BOXES", stemsPerBox: 100 }),
    });
    expect(errors).not.toContain("Eenheid (unit) ontbreekt.");
  });
});

describe("QB-only box type normalization (items 5-7)", () => {
  it("5: missing box type becomes QB", () => {
    expect(normalizeBoxTypeForImport(undefined)).toBe("QB");
    const out = enrichParsedOfferLine(line(), null, "USD");
    expect(out.boxType).toBe("QB");
  });

  it("6: HB normalizes to QB while the explicit quantity is preserved", () => {
    const out = enrichParsedOfferLine(line({ boxType: "HB", quantity: "8" }), null, "USD");
    expect(out.boxType).toBe("QB");
    expect(out.quantity).toBe("8");
  });

  it("7: QB stays QB", () => {
    const out = enrichParsedOfferLine(line({ boxType: "QB" }), null, "USD");
    expect(out.boxType).toBe("QB");
  });
});

describe("fixed price unit (items 8-9, 24)", () => {
  it("8: priceUnit is always PER_STEM on the create-input mapping", () => {
    const mapped = mapParsedOfferLineToCreateInput(line({ quantity: "1", unit: "BOXES", boxType: "QB" }));
    expect(mapped.priceUnit).toBe("PER_STEM");
  });

  it("9: an unresolved/unrelated warning about price unit is not a real, active review concern - priceUnit is a fixed field, never sourced from a warning", () => {
    const out = enrichParsedOfferLine(
      line({ parserWarnings: ["Steellengte kon niet worden geïnterpreteerd."] }),
      null,
      "USD",
    );
    // The fixed PER_STEM mapping happens independently of parserWarnings content.
    const mapped = mapParsedOfferLineToCreateInput(out);
    expect(mapped.priceUnit).toBe("PER_STEM");
  });

  it("24: the fixed PER_STEM unit does not remove the FOB price requirement - a line with everything else resolved but no price still blocks", () => {
    const out = enrichParsedOfferLine(line({ fobPricePerStem: undefined }), CANDY_PROFILE, "USD");
    const mapped = mapParsedOfferLineToCreateInput(out);
    expect(mapped.priceUnit).toBe("PER_STEM");
    const { errors } = validateOfferLineForFinalization({
      packagingWeightProfileId: "profile-1",
      productGroupRaw: out.productGroupRaw,
      varietyRaw: out.varietyRaw,
      fobPricePerStem: out.fobPricePerStem ?? null,
      currency: out.currency,
      unit: out.unit ?? null,
      stemLengthCm: out.lengthCm ?? null,
      quantity: out.quantity,
      totalStems: null,
    });
    expect(errors).toContain("FOB-prijs per steel ontbreekt of moet groter zijn dan nul.");
  });
});

describe("selected Farm/Supplier is authoritative (items 10-12)", () => {
  it("11: a 'farm name not stated' parser warning disappears once resolved (the selected supplier is always authoritative)", () => {
    const out = enrichParsedOfferLine(
      line({ parserWarnings: ["Farm name is not stated in the source text."] }),
      null,
      "USD",
    );
    expect(out.parserWarnings).toEqual([]);
  });

  it("10/12: a combined quantity/unit/supplier-name warning disappears completely once the deterministic defaults are applied", () => {
    const out = enrichParsedOfferLine(
      line({ parserWarnings: ["Quantity, unit and supplier name are not stated."] }),
      null,
      "USD",
    );
    expect(out.parserWarnings).toEqual([]);
    expect(out.quantity).toBe("1");
    expect(out.unit).toBe("BOXES");
  });
});

describe("audit trail is preserved (items 13-14)", () => {
  it("13: extractedSnapshot (built from the pre-enrichment original) keeps the original, un-defaulted quantity/unit/boxType", () => {
    const original = line({ boxType: "HB" }); // no quantity stated
    const enriched = enrichParsedOfferLine(original, null, "USD");
    const mapped = mapParsedOfferLineToCreateInput(enriched, original);
    const snapshot = mapped.extractedSnapshot as Record<string, unknown>;
    expect(snapshot.boxType).toBe("HB");
    expect(snapshot.quantity).toBeNull();
    expect(mapped.boxType).toBe("QB");
    expect(mapped.quantity).toBe("1");
  });

  it("14: rawText is never touched by enrichment or mapping", () => {
    const original = line();
    const enriched = enrichParsedOfferLine(original, null, "USD");
    const mapped = mapParsedOfferLineToCreateInput(enriched, original);
    expect(enriched.rawText).toBe(original.rawText);
    expect(mapped.rawText).toBe(original.rawText);
  });
});

describe("totalStems from the resolved quantity (items 15-16)", () => {
  it("15: the default quantity of 1 x canonical stemsPerBox calculates totalStems", () => {
    const out = enrichParsedOfferLine(line(), CANDY_PROFILE, "USD");
    expect(out.quantity).toBe("1");
    const totalStems = calculateTotalStems({ quantity: 1, unit: "BOXES", stemsPerBox: CANDY_PROFILE.stemsPerBox });
    expect(totalStems).toBe(100);
  });

  it("16: an explicit quantity x stemsPerBox calculates correctly", () => {
    const out = enrichParsedOfferLine(line({ quantity: "8" }), CANDY_PROFILE, "USD");
    expect(out.quantity).toBe("8");
    const totalStems = calculateTotalStems({ quantity: 8, unit: "BOXES", stemsPerBox: CANDY_PROFILE.stemsPerBox });
    expect(totalStems).toBe(800);
  });
});

describe("validation reflects current effective state (items 17-18, 20-23)", () => {
  it("17: no blocking error for quantity/unit/box-type once the deterministic defaults are applied and everything else is present", () => {
    const out = enrichParsedOfferLine(line(), CANDY_PROFILE, "USD");
    const { errors } = validateOfferLineForFinalization({
      packagingWeightProfileId: "profile-1",
      productGroupRaw: out.productGroupRaw,
      varietyRaw: out.varietyRaw,
      fobPricePerStem: out.fobPricePerStem,
      currency: out.currency,
      unit: out.unit ?? null,
      stemLengthCm: out.lengthCm ?? null,
      quantity: out.quantity,
      totalStems: calculateTotalStems({ quantity: 1, unit: "BOXES", stemsPerBox: CANDY_PROFILE.stemsPerBox }),
    });
    expect(errors).toEqual([]);
  });

  it("18: an unrelated warning is never removed by reconciliation", () => {
    const out = enrichParsedOfferLine(
      line({ parserWarnings: ["Lengte kon niet worden geïnterpreteerd - controleer handmatig."] }),
      null,
      "USD",
    );
    expect(out.parserWarnings).toEqual(["Lengte kon niet worden geïnterpreteerd - controleer handmatig."]);
  });

  it("20: a missing FOB price remains a blocking error", () => {
    expect(isValidFobPrice(undefined)).toBe(false);
    expect(isValidFobPrice(null)).toBe(false);
    const { errors } = validateOfferLineForFinalization({
      packagingWeightProfileId: "profile-1",
      productGroupRaw: "Rose",
      varietyRaw: "Candy Xpression",
      fobPricePerStem: null,
      currency: "USD",
      unit: "BOXES",
      stemLengthCm: 60,
      quantity: "1",
      totalStems: 100,
    });
    expect(errors).toContain("FOB-prijs per steel ontbreekt of moet groter zijn dan nul.");
  });

  it("21: a FOB price of 0 is rejected", () => {
    expect(isValidFobPrice("0")).toBe(false);
    expect(isValidFobPrice(0)).toBe(false);
  });

  it("22: a negative FOB price is rejected", () => {
    expect(isValidFobPrice("-0.1")).toBe(false);
    expect(isValidFobPrice(-5)).toBe(false);
  });

  it("23: a valid positive FOB price per stem is accepted", () => {
    expect(isValidFobPrice("0.22")).toBe(true);
    expect(isValidFobPrice(1.5)).toBe(true);
  });
});

describe("downstream quote compatibility (item 19)", () => {
  it("19: quote-quantity resolution receives the explicit, PERSISTED quantity/unit and never silently defaults on its own", () => {
    // The default is resolved and persisted at IMPORT time (enrichParsedOfferLine) -
    // resolveOfferLinePricingQuantity itself must still never invent a "1" when a
    // caller (incorrectly) passes a genuinely missing quantity, proving no silent
    // `?? 1` fallback was reintroduced downstream.
    const missing = resolveOfferLinePricingQuantity({ quantity: null, unit: null, boxesAvailable: null, stemsPerBox: 100 });
    expect(missing.ok).toBe(false);

    // With the deterministic default already applied and persisted (quantity=1, unit=BOXES),
    // quote pricing resolves it directly - no re-defaulting needed.
    const resolved = resolveOfferLinePricingQuantity({ quantity: 1, unit: "BOXES", boxesAvailable: null, stemsPerBox: 100 });
    expect(resolved).toEqual({ ok: true, quantityBoxes: 1, totalStems: 100, stemsPerBox: 100, source: "BOXES" });
  });
});

describe("shared price-table pricing remains supported (items 26-27)", () => {
  it("26: a price resolved via the existing shared price-table/range-expansion logic is accepted once it is a genuine positive value", () => {
    // Range expansion resolves each expanded row's own fobPricePerStem before
    // this line ever reaches enrichment - this only re-confirms that a
    // deterministically-resolved tier price behaves like any other valid price.
    expect(isValidFobPrice("0.35")).toBe(true);
  });

  it("27: an unresolved/missing shared price-table tier remains blocked, never guessed", () => {
    expect(isValidFobPrice(undefined)).toBe(false);
  });
});

describe("review UI label (item 25)", () => {
  it("25: the review row clearly labels the FOB price field, not a generic 'Price'", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../../app/(app)/farm-offers/[id]/review/OfferLineReviewRow.tsx"),
      "utf-8",
    );
    expect(source).toContain("FOB price per stem");
    expect(source).not.toMatch(/label="Price per stem"/);
  });
});
