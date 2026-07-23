import { describe, expect, it } from "vitest";
import { normalizeSupplierMappingSource } from "../normalize";

describe("normalizeSupplierMappingSource - section 26", () => {
  it("collapses leading/trailing/extra whitespace to the same key", () => {
    expect(normalizeSupplierMappingSource("  DALLAS   60CM   0.38  ")).toBe(
      normalizeSupplierMappingSource("Dallas 60cm 0.38"),
    );
  });

  it("is case-insensitive", () => {
    expect(normalizeSupplierMappingSource("DALLAS 60CM")).toBe(normalizeSupplierMappingSource("dallas 60cm"));
  });

  it("normalizes accented characters", () => {
    expect(normalizeSupplierMappingSource("Freedom Ecuadór")).toBe(normalizeSupplierMappingSource("Freedom Ecuador"));
  });

  it("treats tabs and newlines the same as a single space", () => {
    expect(normalizeSupplierMappingSource("Dallas\t60cm\n0.38")).toBe(normalizeSupplierMappingSource("Dallas 60cm 0.38"));
  });

  it("normalizes Windows (CRLF) and old-Mac (CR) line endings the same as \\n", () => {
    expect(normalizeSupplierMappingSource("Dallas\r\n60cm")).toBe(normalizeSupplierMappingSource("Dallas\n60cm"));
    expect(normalizeSupplierMappingSource("Dallas\r60cm")).toBe(normalizeSupplierMappingSource("Dallas\n60cm"));
  });

  it("60cm and 70cm remain different keys", () => {
    expect(normalizeSupplierMappingSource("Dallas 60cm 0.38")).not.toBe(normalizeSupplierMappingSource("Dallas 70cm 0.38"));
  });

  it("0.38 and 0.40 remain different keys", () => {
    expect(normalizeSupplierMappingSource("Dallas 60cm 0.38")).not.toBe(normalizeSupplierMappingSource("Dallas 60cm 0.40"));
  });

  it("keeps the box code as part of the key", () => {
    const withBox = normalizeSupplierMappingSource("Dallas 60cm 20QBx100");
    const withoutBox = normalizeSupplierMappingSource("Dallas 60cm");
    expect(withBox).not.toBe(withoutBox);
    expect(withBox).toContain("qbx100");
  });

  it("never strips the decimal point itself", () => {
    expect(normalizeSupplierMappingSource("0.38")).toBe("0.38");
  });
});
