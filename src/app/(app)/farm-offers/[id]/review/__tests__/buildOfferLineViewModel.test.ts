import { describe, expect, it, vi } from "vitest";
import type { FarmOfferLineForViewModel } from "../buildOfferLineViewModel";
import type { AssortmentCandidate } from "@/lib/import/matching/assortmentMatch";

// `buildOfferLineViewModel.ts` imports `matchFarmOfferLine.ts`, which imports
// "server-only" (harmless in the real app - Next aliases it away in server
// bundles) - needs a no-op mock here so this plain-Node Vitest run can import
// it at all.
vi.mock("server-only", () => ({}));

const { buildOfferLineViewModel } = await import("../buildOfferLineViewModel");

const FARM = "farm-agrinag";

function candidate(overrides: Partial<AssortmentCandidate> = {}): AssortmentCandidate {
  return {
    packagingWeightProfileId: "profile-1",
    farmId: FARM,
    productVariantId: "variant-1",
    productId: "product-1",
    productName: "Rose",
    variety: "Dallas",
    stemLength: "60 cm",
    boxType: "QB",
    stemsPerBox: 100,
    boxWeight: "8.000",
    ...overrides,
  };
}

function baseLine(overrides: Partial<FarmOfferLineForViewModel> = {}): FarmOfferLineForViewModel {
  return {
    id: "line-1",
    rawText: "Dallas 60cm 0.38",
    productGroupRaw: "Rose",
    productNameRaw: null,
    varietyRaw: "Dallas",
    colorRaw: null,
    gradeRaw: null,
    treatmentRaw: "normal",
    boxType: "QB",
    boxesAvailable: 10,
    stemsPerBox: 100,
    stemLengthCm: 60,
    quantity: null,
    unit: null,
    totalStems: null,
    fobPricePerStem: "0.38",
    currency: "USD",
    weightPerBoxKg: "8.000",
    notes: null,
    matchStatus: "AUTO_MATCHED",
    packagingWeightProfileId: "profile-1",
    extractedSnapshot: { parserWarnings: [] },
    ...overrides,
  };
}

describe("buildOfferLineViewModel - section 26.A review data", () => {
  it("AUTO_MATCHED: shows the correct matched profile", () => {
    const vm = buildOfferLineViewModel(baseLine({ matchStatus: "AUTO_MATCHED" }), FARM, [candidate()]);
    expect(vm.matchStatus).toBe("AUTO_MATCHED");
    expect(vm.matchedOption?.packagingWeightProfileId).toBe("profile-1");
    expect(vm.matchedOption?.productName).toBe("Rose");
  });

  it("DERIVED: shows the derived product's matched profile", () => {
    const line = baseLine({ matchStatus: "DERIVED", productGroupRaw: null, packagingWeightProfileId: "profile-1" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate()]);
    expect(vm.matchStatus).toBe("DERIVED");
    expect(vm.matchedOption?.packagingWeightProfileId).toBe("profile-1");
  });

  it("AMBIGUOUS: exposes all candidate options for the picker", () => {
    const candidates = [
      candidate({ packagingWeightProfileId: "p-qb", boxType: "QB", stemsPerBox: 100 }),
      candidate({ packagingWeightProfileId: "p-hb", boxType: "HB", stemsPerBox: 200 }),
    ];
    const line = baseLine({ matchStatus: "AMBIGUOUS", packagingWeightProfileId: null });
    const vm = buildOfferLineViewModel(line, FARM, candidates);
    expect(vm.matchStatus).toBe("AMBIGUOUS");
    expect(vm.matchOptions).toHaveLength(2);
    expect(vm.matchedOption).toBeNull();
  });

  it("UNMATCHED: no matched option, no candidates", () => {
    const line = baseLine({ matchStatus: "UNMATCHED", packagingWeightProfileId: null, varietyRaw: "Nonexistent" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate()]);
    expect(vm.matchStatus).toBe("UNMATCHED");
    expect(vm.matchedOption).toBeNull();
  });

  it("USER_LINKED: the persisted link is respected as-is, never silently re-evaluated by a page render", () => {
    // Deliberately construct a case where a fresh auto-match would resolve
    // differently (a second, better-fitting candidate exists) - the
    // USER_LINKED line must still show exactly the profile it was linked to.
    const linkedProfile = candidate({ packagingWeightProfileId: "user-chosen", boxType: "HB", stemsPerBox: 200 });
    const otherProfile = candidate({ packagingWeightProfileId: "engine-would-pick", boxType: "QB", stemsPerBox: 100 });
    const line = baseLine({ matchStatus: "USER_LINKED", packagingWeightProfileId: "user-chosen" });

    const vm = buildOfferLineViewModel(line, FARM, [linkedProfile, otherProfile]);

    expect(vm.matchStatus).toBe("USER_LINKED");
    expect(vm.matchedOption?.packagingWeightProfileId).toBe("user-chosen");
    // No live recomputation happened for a USER_LINKED line - matchOptions stays empty.
    expect(vm.matchOptions).toEqual([]);
  });

  it("computes validation warnings/errors fresh, merged with the original parserWarnings from the snapshot", () => {
    const line = baseLine({
      fobPricePerStem: null,
      extractedSnapshot: { parserWarnings: ["Lengte kon niet worden bepaald."] },
    });
    const vm = buildOfferLineViewModel(line, FARM, [candidate()]);
    expect(vm.validationErrors.some((e) => /prijs/i.test(e))).toBe(true);
    expect(vm.validationWarnings).toContain("Lengte kon niet worden bepaald.");
  });
});

