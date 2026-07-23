import { describe, expect, it } from "vitest";
import {
  isPackagingProfileValidForSupplier,
  validateOfferLineForFinalization,
  validatePackagingWeightProfileSelection,
} from "../offerLineValidation";
import type { FinalizationCheckInput } from "../offerLineValidation";

function validLine(overrides: Partial<FinalizationCheckInput> = {}): FinalizationCheckInput {
  return {
    packagingWeightProfileId: "profile-1",
    productGroupRaw: "Rose",
    varietyRaw: "Dallas",
    fobPricePerStem: "0.38",
    currency: "USD",
    unit: "BOXES",
    stemLengthCm: 60,
    quantity: "5",
    totalStems: 500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section C: finalization validation
// ---------------------------------------------------------------------------

describe("validateOfferLineForFinalization - blocking errors", () => {
  it("a fully valid line has no blocking errors", () => {
    const result = validateOfferLineForFinalization(validLine());
    expect(result.errors).toEqual([]);
  });

  it("errors when the assortment link (packagingWeightProfileId) is missing", () => {
    const result = validateOfferLineForFinalization(validLine({ packagingWeightProfileId: null }));
    expect(result.errors.some((e) => /assortimentartikel/i.test(e))).toBe(true);
  });

  it("errors when product is missing", () => {
    const result = validateOfferLineForFinalization(validLine({ productGroupRaw: null }));
    expect(result.errors.some((e) => /productgroep/i.test(e))).toBe(true);
  });

  it("errors when variety is missing", () => {
    const result = validateOfferLineForFinalization(validLine({ varietyRaw: "  " }));
    expect(result.errors.some((e) => /vari/i.test(e))).toBe(true);
  });

  it("errors when price is missing", () => {
    const result = validateOfferLineForFinalization(validLine({ fobPricePerStem: null }));
    expect(result.errors.some((e) => /prijs/i.test(e))).toBe(true);
  });

  it("errors when currency is missing", () => {
    const result = validateOfferLineForFinalization(validLine({ currency: null }));
    expect(result.errors.some((e) => /valuta/i.test(e))).toBe(true);
  });

  it("errors when unit is missing", () => {
    const result = validateOfferLineForFinalization(validLine({ unit: null }));
    expect(result.errors.some((e) => /eenheid|unit/i.test(e))).toBe(true);
  });
});

describe("validateOfferLineForFinalization - warnings", () => {
  it("warns (not errors) when stemLengthCm is missing", () => {
    const result = validateOfferLineForFinalization(validLine({ stemLengthCm: null }));
    expect(result.errors).toEqual([]);
    expect(result.warnings.some((w) => /lengte/i.test(w))).toBe(true);
  });

  it("warns when quantity is missing", () => {
    const result = validateOfferLineForFinalization(validLine({ quantity: null }));
    expect(result.warnings.some((w) => /hoeveelheid|quantity/i.test(w))).toBe(true);
  });

  it("warns when quantity is present but totalStems could not be calculated", () => {
    const result = validateOfferLineForFinalization(validLine({ quantity: "5", totalStems: null }));
    expect(result.warnings.some((w) => /stelen/i.test(w))).toBe(true);
  });

  it("does not warn about totalStems when quantity itself is already missing (covered by the quantity warning instead)", () => {
    const result = validateOfferLineForFinalization(validLine({ quantity: null, totalStems: null }));
    const stemsWarnings = result.warnings.filter((w) => /stelen/i.test(w));
    expect(stemsWarnings).toEqual([]);
  });

  it("a fully valid, fully complete line has no warnings at all", () => {
    const result = validateOfferLineForFinalization(validLine());
    expect(result.warnings).toEqual([]);
  });
});

describe("validateOfferLineForFinalization - resolved unit/quantity via boxesAvailable (stale-warning fix)", () => {
  it("quantity=2 + unit=BOXES does not report missing quantity/unit", () => {
    const result = validateOfferLineForFinalization(validLine({ quantity: "2", unit: "BOXES" }));
    expect(result.errors.some((e) => /eenheid|unit/i.test(e))).toBe(false);
    expect(result.warnings.some((w) => /hoeveelheid|quantity/i.test(w))).toBe(false);
  });

  it("a line with null quantity/unit but a real boxesAvailable is NOT reported as missing (matches the review screen's own display fallback)", () => {
    const result = validateOfferLineForFinalization(
      validLine({ quantity: null, unit: null, totalStems: null, boxesAvailable: 2 }),
    );
    expect(result.errors.some((e) => /eenheid|unit/i.test(e))).toBe(false);
    expect(result.warnings.some((w) => /hoeveelheid|quantity/i.test(w))).toBe(false);
  });

  it("a genuinely empty line (no quantity/unit AND no boxesAvailable) still reports both as missing", () => {
    const result = validateOfferLineForFinalization(
      validLine({ quantity: null, unit: null, totalStems: null, boxesAvailable: null }),
    );
    expect(result.errors.some((e) => /eenheid|unit/i.test(e))).toBe(true);
    expect(result.warnings.some((w) => /hoeveelheid|quantity/i.test(w))).toBe(true);
  });

  it("genuine unresolved warnings (e.g. missing price) remain even when boxesAvailable resolves quantity/unit", () => {
    const result = validateOfferLineForFinalization(
      validLine({ quantity: null, unit: null, boxesAvailable: 2, fobPricePerStem: null }),
    );
    expect(result.warnings.some((w) => /hoeveelheid|quantity/i.test(w))).toBe(false);
    expect(result.errors.some((e) => /prijs/i.test(e))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section D: supplier consistency
// ---------------------------------------------------------------------------

describe("isPackagingProfileValidForSupplier", () => {
  it("is valid when the offer and profile belong to the same farm", () => {
    expect(isPackagingProfileValidForSupplier("farm-1", "farm-1")).toBe(true);
  });

  it("is invalid when they belong to different farms", () => {
    expect(isPackagingProfileValidForSupplier("farm-1", "farm-2")).toBe(false);
  });

  it("is invalid when the offer has no farm at all (null offerFarmId)", () => {
    expect(isPackagingProfileValidForSupplier(null, "farm-1")).toBe(false);
  });

  it("is invalid when the profile farm id is missing", () => {
    expect(isPackagingProfileValidForSupplier("farm-1", null)).toBe(false);
  });

  it("is invalid when both are missing", () => {
    expect(isPackagingProfileValidForSupplier(null, null)).toBe(false);
  });
});

describe("validatePackagingWeightProfileSelection", () => {
  it("is valid when the profile exists and belongs to the same farm as the offer", () => {
    const result = validatePackagingWeightProfileSelection({
      offerFarmId: "farm-1",
      packagingWeightProfile: { id: "profile-1", farmId: "farm-1" },
    });
    expect(result).toEqual({ ok: true });
  });

  it("is invalid when the profile does not exist (e.g. deleted between page load and submit)", () => {
    const result = validatePackagingWeightProfileSelection({ offerFarmId: "farm-1", packagingWeightProfile: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/bestaat niet/i);
  });

  it("is invalid when the profile belongs to a different farm than the offer", () => {
    const result = validatePackagingWeightProfileSelection({
      offerFarmId: "farm-1",
      packagingWeightProfile: { id: "profile-1", farmId: "farm-2" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/andere leverancier/i);
  });
});
