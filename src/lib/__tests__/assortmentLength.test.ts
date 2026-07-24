import { describe, expect, it } from "vitest";
import { normalizeAssortmentStemLength } from "../assortmentLength";

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
