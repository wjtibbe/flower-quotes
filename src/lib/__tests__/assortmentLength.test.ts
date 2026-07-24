import { describe, expect, it } from "vitest";
import { detectTrailingLengthHint, normalizeAssortmentStemLength } from "../assortmentLength";

describe("normalizeAssortmentStemLength", () => {
  it('1: normalizes "50" to numeric "50"', () => {
    expect(normalizeAssortmentStemLength("50")).toEqual({ ok: true, value: "50" });
  });

  it('2: normalizes "50cm" to "50"', () => {
    expect(normalizeAssortmentStemLength("50cm")).toEqual({ ok: true, value: "50" });
  });

  it('3: normalizes "50 cm" to "50"', () => {
    expect(normalizeAssortmentStemLength("50 cm")).toEqual({ ok: true, value: "50" });
  });

  it('4: normalizes "50 CM" to "50"', () => {
    expect(normalizeAssortmentStemLength("50 CM")).toEqual({ ok: true, value: "50" });
  });

  it("5: rejects non-numeric text", () => {
    expect(normalizeAssortmentStemLength("abc").ok).toBe(false);
  });

  it("6: rejects a decimal value (integer-only)", () => {
    expect(normalizeAssortmentStemLength("50.5").ok).toBe(false);
  });

  it("7: rejects a range as one profile length", () => {
    expect(normalizeAssortmentStemLength("40-60").ok).toBe(false);
  });

  it("rejects a slash-separated list as one profile length", () => {
    expect(normalizeAssortmentStemLength("40/50/60").ok).toBe(false);
  });

  it("rejects an empty/blank value", () => {
    expect(normalizeAssortmentStemLength("").ok).toBe(false);
    expect(normalizeAssortmentStemLength("   ").ok).toBe(false);
  });

  it("rejects zero and negative values", () => {
    expect(normalizeAssortmentStemLength("0").ok).toBe(false);
    expect(normalizeAssortmentStemLength("-5").ok).toBe(false);
  });

  it("drops a leading zero when otherwise valid", () => {
    expect(normalizeAssortmentStemLength("060")).toEqual({ ok: true, value: "60" });
  });

  it("does not treat a comma-decimal as valid (integer-only, no locale guessing)", () => {
    expect(normalizeAssortmentStemLength("50,5").ok).toBe(false);
  });
});

describe("detectTrailingLengthHint", () => {
  it('12: extracts "18" as a hint from "Shiny Copper Premium 18cm"', () => {
    expect(detectTrailingLengthHint("Shiny Copper Premium 18cm")).toBe("18");
  });

  it("extracts a trailing length with a space before cm", () => {
    expect(detectTrailingLengthHint("Shiny Copper Premium 18 cm")).toBe("18");
  });

  it("is case-insensitive for the cm suffix", () => {
    expect(detectTrailingLengthHint("Shiny Copper Premium 18CM")).toBe("18");
  });

  it("returns null when there is no trailing length pattern", () => {
    expect(detectTrailingLengthHint("Freedom")).toBeNull();
  });

  it("returns null for null/undefined/empty input", () => {
    expect(detectTrailingLengthHint(null)).toBeNull();
    expect(detectTrailingLengthHint(undefined)).toBeNull();
    expect(detectTrailingLengthHint("")).toBeNull();
  });

  it("does not match a number that isn't at the very end (ambiguous placement)", () => {
    expect(detectTrailingLengthHint("18cm Deluxe Edition")).toBeNull();
  });

  it("does not match a number with no cm suffix at all", () => {
    expect(detectTrailingLengthHint("Freedom 18")).toBeNull();
  });

  it("never mutates or returns the variety text itself - only the numeric hint", () => {
    const hint = detectTrailingLengthHint("Shiny Copper Premium 18cm");
    expect(hint).not.toContain("Shiny");
    expect(hint).toBe("18");
  });
});
