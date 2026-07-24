import { describe, expect, it } from "vitest";
import { matchAssortment } from "@/lib/import/matching/assortmentMatch";
import type { AssortmentCandidate } from "@/lib/import/matching/assortmentMatch";

// Part B5 / E.18: editing an assortment row's length must be reflected by
// future matching, using the SAME deterministic matcher (no change to
// assortmentMatch.ts needed - it already parses a canonical numeric length
// like "60" identically to a legacy "60 cm" value; see
// `parseExactStemLengthCm`). This file only exercises that existing engine
// against the app's own canonical (no "cm") length values end to end.

const FARM = "farm-agrinag";

function candidate(overrides: Partial<AssortmentCandidate> = {}): AssortmentCandidate {
  return {
    packagingWeightProfileId: "profile-1",
    farmId: FARM,
    productVariantId: "variant-1",
    productId: "product-1",
    productName: "Rosa Ec",
    variety: "Garden Candlelight",
    stemLength: "50",
    boxType: "QB",
    stemsPerBox: 100,
    boxWeight: "8.000",
    ...overrides,
  };
}

describe("assortment length matching after an edit (Part B5)", () => {
  it("a canonical numeric length ('60', no cm) matches a supplier length of 60 exactly like a legacy '60 cm' value would", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Garden Candlelight", stemLengthCm: 60 },
      [candidate({ stemLength: "60" })],
    );
    expect(result.status).toBe("AUTO_MATCHED");
    expect(result.packagingWeightProfileId).toBe("profile-1");
  });

  it("18: after the profile's length is edited from 50 to 60, a future '...60' offer matches and a future '...50' offer no longer does", () => {
    const editedProfile = candidate({ stemLength: "60" }); // simulates the post-edit stored value

    const stillFifty = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Garden Candlelight", stemLengthCm: 50 },
      [editedProfile],
    );
    expect(stillFifty.status).toBe("UNMATCHED");

    const newSixty = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Garden Candlelight", stemLengthCm: 60 },
      [editedProfile],
    );
    expect(newSixty.status).toBe("AUTO_MATCHED");
    expect(newSixty.packagingWeightProfileId).toBe("profile-1");
  });
});