// ---------------------------------------------------------------------------
// Section 33: review UI - "Save as supplier mapping" visibility + "Matched
// via supplier mapping" hint, driven entirely by view-model fields (no
// component-render test harness in this project - see the row component's
// own conditional rendering of `canSaveAsSupplierMapping`/
// `matchedViaSupplierMapping`).
// ---------------------------------------------------------------------------

describe("buildOfferLineViewModel - section 33 supplier-mapping review UI fields", () => {
  it("canSaveAsSupplierMapping is true for a matched line with rawText and a linked profile", () => {
    const line = baseLine({ matchStatus: "AUTO_MATCHED", rawText: "Dallas 60cm 0.38" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate()]);
    expect(vm.canSaveAsSupplierMapping).toBe(true);
  });

  it("canSaveAsSupplierMapping is false without a linked profile", () => {
    const line = baseLine({ matchStatus: "UNMATCHED", packagingWeightProfileId: null, varietyRaw: "Nonexistent" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate()]);
    expect(vm.canSaveAsSupplierMapping).toBe(false);
  });

  it("canSaveAsSupplierMapping is false without rawText", () => {
    const line = baseLine({ matchStatus: "AUTO_MATCHED", rawText: "" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate()]);
    expect(vm.canSaveAsSupplierMapping).toBe(false);
  });

  it("canSaveAsSupplierMapping is false for a degraded-AI placeholder rawText (no save action shown)", () => {
    const line = baseLine({ matchStatus: "AUTO_MATCHED", rawText: "(kon oorspronkelijke brontekst niet achterhalen)" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate()]);
    expect(vm.canSaveAsSupplierMapping).toBe(false);
  });

  it("canSaveAsSupplierMapping is false for a manually-added-line placeholder rawText", () => {
    const line = baseLine({ matchStatus: "AUTO_MATCHED", rawText: "(handmatig ingevoerd)" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate()]);
    expect(vm.canSaveAsSupplierMapping).toBe(false);
  });

  it("matchedViaSupplierMapping is true when a USER_LINKED line's profile matches the mapping for its source", () => {
    const line = baseLine({ matchStatus: "USER_LINKED", packagingWeightProfileId: "profile-1" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate({ packagingWeightProfileId: "profile-1" })], "profile-1");
    expect(vm.matchedViaSupplierMapping).toBe(true);
  });

  it("matchedViaSupplierMapping is false when no mapping is passed (plain manual choice)", () => {
    const line = baseLine({ matchStatus: "USER_LINKED", packagingWeightProfileId: "profile-1" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate({ packagingWeightProfileId: "profile-1" })], null);
    expect(vm.matchedViaSupplierMapping).toBe(false);
  });

  it("matchedViaSupplierMapping is false for AUTO_MATCHED/DERIVED - the hint only applies to USER_LINKED", () => {
    const line = baseLine({ matchStatus: "AUTO_MATCHED", packagingWeightProfileId: "profile-1" });
    const vm = buildOfferLineViewModel(line, FARM, [candidate({ packagingWeightProfileId: "profile-1" })], "profile-1");
    expect(vm.matchedViaSupplierMapping).toBe(false);
  });
});
