import { describe, expect, it } from "vitest";
import { resolveOfferLinePricingQuantity } from "../quantityResolution";

describe("resolveOfferLinePricingQuantity - section 16 quantity resolution", () => {
  it("BOXES: 5 boxes + 100 stems/box -> 5 boxes, 500 stems", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 5, unit: "BOXES", boxesAvailable: null, stemsPerBox: 100 });
    expect(r).toMatchObject({ ok: true, quantityBoxes: 5, totalStems: 500, source: "BOXES" });
  });

  it("STEMS: 500 stems + 100 stems/box -> 5 boxes, 500 stems", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 500, unit: "STEMS", boxesAvailable: null, stemsPerBox: 100 });
    expect(r).toMatchObject({ ok: true, quantityBoxes: 5, totalStems: 500, source: "STEMS" });
  });

  it("STEMS: 550 stems + 100 stems/box -> blocking, never rounds", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 550, unit: "STEMS", boxesAvailable: null, stemsPerBox: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("STEMS_NOT_DIVISIBLE");
  });

  it("BOXES: 2.5 boxes -> blocking", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 2.5, unit: "BOXES", boxesAvailable: null, stemsPerBox: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FRACTIONAL_BOXES");
  });

  it("BUNCHES -> blocking, never auto-converted", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 10, unit: "BUNCHES", boxesAvailable: null, stemsPerBox: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BUNCHES_NOT_SUPPORTED");
  });

  it("KILOGRAMS -> blocking, never auto-converted", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 12.5, unit: "KILOGRAMS", boxesAvailable: null, stemsPerBox: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("KILOGRAMS_NOT_SUPPORTED");
  });

  it("legacy: boxesAvailable = 4, unit null -> 4 boxes", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: null, unit: null, boxesAvailable: 4, stemsPerBox: 100 });
    expect(r).toMatchObject({ ok: true, quantityBoxes: 4, totalStems: 400, source: "LEGACY_BOXES" });
  });

  it("legacy: boxesAvailable null -> no default of 1, blocking", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: null, unit: null, boxesAvailable: null, stemsPerBox: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_QUANTITY");
  });

  it("BOXES quantity present but stemsPerBox unknown -> blocking, never guesses a box count", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 5, unit: "BOXES", boxesAvailable: null, stemsPerBox: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_STEMS_PER_BOX");
  });

  it("STEMS quantity present but stemsPerBox unknown -> blocking", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 500, unit: "STEMS", boxesAvailable: null, stemsPerBox: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_STEMS_PER_BOX");
  });

  it("zero stemsPerBox is treated as missing, not a division by zero", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 5, unit: "BOXES", boxesAvailable: null, stemsPerBox: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_STEMS_PER_BOX");
  });

  it("zero or negative BOXES quantity is blocking, not treated as a valid empty order", () => {
    const r = resolveOfferLinePricingQuantity({ quantity: 0, unit: "BOXES", boxesAvailable: null, stemsPerBox: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MISSING_QUANTITY");
  });
});
