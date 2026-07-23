import { describe, expect, it } from "vitest";
import {
  haveMatchAffectingFieldsChanged,
  matchAssortment,
  parseExactStemLengthCm,
  resolveImportedProductName,
} from "../assortmentMatch";
import type { AssortmentCandidate } from "../assortmentMatch";

const FARM = "farm-agrinag";

function candidate(overrides: Partial<AssortmentCandidate> = {}): AssortmentCandidate {
  return {
    packagingWeightProfileId: "profile-1",
    farmId: FARM,
    productVariantId: "variant-1",
    productId: "product-1",
    productName: "Rosa Ec",
    variety: "Dallas",
    stemLength: "60 cm",
    boxType: "QB",
    stemsPerBox: 100,
    boxWeight: "8.000",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Section 19.A-J
// ---------------------------------------------------------------------------

describe("matchAssortment - A: exact unique match", () => {
  it("matches uniquely on supplier+product+variety+length -> AUTO_MATCHED with the right profile", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 },
      [candidate()],
    );
    expect(result.status).toBe("AUTO_MATCHED");
    expect(result.packagingWeightProfileId).toBe("profile-1");
    expect(result.productVariantId).toBe("variant-1");
  });
});

describe("matchAssortment - B: same product/variety/length, two packagings", () => {
  const twoPackagings = [
    candidate({ packagingWeightProfileId: "p-qb", boxType: "QB", stemsPerBox: 100, boxWeight: "8.000" }),
    candidate({ packagingWeightProfileId: "p-hb", boxType: "HB", stemsPerBox: 200, boxWeight: "14.000" }),
  ];

  it("is AMBIGUOUS with no packagingWeightProfileId and both options returned", () => {
    const result = matchAssortment({ farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 }, twoPackagings);
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.packagingWeightProfileId).toBeNull();
    expect(result.options).toHaveLength(2);
  });

  it("stays AMBIGUOUS even though only one candidate is QB - packaging is never used to auto-pick (section 7). `AssortmentMatchInput` has no boxType field at all, so there is nothing for a caller to even pass in here.", () => {
    const result = matchAssortment({ farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 }, twoPackagings);
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.packagingWeightProfileId).toBeNull();
  });

  it("still resolves productVariantId since both packagings share the exact same ProductVariant", () => {
    const result = matchAssortment({ farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 }, twoPackagings);
    expect(result.productVariantId).toBe("variant-1");
  });
});

describe("matchAssortment - C: supplier scope", () => {
  it("only considers the given farm's candidates, even when another farm has an identical product/variety/length", () => {
    const agrinag = candidate({ packagingWeightProfileId: "p-agrinag", farmId: FARM });
    const otherFarm = candidate({ packagingWeightProfileId: "p-other", farmId: "farm-other", productVariantId: "variant-other" });

    const result = matchAssortment({ farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 }, [agrinag, otherFarm]);

    expect(result.status).toBe("AUTO_MATCHED");
    expect(result.packagingWeightProfileId).toBe("p-agrinag");
    expect(result.options.some((o) => o.packagingWeightProfileId === "p-other")).toBe(false);
  });
});

describe("matchAssortment - D: derive product from variety", () => {
  it("derives the product from variety+length when exactly one product/profile matches -> DERIVED", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: null, variety: "Dallas", stemLengthCm: 60 },
      [candidate()],
    );
    expect(result.status).toBe("DERIVED");
    expect(result.derivedProductName).toBe("Rosa Ec");
    expect(result.packagingWeightProfileId).toBe("profile-1");
    expect(result.productVariantId).toBe("variant-1");
  });
});

describe("matchAssortment - E: variety under multiple products", () => {
  it("does not automatically choose a product when the variety exists under two different products -> AMBIGUOUS", () => {
    const candidates = [
      candidate({ packagingWeightProfileId: "p-a", productId: "product-a", productVariantId: "variant-a", productName: "Product A", variety: "Freedom" }),
      candidate({ packagingWeightProfileId: "p-b", productId: "product-b", productVariantId: "variant-b", productName: "Product B", variety: "Freedom" }),
    ];
    const result = matchAssortment({ farmId: FARM, productName: null, variety: "Freedom", stemLengthCm: 60 }, candidates);

    expect(result.status).toBe("AMBIGUOUS");
    expect(result.packagingWeightProfileId).toBeNull();
    expect(result.productVariantId).toBeNull();
    expect(result.derivedProductName).toBeUndefined();
    expect(result.options).toHaveLength(2);
  });
});

