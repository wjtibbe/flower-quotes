import { describe, expect, it } from "vitest";
import {
  buildExtractedSnapshot,
  calculateTotalStems,
  mapParsedOfferLineToCreateInput,
  mapQuantityToBoxesAvailable,
  mergeValidationWarnings,
  normalizeValidationMessages,
  readValidationMessages,
} from "../offerLineMapping";
import type { ParsedOfferLine } from "../types";

function baseLine(overrides: Partial<ParsedOfferLine> = {}): ParsedOfferLine {
  return {
    rawText: "Dallas 60cm 20QBx100 $0.38",
    productGroupRaw: "Rose",
    varietyRaw: "Dallas",
    lengthCm: 60,
    boxType: "QB",
    stemsPerBox: 100,
    fobPricePerStem: "0.38",
    currency: "USD",
    treatmentRaw: "normal",
    confidence: "high",
    fieldConfidence: {},
    needsReview: false,
    parserWarnings: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section A: calculateTotalStems
// ---------------------------------------------------------------------------

describe("calculateTotalStems", () => {
  it("multiplies boxes by stemsPerBox for a whole number of boxes", () => {
    expect(calculateTotalStems({ quantity: 5, unit: "BOXES", stemsPerBox: 100 })).toBe(500);
  });

  it("returns the quantity itself for unit STEMS", () => {
    expect(calculateTotalStems({ quantity: 250, unit: "STEMS" })).toBe(250);
  });

  it("does not calculate for a fractional (non-whole) number of boxes", () => {
    expect(calculateTotalStems({ quantity: 2.5, unit: "BOXES", stemsPerBox: 100 })).toBeNull();
  });

  it("returns null for BUNCHES without an explicit stems-per-bunch value", () => {
    expect(calculateTotalStems({ quantity: 10, unit: "BUNCHES" })).toBeNull();
  });

  it("calculates for BUNCHES when stemsPerBunch IS explicitly known", () => {
    expect(calculateTotalStems({ quantity: 10, unit: "BUNCHES", stemsPerBunch: 25 })).toBe(250);
  });

  it("always returns null for KILOGRAMS - a weight never implies a stem count", () => {
    expect(calculateTotalStems({ quantity: 12.5, unit: "KILOGRAMS" })).toBeNull();
  });

  it("returns null when quantity is missing", () => {
    expect(calculateTotalStems({ quantity: null, unit: "BOXES", stemsPerBox: 100 })).toBeNull();
  });

  it("returns null when stemsPerBox is missing for BOXES", () => {
    expect(calculateTotalStems({ quantity: 5, unit: "BOXES" })).toBeNull();
  });

  it("returns null when unit is missing entirely", () => {
    expect(calculateTotalStems({ quantity: 5, unit: null })).toBeNull();
  });

  it("treats a zero or negative stemsPerBox as missing, not zero stems", () => {
    expect(calculateTotalStems({ quantity: 5, unit: "BOXES", stemsPerBox: 0 })).toBeNull();
  });
});

describe("mapQuantityToBoxesAvailable", () => {
  it("maps a whole-number BOXES quantity directly", () => {
    expect(mapQuantityToBoxesAvailable(5, "BOXES")).toBe(5);
  });

  it("does not map a fractional BOXES quantity", () => {
    expect(mapQuantityToBoxesAvailable(2.5, "BOXES")).toBeNull();
  });

  it("never fills boxesAvailable for STEMS", () => {
    expect(mapQuantityToBoxesAvailable(250, "STEMS")).toBeNull();
  });

  it("never fills boxesAvailable for KILOGRAMS", () => {
    expect(mapQuantityToBoxesAvailable(12.5, "KILOGRAMS")).toBeNull();
  });

  it("returns null when quantity is missing", () => {
    expect(mapQuantityToBoxesAvailable(null, "BOXES")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Section B: ParsedOfferLine mapping
// ---------------------------------------------------------------------------

describe("mapParsedOfferLineToCreateInput", () => {
  it("maps lengthCm to stemLengthCm", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ lengthCm: 60 }));
    expect(mapped.stemLengthCm).toBe(60);
  });

  it("maps quantity/unit through unchanged", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ quantity: "5", unit: "BOXES", stemsPerBox: 100 }));
    expect(mapped.quantity).toBe("5");
    expect(mapped.unit).toBe("BOXES");
  });

  it("fills boxesAvailable from a whole-number BOXES quantity when boxesAvailable wasn't already set", () => {
    const mapped = mapParsedOfferLineToCreateInput(
      baseLine({ quantity: "5", unit: "BOXES", stemsPerBox: 100, boxesAvailable: undefined }),
    );
    expect(mapped.boxesAvailable).toBe(5);
  });

  it("never derives boxesAvailable from a STEMS quantity", () => {
    const mapped = mapParsedOfferLineToCreateInput(
      baseLine({ quantity: "250", unit: "STEMS", boxesAvailable: undefined }),
    );
    expect(mapped.boxesAvailable).toBeUndefined();
  });

  it("keeps an already-set boxesAvailable rather than overriding it from quantity/unit", () => {
    const mapped = mapParsedOfferLineToCreateInput(
      baseLine({ boxesAvailable: 20, quantity: "5", unit: "BOXES", stemsPerBox: 100 }),
    );
    expect(mapped.boxesAvailable).toBe(20);
  });

  it("maps price to fobPricePerStem and sets priceUnit to PER_STEM", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ fobPricePerStem: "0.38" }));
    expect(mapped.fobPricePerStem).toBe("0.38");
    expect(mapped.priceUnit).toBe("PER_STEM");
  });

  it("maps parserWarnings to validationWarnings, not to notes", () => {
    const mapped = mapParsedOfferLineToCreateInput(
      baseLine({ parserWarnings: ["Lengte kon niet worden bepaald."], notes: undefined }),
    );
    expect(mapped.validationWarnings).toEqual(["Lengte kon niet worden bepaald."]);
    expect(mapped.notes).toBeUndefined();
  });

  it("still fills notes when the parser explicitly provided one (distinct from parserWarnings)", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ notes: "Handmatige opmerking" }));
    expect(mapped.notes).toBe("Handmatige opmerking");
  });

  it("builds a snapshot containing the original variety and length as separate values", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ varietyRaw: "Dallas", lengthCm: 60 }));
    const snapshot = mapped.extractedSnapshot as Record<string, unknown>;
    expect(snapshot.varietyRaw).toBe("Dallas");
    expect(snapshot.lengthCm).toBe(60);
  });

  it("calculates totalStems as part of the mapping", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ quantity: "5", unit: "BOXES", stemsPerBox: 100 }));
    expect(mapped.totalStems).toBe(500);
  });

  it("defaults matchStatus to UNMATCHED and packagingWeightProfileId to null", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine());
    expect(mapped.matchStatus).toBe("UNMATCHED");
    expect(mapped.packagingWeightProfileId).toBeNull();
  });

  it("never folds length into varietyRaw", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ varietyRaw: "Dallas", lengthCm: 60 }));
    expect(mapped.varietyRaw).toBe("Dallas");
    expect(mapped.varietyRaw).not.toMatch(/60/);
  });

  it("normalizes a generic rose productGroupRaw to the canonical 'Rosa Ec' on the persisted field", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ productGroupRaw: "Rose" }));
    expect(mapped.productGroupRaw).toBe("Rosa Ec");
  });

  it("preserves the ORIGINAL 'Rose' in extractedSnapshot even though the persisted field is canonicalized", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ productGroupRaw: "Rose" }));
    const snapshot = mapped.extractedSnapshot as Record<string, unknown>;
    expect(mapped.productGroupRaw).toBe("Rosa Ec");
    expect(snapshot.productGroupRaw).toBe("Rose");
  });

  it("leaves an unrelated productGroupRaw unchanged", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ productGroupRaw: "Hydrangea" }));
    expect(mapped.productGroupRaw).toBe("Hydrangea");
  });

  it("HB becomes QB on the persisted boxType", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ boxType: "HB" }));
    expect(mapped.boxType).toBe("QB");
  });

  it("lowercase/trimmed hb becomes QB", () => {
    expect(mapParsedOfferLineToCreateInput(baseLine({ boxType: "hb" })).boxType).toBe("QB");
    expect(mapParsedOfferLineToCreateInput(baseLine({ boxType: " HB " })).boxType).toBe("QB");
  });

  it("QB stays QB", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ boxType: "QB" }));
    expect(mapped.boxType).toBe("QB");
  });

  it("an HB line is retained (never dropped) with quantity/price/product/variety/length unchanged", () => {
    const mapped = mapParsedOfferLineToCreateInput(
      baseLine({
        rawText: "2hb Alert 40cm",
        boxType: "HB",
        varietyRaw: "Alert",
        productGroupRaw: "Rose",
        lengthCm: 40,
        quantity: "2",
        unit: "BOXES",
        fobPricePerStem: "0.38",
      }),
    );
    expect(mapped.boxType).toBe("QB");
    expect(mapped.varietyRaw).toBe("Alert");
    expect(mapped.productGroupRaw).toBe("Rosa Ec");
    expect(mapped.stemLengthCm).toBe(40);
    expect(mapped.quantity).toBe("2");
    expect(mapped.unit).toBe("BOXES");
    expect(mapped.fobPricePerStem).toBe("0.38");
  });

  it("preserves the original 'HB' in extractedSnapshot even though the persisted boxType is normalized to QB", () => {
    const mapped = mapParsedOfferLineToCreateInput(baseLine({ rawText: "2hb Alert 40cm", boxType: "HB" }));
    const snapshot = mapped.extractedSnapshot as Record<string, unknown>;
    expect(mapped.boxType).toBe("QB");
    expect(mapped.rawText).toBe("2hb Alert 40cm");
    expect(snapshot.boxType).toBe("HB");
  });

  it("an all-HB import still creates the expected number of lines, all normalized to QB", () => {
    const lines = [
      baseLine({ rawText: "2hb Alert 40cm", boxType: "HB" }),
      baseLine({ rawText: "1hb Freedom 60cm", boxType: "hb" }),
      baseLine({ rawText: "3hb Dallas 50cm", boxType: " HB " }),
    ];
    const mapped = lines.map(mapParsedOfferLineToCreateInput);
    expect(mapped).toHaveLength(3);
    expect(mapped.every((m) => m.boxType === "QB")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section E: snapshot
// ---------------------------------------------------------------------------

describe("buildExtractedSnapshot", () => {
  it("keeps parserWarnings present in the snapshot", () => {
    const snapshot = buildExtractedSnapshot(baseLine({ parserWarnings: ["een waarschuwing"] })) as Record<
      string,
      unknown
    >;
    expect(snapshot.parserWarnings).toEqual(["een waarschuwing"]);
  });

  it("keeps missing values explicitly null rather than omitting the key", () => {
    const snapshot = buildExtractedSnapshot(baseLine({ lengthCm: undefined, quantity: undefined })) as Record<
      string,
      unknown
    >;
    expect(snapshot).toHaveProperty("lengthCm", null);
    expect(snapshot).toHaveProperty("quantity", null);
  });

  it("contains only plain JSON-serializable values (round-trips through JSON.stringify/parse unchanged)", () => {
    const line = baseLine({ parserWarnings: ["w1", "w2"] });
    const snapshot = buildExtractedSnapshot(line);
    const roundTripped = JSON.parse(JSON.stringify(snapshot));
    expect(roundTripped).toEqual(snapshot);
  });

  it("mutating the original line's parserWarnings array afterwards does not change the snapshot", () => {
    const warnings = ["original warning"];
    const line = baseLine({ parserWarnings: warnings });
    const snapshot = buildExtractedSnapshot(line) as Record<string, unknown>;

    warnings.push("mutated after the fact");

    expect(snapshot.parserWarnings).toEqual(["original warning"]);
  });
});

describe("normalizeValidationMessages / readValidationMessages", () => {
  it("returns null for an empty array", () => {
    expect(normalizeValidationMessages([])).toBeNull();
  });

  it("returns null for undefined/null input", () => {
    expect(normalizeValidationMessages(undefined)).toBeNull();
    expect(normalizeValidationMessages(null)).toBeNull();
  });

  it("trims and drops blank entries, returning null if nothing remains", () => {
    expect(normalizeValidationMessages(["  ", ""])).toBeNull();
    expect(normalizeValidationMessages(["  a real warning  "])).toEqual(["a real warning"]);
  });

  it("readValidationMessages safely reads back a plain string array", () => {
    expect(readValidationMessages(["a", "b"])).toEqual(["a", "b"]);
  });

  it("readValidationMessages returns an empty array for null/non-array JSON values", () => {
    expect(readValidationMessages(null)).toEqual([]);
    expect(readValidationMessages({ not: "an array" })).toEqual([]);
    expect(readValidationMessages("just a string")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Section 26.F: validation merge (parser warnings + current warnings)
// ---------------------------------------------------------------------------

describe("mergeValidationWarnings", () => {
  it("keeps the original parser warnings present alongside current ones", () => {
    const merged = mergeValidationWarnings(["Lengte kon niet worden bepaald."], ["Valuta ontbreekt."]);
    expect(merged).toEqual(["Lengte kon niet worden bepaald.", "Valuta ontbreekt."]);
  });

  it("deduplicates an exact-string warning that appears in both sources", () => {
    const merged = mergeValidationWarnings(["Valuta ontbreekt."], ["Valuta ontbreekt.", "Nieuwe waarschuwing."]);
    expect(merged).toEqual(["Valuta ontbreekt.", "Nieuwe waarschuwing."]);
  });

  it("never drops an original parser warning, even when the current recomputation no longer reproduces it", () => {
    // Section 18: parserWarnings must never be lost - even once a gap is
    // fixed (so the CURRENT validation no longer flags it), the original
    // parser warning about it stays visible for audit purposes.
    const merged = mergeValidationWarnings(["Lengte kon niet worden bepaald.", "Valuta ontbreekt."], ["Valuta ontbreekt."]);
    expect(merged).toEqual(["Lengte kon niet worden bepaald.", "Valuta ontbreekt."]);
  });

  it("returns null when both sources are empty", () => {
    expect(mergeValidationWarnings([], [])).toBeNull();
    expect(mergeValidationWarnings(null, undefined)).toBeNull();
  });

  it("handles one side being empty", () => {
    expect(mergeValidationWarnings(["a"], [])).toEqual(["a"]);
    expect(mergeValidationWarnings([], ["b"])).toEqual(["b"]);
  });
});
