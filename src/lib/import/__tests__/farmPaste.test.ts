import { describe, it, expect } from "vitest";
import { isFarmHeaderRow, parseFarmRow } from "@/lib/import/farmPaste";

describe("isFarmHeaderRow", () => {
  it("detects a Land/Naam header", () => {
    expect(isFarmHeaderRow("Land\tNaam")).toBe(true);
    expect(isFarmHeaderRow("Land\tLeverancier")).toBe(true);
  });
  it("does not flag a data row", () => {
    expect(isFarmHeaderRow("Ecuador\tRosaprima")).toBe(false);
  });
});

describe("parseFarmRow", () => {
  it("parses Land<TAB>Naam", () => {
    expect(parseFarmRow("Ecuador\tRosaprima", "")).toEqual({ name: "Rosaprima", country: "Ecuador" });
  });

  it("trims a trailing space in the name", () => {
    expect(parseFarmRow("Ecuador\tDali Roses ", "")).toEqual({ name: "Dali Roses", country: "Ecuador" });
  });

  it("keeps a name that itself contains a tab-joined remainder", () => {
    // Defensive: extra tab columns are folded back into the name.
    expect(parseFarmRow("Ecuador\tKiara / El Chaupi", "")).toEqual({ name: "Kiara / El Chaupi", country: "Ecuador" });
  });

  it("uses the default country for a single-column line", () => {
    expect(parseFarmRow("Rosaprima", "Ecuador")).toEqual({ name: "Rosaprima", country: "Ecuador" });
  });

  it("prefers the row's own country over the default", () => {
    expect(parseFarmRow("Colombia\tLa Gaitana Farms", "Ecuador")).toEqual({
      name: "La Gaitana Farms",
      country: "Colombia",
    });
  });

  it("returns null when a single column has no default country", () => {
    expect(parseFarmRow("Rosaprima", "")).toBeNull();
  });

  it("returns null for an empty name", () => {
    expect(parseFarmRow("Ecuador\t", "")).toBeNull();
  });
});