describe("matchAssortment - F: length normalization", () => {
  it("matches a '60 cm' variant length against a numeric input of 60", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 },
      [candidate({ stemLength: "60 cm" })],
    );
    expect(result.status).toBe("AUTO_MATCHED");
  });

  it("never exactly matches a range variant length like '50-70 cm' against a single input length", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 },
      [candidate({ stemLength: "50-70 cm" })],
    );
    expect(result.status).toBe("UNMATCHED");
    expect(result.packagingWeightProfileId).toBeNull();
  });

  it("parseExactStemLengthCm treats '60', '60cm', '60CM', '60 cm' identically", () => {
    expect(parseExactStemLengthCm("60")).toBe(60);
    expect(parseExactStemLengthCm("60cm")).toBe(60);
    expect(parseExactStemLengthCm("60CM")).toBe(60);
    expect(parseExactStemLengthCm("60 cm")).toBe(60);
  });

  it("parseExactStemLengthCm returns null for a range in any dash style", () => {
    expect(parseExactStemLengthCm("50-70 cm")).toBeNull();
    expect(parseExactStemLengthCm("50 - 70cm")).toBeNull();
    expect(parseExactStemLengthCm("50–70cm")).toBeNull();
  });
});

describe("matchAssortment - G: casing/spacing/accents", () => {
  it("is case- and whitespace-insensitive for product name and variety", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "rosa ec", variety: "dallas", stemLengthCm: 60 },
      [candidate({ productName: " Rosa   Ec ", variety: "Dallas" })],
    );
    expect(result.status).toBe("AUTO_MATCHED");
  });

  it("is accent-insensitive for product name comparison", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "Bogota Rose", variety: "Dallas", stemLengthCm: 60 },
      [candidate({ productName: "Bogotá Rose", variety: "Dallas" })],
    );
    expect(result.status).toBe("AUTO_MATCHED");
  });
});

describe("matchAssortment - H: typo never auto-matches", () => {
  it('"Dalas" (typo) does not match an assortment variety of "Dallas"', () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Dalas", stemLengthCm: 60 },
      [candidate({ variety: "Dallas" })],
    );
    expect(result.status).toBe("UNMATCHED");
    expect(result.packagingWeightProfileId).toBeNull();
  });
});

describe("matchAssortment - I: missing length", () => {
  it("never auto-matches when length is missing, even with exactly one otherwise-matching candidate", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: null },
      [candidate()],
    );
    expect(result.status).toBe("UNMATCHED");
    expect(result.packagingWeightProfileId).toBeNull();
    expect(result.options).toHaveLength(1); // still useful context for a future review UI
  });
});

