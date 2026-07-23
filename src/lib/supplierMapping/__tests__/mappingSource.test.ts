import { describe, expect, it } from "vitest";
import { isValidSupplierMappingSource } from "../mappingSource";
import { DEGRADED_LINE_RAWTEXT_PLACEHOLDER, MANUAL_LINE_RAWTEXT_PLACEHOLDER } from "@/lib/import/types";

describe("isValidSupplierMappingSource - placeholder guard", () => {
  it("real supplier rawText is allowed", () => {
    expect(isValidSupplierMappingSource("Dallas 60cm 0.38")).toBe(true);
  });

  it("null/undefined is blocked", () => {
    expect(isValidSupplierMappingSource(null)).toBe(false);
    expect(isValidSupplierMappingSource(undefined)).toBe(false);
  });

  it("empty rawText is blocked", () => {
    expect(isValidSupplierMappingSource("")).toBe(false);
  });

  it("whitespace-only rawText is blocked", () => {
    expect(isValidSupplierMappingSource("   ")).toBe(false);
    expect(isValidSupplierMappingSource("\t\n ")).toBe(false);
  });

  it('the audited degraded-AI placeholder "(kon oorspronkelijke brontekst niet achterhalen)" is blocked', () => {
    expect(isValidSupplierMappingSource("(kon oorspronkelijke brontekst niet achterhalen)")).toBe(false);
    expect(isValidSupplierMappingSource(DEGRADED_LINE_RAWTEXT_PLACEHOLDER)).toBe(false);
  });

  it("the manually-added-line placeholder is blocked", () => {
    expect(isValidSupplierMappingSource(MANUAL_LINE_RAWTEXT_PLACEHOLDER)).toBe(false);
    expect(isValidSupplierMappingSource("(handmatig ingevoerd)")).toBe(false);
  });

  it("a placeholder surrounded by whitespace is still blocked (trimmed before comparison)", () => {
    expect(isValidSupplierMappingSource("  (handmatig ingevoerd)  ")).toBe(false);
  });
});
