import { describe, expect, it } from "vitest";
import {
  applyLengthRangeExpansion,
  hasLengthRange,
  parseLengthSpec,
  parsePriceTierLine,
  parseSharedPriceTable,
  type PriceTier,
} from "../rangeExpansion";
import type { ParsedOfferLine } from "../types";

// The confirmed Mystic-style shared price table used throughout the spec.
const MYSTIC_TABLE_TEXT = `40 cm 0.16
50 cm 0.18
60 cm 0.22
70 cm 0.28`;

const MYSTIC_TABLE: PriceTier[] = [
  { lengthCm: 40, fobPricePerStem: "0.16" },
  { lengthCm: 50, fobPricePerStem: "0.18" },
  { lengthCm: 60, fobPricePerStem: "0.22" },
  { lengthCm: 70, fobPricePerStem: "0.28" },
];

function line(overrides: Partial<ParsedOfferLine> = {}): ParsedOfferLine {
  return {
    rawText: "2hb Alert 40-60cm",
    varietyRaw: "Alert",
    boxType: "HB",
    quantity: "2",
    unit: "BOXES",
    lengthRaw: "40-60cm",
    confidence: "medium",
    fieldConfidence: {},
    needsReview: true,
    parserWarnings: [],
    ...overrides,
  };
}

describe("parsePriceTierLine", () => {
  it("parses '40 cm 0.16' into a tier", () => {
    expect(parsePriceTierLine("40 cm 0.16")).toEqual({ lengthCm: 40, fobPricePerStem: "0.16" });
  });

  it("parses compact '40cm 0.16' and a trailing currency", () => {
    expect(parsePriceTierLine("40cm 0.16")).toEqual({ lengthCm: 40, fobPricePerStem: "0.16" });
    expect(parsePriceTierLine("70 cm 0.28 USD")).toEqual({ lengthCm: 70, fobPricePerStem: "0.28" });
  });

  it("normalizes a comma decimal", () => {
    expect(parsePriceTierLine("50 cm 0,18")).toEqual({ lengthCm: 50, fobPricePerStem: "0.18" });
  });

  it("rejects an ordinary product row (not a price tier)", () => {
    expect(parsePriceTierLine("2hb Alert 40-60cm")).toBeNull();
    expect(parsePriceTierLine("Dallas 60cm 0.38 Freedom")).toBeNull();
    expect(parsePriceTierLine("ROSES")).toBeNull();
    expect(parsePriceTierLine("")).toBeNull();
  });
});

describe("parseSharedPriceTable", () => {
  it("A: extracts every tier, sorted ascending, from a document with surrounding text", () => {
    const text = `Dear friends, our offer this week:\n\nROSES\n2hb Alert 40-60cm\n\nPrices per stem:\n${MYSTIC_TABLE_TEXT}\nBest regards`;
    expect(parseSharedPriceTable(text)).toEqual(MYSTIC_TABLE);
  });

  it("returns an empty array when there is no price table", () => {
    expect(parseSharedPriceTable("Dallas 60cm 0.38\nFreedom 70cm 0.42")).toEqual([]);
  });

  it("de-duplicates by length (last occurrence wins)", () => {
    expect(parseSharedPriceTable("40 cm 0.16\n40 cm 0.19")).toEqual([{ lengthCm: 40, fobPricePerStem: "0.19" }]);
  });
});

describe("parseLengthSpec", () => {
  it("recognizes a single length", () => {
    expect(parseLengthSpec("80cm")).toEqual({ kind: "single", cm: 80 });
    expect(parseLengthSpec("60 cm")).toEqual({ kind: "single", cm: 60 });
  });

  it("recognizes a range and normalizes min/max order", () => {
    expect(parseLengthSpec("40-60cm")).toEqual({ kind: "range", min: 40, max: 60 });
    expect(parseLengthSpec("70-80 cm")).toEqual({ kind: "range", min: 70, max: 80 });
    expect(parseLengthSpec("60-40")).toEqual({ kind: "range", min: 40, max: 60 });
  });

  it("treats equal endpoints as a single length, not a range", () => {
    expect(parseLengthSpec("40-40")).toEqual({ kind: "single", cm: 40 });
  });

  it("returns none for empty/unparseable input", () => {
    expect(parseLengthSpec(undefined)).toEqual({ kind: "none" });
    expect(parseLengthSpec("")).toEqual({ kind: "none" });
    expect(parseLengthSpec("assorted")).toEqual({ kind: "none" });
  });
});

describe("hasLengthRange (mapping-safety guard)", () => {
  it("is true for a ranged supplier row", () => {
    expect(hasLengthRange("2hb Alert 40-60cm")).toBe(true);
    expect(hasLengthRange("1hb Hearts 70-80cm")).toBe(true);
    expect(hasLengthRange("Alert 40-60")).toBe(true);
  });

  it("is false for a single-length or length-less row", () => {
    expect(hasLengthRange("1qb be sweet 80cm")).toBe(false);
    expect(hasLengthRange("Dallas 60cm 0.38")).toBe(false);
    expect(hasLengthRange("Freedom assorted")).toBe(false);
    expect(hasLengthRange("")).toBe(false);
    expect(hasLengthRange(null)).toBe(false);
  });
});