describe("matchAssortment - J: different farm", () => {
  it("never links a profile belonging to a different farm, even when it is the only candidate passed in", () => {
    const result = matchAssortment(
      { farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 },
      [candidate({ farmId: "farm-other" })],
    );
    expect(result.status).toBe("UNMATCHED");
    expect(result.packagingWeightProfileId).toBeNull();
    expect(result.options).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Section 20: result details
// ---------------------------------------------------------------------------

describe("matchAssortment - result detail requirements", () => {
  it("options include boxType/stemsPerBox/boxWeight for display", () => {
    const result = matchAssortment({ farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 }, [candidate()]);
    expect(result.options[0]).toMatchObject({ boxType: "QB", stemsPerBox: 100, boxWeight: "8.000" });
  });

  it("sorts options deterministically (product -> variety -> length -> boxType -> stemsPerBox) regardless of input order", () => {
    const candidates = [
      candidate({ packagingWeightProfileId: "p-z-100", productName: "Zinnia", variety: "Dallas", stemLength: "60 cm", boxType: "QB", stemsPerBox: 100 }),
      candidate({ packagingWeightProfileId: "p-a-hb", productName: "Alstro", variety: "Dallas", stemLength: "60 cm", boxType: "HB", stemsPerBox: 50 }),
      candidate({ packagingWeightProfileId: "p-a-qb", productName: "Alstro", variety: "Dallas", stemLength: "60 cm", boxType: "QB", stemsPerBox: 50 }),
    ];
    const shuffled = [candidates[2], candidates[0], candidates[1]];

    const result = matchAssortment({ farmId: FARM, productName: null, variety: "Dallas", stemLengthCm: 60 }, shuffled);

    // Alstro < Zinnia (product), and within Alstro/Dallas/60cm, "HB" sorts
    // before "QB" alphabetically - boxType is a plain string sort, exactly
    // as specified (product -> variety -> length -> boxType -> stemsPerBox).
    expect(result.options.map((o) => o.packagingWeightProfileId)).toEqual(["p-a-hb", "p-a-qb", "p-z-100"]);
  });

  it("sorts by numeric length, not lexicographically (100 cm must sort after 60 cm)", () => {
    const candidates = [
      candidate({ packagingWeightProfileId: "p-100", productName: "Rosa Ec", variety: "Dallas", stemLength: "100 cm" }),
      candidate({ packagingWeightProfileId: "p-60", productName: "Rosa Ec", variety: "Dallas", stemLength: "60 cm" }),
    ];
    const result = matchAssortment({ farmId: FARM, productName: "Rosa Ec", variety: "Dallas", stemLengthCm: null }, candidates);
    expect(result.options.map((o) => o.packagingWeightProfileId)).toEqual(["p-60", "p-100"]);
  });
});

// ---------------------------------------------------------------------------
// resolveImportedProductName / parseExactStemLengthCm as standalone units
// ---------------------------------------------------------------------------

describe("resolveImportedProductName", () => {
  it("prefers productNameRaw over productGroupRaw when both are present", () => {
    expect(resolveImportedProductName({ productNameRaw: "Rosa Ec", productGroupRaw: "Rose" })).toBe("Rosa Ec");
  });

  it("falls back to productGroupRaw when productNameRaw is absent (today's real parsers only ever fill this one)", () => {
    expect(resolveImportedProductName({ productGroupRaw: "Rose" })).toBe("Rose");
  });

  it("returns null when neither field has real text", () => {
    expect(resolveImportedProductName({})).toBeNull();
    expect(resolveImportedProductName({ productNameRaw: "  ", productGroupRaw: "  " })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Review-screen rebuild, section 14/26.B: which corrections invalidate a match
// ---------------------------------------------------------------------------

describe("haveMatchAffectingFieldsChanged", () => {
  const base = { productName: "Rosa Ec", variety: "Dallas", stemLengthCm: 60 };

  it("is true when variety changes (e.g. Dallas -> Freedom)", () => {
    expect(haveMatchAffectingFieldsChanged(base, { ...base, variety: "Freedom" })).toBe(true);
  });

  it("is true when stemLengthCm changes (e.g. 50 -> 60)", () => {
    expect(haveMatchAffectingFieldsChanged({ ...base, stemLengthCm: 50 }, { ...base, stemLengthCm: 60 })).toBe(true);
  });

  it("is true when product changes", () => {
    expect(haveMatchAffectingFieldsChanged(base, { ...base, productName: "Rosa Colombia" })).toBe(true);
  });

  it("is false when nothing changes", () => {
    expect(haveMatchAffectingFieldsChanged(base, { ...base })).toBe(false);
  });

  it("is false for a casing/whitespace-only difference (matcher-equivalent, not a real change)", () => {
    expect(haveMatchAffectingFieldsChanged(base, { ...base, variety: "  dallas  " })).toBe(false);
  });

  it("is false when only packaging/price/notes-adjacent fields would differ (this function isn't even given those - only product/variety/length)", () => {
    // notes/price/currency/quantity/unit/box fields simply aren't part of
    // MatchAffectingFields at all, so a notes-only edit never reaches this
    // function with anything different (section 14).
    expect(haveMatchAffectingFieldsChanged(base, { ...base })).toBe(false);
  });
});
