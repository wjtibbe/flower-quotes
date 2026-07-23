import { describe, expect, it, vi } from "vitest";
import type { AssortmentCandidate } from "../assortmentMatch";

// `matchFarmOfferLine.ts` imports "server-only" (and, transitively via
// `assortmentRepository.ts`, `@/lib/db`) - harmless in the real app (Next
// aliases "server-only" away in server bundles), but it needs a no-op mock
// here so this plain-Node Vitest run can import the module at all. Only the
// pure `matchFarmOfferLine`/`matchOfferLines` functions are exercised below -
// `matchSingleFarmOfferLine` (the one function that actually touches Prisma)
// is intentionally not covered by this file.
vi.mock("server-only", () => ({}));

const { matchFarmOfferLine, matchOfferLines } = await import("../matchFarmOfferLine");

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

describe("matchFarmOfferLine", () => {
  it("resolves the imported product name (productGroupRaw fallback) and matches against it", () => {
    const result = matchFarmOfferLine(
      { farmId: FARM, productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 },
      [candidate()],
    );
    expect(result.status).toBe("AUTO_MATCHED");
    expect(result.packagingWeightProfileId).toBe("profile-1");
  });

  it("prefers productNameRaw over productGroupRaw when both are present", () => {
    const result = matchFarmOfferLine(
      { farmId: FARM, productNameRaw: "Rose", productGroupRaw: "Something else entirely", varietyRaw: "Dallas", stemLengthCm: 60 },
      [candidate()],
    );
    expect(result.status).toBe("AUTO_MATCHED");
  });

  it("is re-runnable with corrected fields, ready for a future re-match-after-edit flow", () => {
    const candidates = [candidate()];
    const before = matchFarmOfferLine({ farmId: FARM, varietyRaw: "Dalas", stemLengthCm: 60 }, candidates);
    expect(before.status).toBe("UNMATCHED");

    const after = matchFarmOfferLine({ farmId: FARM, productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 }, candidates);
    expect(after.status).toBe("AUTO_MATCHED");
  });
});

describe("matchOfferLines", () => {
  it("matches every line against the exact same pre-loaded candidate set (no per-line loading)", () => {
    const candidates = [
      candidate({ packagingWeightProfileId: "p-dallas", variety: "Dallas" }),
      candidate({ packagingWeightProfileId: "p-freedom", productVariantId: "variant-2", variety: "Freedom" }),
    ];

    const results = matchOfferLines(
      FARM,
      [
        { productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 },
        { productGroupRaw: "Rose", varietyRaw: "Freedom", stemLengthCm: 60 },
        { productGroupRaw: "Rose", varietyRaw: "Nonexistent", stemLengthCm: 60 },
      ],
      candidates,
    );

    expect(results).toHaveLength(3);
    expect(results[0].packagingWeightProfileId).toBe("p-dallas");
    expect(results[1].packagingWeightProfileId).toBe("p-freedom");
    expect(results[2].status).toBe("UNMATCHED");
  });
});