describe("applyLengthRangeExpansion - the confirmed business rule", () => {
  it("25.A: expands '2hb Alert 40-60cm' into 3 lines (40/50/60) with repeated qty and per-length prices", () => {
    const out = applyLengthRangeExpansion([line()], MYSTIC_TABLE);
    expect(out).toHaveLength(3);
    expect(out.map((l) => l.lengthCm)).toEqual([40, 50, 60]);
    expect(out.map((l) => l.fobPricePerStem)).toEqual(["0.16", "0.18", "0.22"]);
    // Quantity + packaging repeat unchanged (never divided across the range).
    for (const l of out) {
      expect(l.quantity).toBe("2");
      expect(l.unit).toBe("BOXES");
      expect(l.boxType).toBe("HB");
      expect(l.varietyRaw).toBe("Alert");
    }
  });

  it("25.B: preserves the ORIGINAL supplier row as rawText on every expanded line", () => {
    const out = applyLengthRangeExpansion([line()], MYSTIC_TABLE);
    expect(out).toHaveLength(3);
    for (const l of out) expect(l.rawText).toBe("2hb Alert 40-60cm");
  });

  it("25.C: a single length inside the table becomes exactly one priced line", () => {
    const out = applyLengthRangeExpansion(
      [line({ rawText: "1qb be sweet 60cm", varietyRaw: "be sweet", boxType: "QB", quantity: "1", lengthRaw: "60cm" })],
      MYSTIC_TABLE,
    );
    expect(out).toHaveLength(1);
    expect(out[0].lengthCm).toBe(60);
    expect(out[0].fobPricePerStem).toBe("0.22");
  });

  it("25.D: a single length NOT in the table stays one line with a null price + warning (no extrapolation)", () => {
    const out = applyLengthRangeExpansion(
      [line({ rawText: "1qb be sweet 80cm", varietyRaw: "be sweet", boxType: "QB", quantity: "1", lengthRaw: "80cm" })],
      MYSTIC_TABLE,
    );
    expect(out).toHaveLength(1);
    expect(out[0].lengthCm).toBe(80);
    expect(out[0].fobPricePerStem).toBeUndefined();
    expect(out[0].needsReview).toBe(true);
    expect(out[0].parserWarnings.some((w) => /80cm/.test(w) && /prijstabel/.test(w))).toBe(true);
  });

  it("25.E: a range whose upper endpoint has no tier expands to the covered tier(s) + a gap warning", () => {
    const out = applyLengthRangeExpansion(
      [line({ rawText: "1hb Hearts 70-80cm", varietyRaw: "Hearts", boxType: "HB", quantity: "1", lengthRaw: "70-80cm" })],
      MYSTIC_TABLE,
    );
    // Only 70 is a tier inside [70, 80]; 80 has none.
    expect(out).toHaveLength(1);
    expect(out[0].lengthCm).toBe(70);
    expect(out[0].fobPricePerStem).toBe("0.28");
    expect(out[0].parserWarnings.some((w) => /80cm/.test(w))).toBe(true);
  });

  it("25.F: is a no-op when there is no shared price table", () => {
    const input = [line()];
    const out = applyLengthRangeExpansion(input, []);
    expect(out).toBe(input); // same reference - untouched
  });

  it("25.G: a range covering no tier at all yields one line with null price + warning", () => {
    const out = applyLengthRangeExpansion(
      [line({ rawText: "2hb Big 90-120cm", lengthRaw: "90-120cm" })],
      MYSTIC_TABLE,
    );
    expect(out).toHaveLength(1);
    expect(out[0].lengthCm).toBeUndefined();
    expect(out[0].fobPricePerStem).toBeUndefined();
    expect(out[0].parserWarnings.some((w) => /buiten de gedeelde prijstabel/.test(w))).toBe(true);
  });

  it("25.H: leaves a length-less line untouched even when a table exists", () => {
    const input = line({ rawText: "Freedom assorted", lengthRaw: undefined, lengthCm: undefined });
    const out = applyLengthRangeExpansion([input], MYSTIC_TABLE);
    expect(out).toHaveLength(1);
    expect(out[0].lengthCm).toBeUndefined();
  });

  it("25.I: keeps a single-length row's OWN explicit price rather than overwriting it from the table", () => {
    const out = applyLengthRangeExpansion(
      [line({ rawText: "Dallas 60cm 0.38", lengthRaw: "60cm", fobPricePerStem: "0.38" })],
      MYSTIC_TABLE,
    );
    expect(out).toHaveLength(1);
    expect(out[0].fobPricePerStem).toBe("0.38");
  });
});
