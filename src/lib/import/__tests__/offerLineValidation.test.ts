import { describe, expect, it } from "vitest";
import {
  computeLineValidationMessages,
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

// ---------------------------------------------------------------------------
// computeLineValidationMessages - warning reconciliation against the CURRENT
// effective state (fixes the review screen recomputing from the frozen,
// unfiltered extractedSnapshot.parserWarnings on every render).
// ---------------------------------------------------------------------------

const SWEETNESS_SNAPSHOT = {
  parserWarnings: [
    "stemsPerBox not stated so price-per-stem could not be derived; price for this length must be resolved from the shared price table (40 cm = 0.16) but currency is not stated anywhere in the source",
  ],
};

function sweetnessNext(overrides: Partial<FinalizationCheckInput> = {}): FinalizationCheckInput {
  return {
    packagingWeightProfileId: "profile-sweetness",
    productGroupRaw: "Rosa Ec",
    varietyRaw: "Sweetness",
    fobPricePerStem: "0.16",
    currency: "USD",
    unit: "BOXES",
    stemLengthCm: 40,
    quantity: "2",
    totalStems: 250,
    stemsPerBox: 125,
    weightPerBoxKg: "7.000",
    ...overrides,
  };
}

describe("computeLineValidationMessages - warning reconciliation", () => {
  it("1: matched profile supplies stemsPerBox -> stemsPerBox warning removed", () => {
    const { validationWarnings } = computeLineValidationMessages(
      { parserWarnings: ["stemsPerBox not stated."] },
      sweetnessNext(),
    );
    expect(validationWarnings ?? []).not.toContain("stemsPerBox not stated.");
  });

  it("2: matched profile supplies weight -> weight warning removed", () => {
    const { validationWarnings } = computeLineValidationMessages(
      { parserWarnings: ["box weight not stated."] },
      sweetnessNext(),
    );
    expect(validationWarnings ?? []).not.toContain("box weight not stated.");
  });

  it("3: supplier defaultCurrency supplies USD -> currency warning removed", () => {
    const { validationWarnings } = computeLineValidationMessages(
      { parserWarnings: ["Valuta niet vermeld in de bron - controleer bij review."] },
      sweetnessNext(),
    );
    expect(validationWarnings ?? []).not.toContain("Valuta niet vermeld in de bron - controleer bij review.");
  });

  it("4: price resolved from shared table -> price warning removed", () => {
    const { validationWarnings } = computeLineValidationMessages(
      { parserWarnings: ["price for this length must be resolved from the shared price table"] },
      sweetnessNext(),
    );
    expect(validationWarnings ?? []).toEqual([]);
  });

  it("5: quantity + stemsPerBox gives totalStems -> total-stems warning removed", () => {
    const { validationWarnings } = computeLineValidationMessages(
      { parserWarnings: ["Totaal aantal stelen kon niet worden berekend."] },
      sweetnessNext(),
    );
    expect(validationWarnings ?? []).not.toContain("Totaal aantal stelen kon niet worden berekend.");
  });

  it("6: a combined warning mentioning stemsPerBox+price+currency disappears once all three are resolved", () => {
    const { validationWarnings } = computeLineValidationMessages(SWEETNESS_SNAPSHOT, sweetnessNext());
    expect(validationWarnings ?? []).toEqual([]);
  });

  it("7: the combined warning REMAINS when one referenced issue is still unresolved (currency missing)", () => {
    const { validationWarnings } = computeLineValidationMessages(
      SWEETNESS_SNAPSHOT,
      sweetnessNext({ currency: null }),
    );
    expect(validationWarnings ?? []).toEqual(
      expect.arrayContaining([expect.stringContaining("currency is not stated")]),
    );
  });

  it("8: an unrelated/OTHER warning remains untouched", () => {
    const genuine = "Lengte kon niet worden geïnterpreteerd - controleer handmatig.";
    const { validationWarnings } = computeLineValidationMessages({ parserWarnings: [genuine] }, sweetnessNext());
    expect(validationWarnings).toContain(genuine);
  });

  it("9: extractedSnapshot's own parserWarnings array is never mutated by reconciliation", () => {
    const snapshot = { parserWarnings: [...SWEETNESS_SNAPSHOT.parserWarnings] };
    computeLineValidationMessages(snapshot, sweetnessNext());
    expect(snapshot.parserWarnings).toEqual(SWEETNESS_SNAPSHOT.parserWarnings);
  });

  it("10: the exact Sweetness example produces 0 active warnings and 0 blocking errors (READY)", () => {
    const { validationWarnings, validationErrors } = computeLineValidationMessages(SWEETNESS_SNAPSHOT, sweetnessNext());
    expect(validationWarnings).toBeNull();
    expect(validationErrors).toBeNull();
  });
});
