import { describe, expect, it } from "vitest";
import { isFarmOfferLineQuotable } from "../lineGating";

describe("isFarmOfferLineQuotable - section 15 gating", () => {
  it("A. REVIEWED + AUTO_MATCHED -> quotable", () => {
    const r = isFarmOfferLineQuotable({ offerStatus: "REVIEWED", matchStatus: "AUTO_MATCHED", packagingWeightProfileId: "profile-1" });
    expect(r.ok).toBe(true);
  });

  it("B. REVIEWED + DERIVED -> quotable", () => {
    const r = isFarmOfferLineQuotable({ offerStatus: "REVIEWED", matchStatus: "DERIVED", packagingWeightProfileId: "profile-1" });
    expect(r.ok).toBe(true);
  });

  it("C. REVIEWED + USER_LINKED -> quotable", () => {
    const r = isFarmOfferLineQuotable({ offerStatus: "REVIEWED", matchStatus: "USER_LINKED", packagingWeightProfileId: "profile-1" });
    expect(r.ok).toBe(true);
  });

  it("D. DRAFT + AUTO_MATCHED -> not quotable", () => {
    const r = isFarmOfferLineQuotable({ offerStatus: "DRAFT", matchStatus: "AUTO_MATCHED", packagingWeightProfileId: "profile-1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("OFFER_NOT_REVIEWED");
  });

  it("E. REVIEWED + UNMATCHED -> not quotable", () => {
    const r = isFarmOfferLineQuotable({ offerStatus: "REVIEWED", matchStatus: "UNMATCHED", packagingWeightProfileId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LINE_NOT_MATCHED");
  });

  it("F. REVIEWED + AMBIGUOUS -> not quotable", () => {
    const r = isFarmOfferLineQuotable({ offerStatus: "REVIEWED", matchStatus: "AMBIGUOUS", packagingWeightProfileId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LINE_NOT_MATCHED");
  });

  it("G. packagingWeightProfileId null (even with an otherwise-allowed matchStatus) -> not quotable", () => {
    const r = isFarmOfferLineQuotable({ offerStatus: "REVIEWED", matchStatus: "AUTO_MATCHED", packagingWeightProfileId: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("PROFILE_MISSING");
  });

  it("ARCHIVED offer -> not quotable", () => {
    const r = isFarmOfferLineQuotable({ offerStatus: "ARCHIVED", matchStatus: "AUTO_MATCHED", packagingWeightProfileId: "profile-1" });
    expect(r.ok).toBe(false);
  });
});
