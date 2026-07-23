import { describe, expect, it } from "vitest";
import { resolveCanonicalPackaging } from "../canonicalPackaging";

describe("resolveCanonicalPackaging - section 17 canonical profile priority", () => {
  it("uses the PackagingWeightProfile's stemsPerBox over the FarmOfferLine's legacy stemsPerBox", () => {
    const r = resolveCanonicalPackaging(
      { boxType: "QB", stemsPerBox: 100, weightPerBoxKg: "8.000" },
      { boxType: "HB", stemsPerBox: 80, weightPerBoxKg: "7.500" },
    );
    expect(r.stemsPerBox).toBe(100);
    expect(r.source).toBe("PROFILE");
  });

  it("uses the profile's boxType over the legacy boxType", () => {
    const r = resolveCanonicalPackaging(
      { boxType: "QB", stemsPerBox: 100, weightPerBoxKg: "8.000" },
      { boxType: "HB", stemsPerBox: 80, weightPerBoxKg: "7.500" },
    );
    expect(r.boxType).toBe("QB");
  });

  it("uses the profile's weight over the legacy weight", () => {
    const r = resolveCanonicalPackaging(
      { boxType: "QB", stemsPerBox: 100, weightPerBoxKg: "8.000" },
      { boxType: "HB", stemsPerBox: 80, weightPerBoxKg: "7.500" },
    );
    expect(r.weightPerBoxKg).toBe("8.000");
  });

  it("falls back to the legacy snapshot when no profile is linked (historical compatibility)", () => {
    const r = resolveCanonicalPackaging(null, { boxType: "HB", stemsPerBox: 80, weightPerBoxKg: "7.500" });
    expect(r).toMatchObject({ boxType: "HB", stemsPerBox: 80, weightPerBoxKg: "7.500", source: "LEGACY" });
  });

  it("returns nulls (never guesses) when neither a profile nor legacy data exists", () => {
    const r = resolveCanonicalPackaging(null, { boxType: null, stemsPerBox: null, weightPerBoxKg: null });
    expect(r).toMatchObject({ boxType: null, stemsPerBox: null, weightPerBoxKg: null, source: "LEGACY" });
  });
});
