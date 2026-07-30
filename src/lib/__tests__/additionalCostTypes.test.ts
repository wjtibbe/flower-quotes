import { describe, expect, it } from "vitest";
import {
  displayAdditionalCostName,
  filterActiveCostTypes,
  normalizeCostTypeName,
  validateRouteCostInput,
} from "../additionalCostTypes";

describe("normalizeCostTypeName - case/whitespace-insensitive uniqueness key", () => {
  it("1: 'Clearing', 'clearing' and 'CLEARING' normalize to the same key", () => {
    expect(normalizeCostTypeName("Clearing")).toBe(normalizeCostTypeName("clearing"));
    expect(normalizeCostTypeName("Clearing")).toBe(normalizeCostTypeName("CLEARING"));
  });

  it("1: leading/trailing whitespace does not create a distinct key", () => {
    expect(normalizeCostTypeName("  Clearing  ")).toBe(normalizeCostTypeName("Clearing"));
  });

  it("1: genuinely different names normalize differently", () => {
    expect(normalizeCostTypeName("Clearing")).not.toBe(normalizeCostTypeName("Handling"));
  });
});

describe("filterActiveCostTypes - Routes & Freight add-dropdown source", () => {
  const types = [
    { id: "1", name: "Clearing", isActive: true },
    { id: "2", name: "Oude kostensoort", isActive: false },
    { id: "3", name: "Handling", isActive: true },
  ];

  it("2: inactive types are excluded", () => {
    const result = filterActiveCostTypes(types);
    expect(result.find((t) => t.id === "2")).toBeUndefined();
  });

  it("3: active types are included", () => {
    const result = filterActiveCostTypes(types);
    expect(result.map((t) => t.id)).toEqual(["1", "3"]);
  });
});

describe("validateRouteCostInput - shared add/edit validation", () => {
  const base = {
    additionalCostTypeId: "type-1",
    amount: "1.5",
    currency: "USD",
    rateUnit: "PER_STEM",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-06-01",
  };

  it("valid input passes", () => {
    expect(validateRouteCostInput(base)).toBeNull();
  });

  it("cost type is required", () => {
    expect(validateRouteCostInput({ ...base, additionalCostTypeId: null })).toMatch(/Kostensoort/);
  });

  it("amount must be positive", () => {
    expect(validateRouteCostInput({ ...base, amount: "0" })).toMatch(/positief/);
    expect(validateRouteCostInput({ ...base, amount: "-5" })).toMatch(/positief/);
    expect(validateRouteCostInput({ ...base, amount: "abc" })).toMatch(/positief/);
  });

  it("currency is required", () => {
    expect(validateRouteCostInput({ ...base, currency: null })).toMatch(/Valuta/);
  });

  it("unit is required", () => {
    expect(validateRouteCostInput({ ...base, rateUnit: null })).toMatch(/Eenheid/);
  });

  it("9: rejects validUntil (effectiveTo) before validFrom (effectiveFrom)", () => {
    const result = validateRouteCostInput({ ...base, effectiveFrom: "2026-06-01", effectiveTo: "2026-01-01" });
    expect(result).toMatch(/vóór/);
  });

  it("9: accepts validUntil equal to or after validFrom", () => {
    expect(validateRouteCostInput({ ...base, effectiveFrom: "2026-01-01", effectiveTo: "2026-01-01" })).toBeNull();
  });

  it("9: allows either date to be omitted", () => {
    expect(validateRouteCostInput({ ...base, effectiveFrom: null, effectiveTo: null })).toBeNull();
  });
});

describe("displayAdditionalCostName - single terminology source", () => {
  it("16: prefers the live cost type's current (canonical) name over a stale snapshot name", () => {
    const cost = { name: "Clearing (oud)", additionalCostType: { name: "Clearing" } };
    expect(displayAdditionalCostName(cost)).toBe("Clearing");
  });

  it("12: a deactivated-but-still-linked type's name still resolves (deactivation never breaks history)", () => {
    // Deactivation only flips isActive - the relation object itself is untouched,
    // so a linked row keeps showing the type's name exactly as when it was active.
    const cost = { name: "Clearing", additionalCostType: { name: "Clearing" } };
    expect(displayAdditionalCostName(cost)).toBe("Clearing");
  });

  it("falls back to the row's own snapshot name when there is no live relation (frozen quote-line snapshot)", () => {
    const cost = { name: "Clearing", additionalCostType: null };
    expect(displayAdditionalCostName(cost)).toBe("Clearing");
  });

  it("falls back to 'Onbekend' when neither is available", () => {
    expect(displayAdditionalCostName({ name: null, additionalCostType: null })).toBe("Onbekend");
  });
});
