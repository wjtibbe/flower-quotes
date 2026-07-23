import { describe, expect, it } from "vitest";
import { isIgnoredBoxType, normalizeBoxTypeForImport } from "../offerLineFilters";

describe("isIgnoredBoxType", () => {
  it("is case-insensitive and trimmed for HB", () => {
    expect(isIgnoredBoxType("HB")).toBe(true);
    expect(isIgnoredBoxType("hb")).toBe(true);
    expect(isIgnoredBoxType(" HB ")).toBe(true);
    expect(isIgnoredBoxType(" hB ")).toBe(true);
  });

  it("is false for QB and other box types", () => {
    expect(isIgnoredBoxType("QB")).toBe(false);
    expect(isIgnoredBoxType("FB")).toBe(false);
  });

  it("is false for null/undefined/empty", () => {
    expect(isIgnoredBoxType(null)).toBe(false);
    expect(isIgnoredBoxType(undefined)).toBe(false);
    expect(isIgnoredBoxType("")).toBe(false);
  });
});

describe("normalizeBoxTypeForImport", () => {
  it("HB -> QB", () => {
    expect(normalizeBoxTypeForImport("HB")).toBe("QB");
  });

  it("lowercase hb -> QB", () => {
    expect(normalizeBoxTypeForImport("hb")).toBe("QB");
  });

  it(" HB  (surrounding whitespace) -> QB", () => {
    expect(normalizeBoxTypeForImport(" HB ")).toBe("QB");
  });

  it("QB stays QB", () => {
    expect(normalizeBoxTypeForImport("QB")).toBe("QB");
  });

  it("other box types stay unchanged", () => {
    expect(normalizeBoxTypeForImport("FB")).toBe("FB");
  });

  it("null/undefined boxType stays unchanged", () => {
    expect(normalizeBoxTypeForImport(null)).toBeNull();
    expect(normalizeBoxTypeForImport(undefined)).toBeUndefined();
  });
});
