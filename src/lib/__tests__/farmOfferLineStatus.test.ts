import { describe, expect, it } from "vitest";
import { lineStatusBadgeClass, resolveLineStatusLabel } from "../farmOfferLineStatus";

describe("resolveLineStatusLabel", () => {
  // A: a reviewed line no longer displays stale LOW AI confidence as final
  // reliability - a REVIEWED offer's lines always resolve to "Confirmed",
  // regardless of matchStatus (finalization already validated them all).
  it("A: a REVIEWED offer's line is Confirmed regardless of matchStatus", () => {
    for (const matchStatus of ["AUTO_MATCHED", "DERIVED", "USER_LINKED", "AMBIGUOUS", "UNMATCHED", null]) {
      expect(resolveLineStatusLabel({ offerStatus: "REVIEWED", matchStatus })).toBe("Confirmed");
    }
  });

  // B: final resolution label correctly represents auto matched / manually
  // linked / supplier mapping, on a still-DRAFT offer where "Confirmed"
  // would be misleading.
  it("B: AUTO_MATCHED on a DRAFT offer resolves to Auto matched", () => {
    expect(resolveLineStatusLabel({ offerStatus: "DRAFT", matchStatus: "AUTO_MATCHED" })).toBe("Auto matched");
  });

  it("B: DERIVED on a DRAFT offer also resolves to Auto matched", () => {
    expect(resolveLineStatusLabel({ offerStatus: "DRAFT", matchStatus: "DERIVED" })).toBe("Auto matched");
  });

  it("B: USER_LINKED without a supplier-mapping match resolves to Manually matched", () => {
    expect(
      resolveLineStatusLabel({ offerStatus: "DRAFT", matchStatus: "USER_LINKED", hasSupplierMapping: false }),
    ).toBe("Manually matched");
  });

  it("B: USER_LINKED WITH a matching saved SupplierLineMapping resolves to Supplier mapping (distinguishable)", () => {
    expect(
      resolveLineStatusLabel({ offerStatus: "DRAFT", matchStatus: "USER_LINKED", hasSupplierMapping: true }),
    ).toBe("Supplier mapping");
  });

  it("USER_LINKED with hasSupplierMapping omitted defaults to Manually matched (never guesses supplier mapping)", () => {
    expect(resolveLineStatusLabel({ offerStatus: "DRAFT", matchStatus: "USER_LINKED" })).toBe("Manually matched");
  });

  it("AMBIGUOUS/UNMATCHED on a DRAFT offer resolve to Not linked", () => {
    expect(resolveLineStatusLabel({ offerStatus: "DRAFT", matchStatus: "AMBIGUOUS" })).toBe("Not linked");
    expect(resolveLineStatusLabel({ offerStatus: "DRAFT", matchStatus: "UNMATCHED" })).toBe("Not linked");
    expect(resolveLineStatusLabel({ offerStatus: "DRAFT", matchStatus: null })).toBe("Not linked");
  });
});

describe("lineStatusBadgeClass", () => {
  it("maps every label to an existing badge class (no new CSS needed)", () => {
    expect(lineStatusBadgeClass("Confirmed")).toBe("badge-auto-matched");
    expect(lineStatusBadgeClass("Auto matched")).toBe("badge-auto-matched");
    expect(lineStatusBadgeClass("Supplier mapping")).toBe("badge-user-linked");
    expect(lineStatusBadgeClass("Manually matched")).toBe("badge-user-linked");
    expect(lineStatusBadgeClass("Not linked")).toBe("badge-unmatched");
  });
});
