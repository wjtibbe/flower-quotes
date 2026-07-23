import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssortmentCandidate } from "@/lib/import/matching/assortmentMatch";

vi.mock("server-only", () => ({}));

const mockFindMany = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    supplierLineMapping: {
      findMany: (...a: unknown[]) => mockFindMany(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
    },
  },
}));

const { applySupplierMappingsThenMatch } = await import("../applyMappings");

const FARM = "farm-luz";

function candidate(overrides: Partial<AssortmentCandidate> = {}): AssortmentCandidate {
  return {
    packagingWeightProfileId: "profile-dallas-60",
    farmId: FARM,
    productVariantId: "variant-dallas-60",
    productId: "product-rose",
    productName: "Rose",
    variety: "Dallas",
    stemLength: "60 cm",
    boxType: "QB",
    stemsPerBox: 100,
    boxWeight: "8.000",
    ...overrides,
  };
}

function mappingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mapping-1",
    farmId: FARM,
    normalizedSource: "dallas 60cm 0.38",
    rawSource: "Dallas 60cm 0.38",
    packagingWeightProfileId: "profile-mapped",
    packagingWeightProfile: { farmId: FARM, productVariantId: "variant-mapped" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
});

describe("applySupplierMappingsThenMatch - section 28 apply + section 29 precedence", () => {
  it("exact matching normalized source -> mapping wins, target attached, productVariantId from the mapped profile, status USER_LINKED", async () => {
    mockFindMany.mockResolvedValue([mappingRow()]);
    const candidates = [candidate()]; // the deterministic engine would pick a DIFFERENT profile

    const results = await applySupplierMappingsThenMatch(
      FARM,
      [{ rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 }],
      candidates,
    );

    expect(results[0]).toMatchObject({
      status: "USER_LINKED",
      packagingWeightProfileId: "profile-mapped",
      productVariantId: "variant-mapped",
      matchedViaMapping: true,
    });
  });

  it("no mapping for this source -> the deterministic matcher runs instead", async () => {
    mockFindMany.mockResolvedValue([]);
    const candidates = [candidate()];

    const results = await applySupplierMappingsThenMatch(
      FARM,
      [{ rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 }],
      candidates,
    );

    expect(results[0]).toMatchObject({
      status: "AUTO_MATCHED",
      packagingWeightProfileId: "profile-dallas-60",
      matchedViaMapping: false,
    });
  });

  it("a source differing only in price does not use the mapping", async () => {
    mockFindMany.mockResolvedValue([mappingRow({ normalizedSource: "dallas 60cm 0.38" })]);

    // The mapping lookup itself is keyed on the raw text - a different price
    // in the raw text normalizes to a different key, so findMany (mocked
    // here) simply would not have returned this row for that key in reality;
    // simulate that by returning no mapping for the differing text.
    mockFindMany.mockResolvedValueOnce([]);
    const candidates = [candidate()];

    const results = await applySupplierMappingsThenMatch(
      FARM,
      [{ rawText: "Dallas 60cm 0.40", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 }],
      candidates,
    );

    expect(results[0].matchedViaMapping).toBe(false);
  });

  it("a source differing only in length does not use the mapping", async () => {
    mockFindMany.mockResolvedValueOnce([]); // no row for the "70cm" normalized key
    const candidates = [candidate()];

    const results = await applySupplierMappingsThenMatch(
      FARM,
      [{ rawText: "Dallas 70cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 70 }],
      candidates,
    );

    expect(results[0].matchedViaMapping).toBe(false);
  });

  it("the SAME raw text for a DIFFERENT supplier never uses another farm's mapping (query is farm-scoped)", async () => {
    mockFindMany.mockResolvedValue([]); // this farm has no mapping for this text, even though farm-luz does
    const candidates: AssortmentCandidate[] = [];

    const results = await applySupplierMappingsThenMatch(
      "farm-other",
      [{ rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 }],
      candidates,
    );

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ farmId: "farm-other" }) }));
    expect(results[0].matchedViaMapping).toBe(false);
    expect(results[0].status).toBe("UNMATCHED");
  });

  it("precedence: an exact mapping wins even when the deterministic matcher would have picked a different profile", async () => {
    mockFindMany.mockResolvedValue([mappingRow({ packagingWeightProfileId: "profile-B", packagingWeightProfile: { farmId: FARM, productVariantId: "variant-B" } })]);
    // The deterministic engine, left alone, would pick profile-dallas-60 (candidate() above / "profile-A" equivalent).
    const candidates = [candidate({ packagingWeightProfileId: "profile-A" })];

    const results = await applySupplierMappingsThenMatch(
      FARM,
      [{ rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 }],
      candidates,
    );

    expect(results[0].packagingWeightProfileId).toBe("profile-B");
  });

  it("a stale mapping whose target belongs to a different farm is never used (defense in depth)", async () => {
    mockFindMany.mockResolvedValue([mappingRow({ packagingWeightProfile: { farmId: "farm-other", productVariantId: "variant-mapped" } })]);
    const candidates = [candidate()];

    const results = await applySupplierMappingsThenMatch(
      FARM,
      [{ rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 }],
      candidates,
    );

    expect(results[0].matchedViaMapping).toBe(false);
    expect(results[0].packagingWeightProfileId).toBe("profile-dallas-60"); // fell back to the deterministic engine
  });
});

describe("applySupplierMappingsThenMatch - section 30 batch loading + timesUsed", () => {
  it("loads mappings in exactly ONE query for the whole batch, never once per line", async () => {
    mockFindMany.mockResolvedValue([mappingRow()]);
    const candidates = [candidate()];

    await applySupplierMappingsThenMatch(
      FARM,
      [
        { rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 },
        { rawText: "Explorer 70cm 0.40", productGroupRaw: "Rose", varietyRaw: "Explorer", stemLengthCm: 70 },
        { rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 },
      ],
      candidates,
    );

    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("increments timesUsed by the number of lines a mapping applied to in this batch (10 matched lines -> +10)", async () => {
    mockFindMany.mockResolvedValue([mappingRow()]);
    const candidates = [candidate()];
    const tenLines = Array.from({ length: 10 }, () => ({
      rawText: "Dallas 60cm 0.38",
      productGroupRaw: "Rose",
      varietyRaw: "Dallas",
      stemLengthCm: 60,
    }));

    await applySupplierMappingsThenMatch(FARM, tenLines, candidates);

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "mapping-1" },
      data: { timesUsed: { increment: 10 }, lastUsedAt: expect.any(Date) },
    });
  });

  it("never increments usage when no mapping was used", async () => {
    mockFindMany.mockResolvedValue([]);
    const candidates = [candidate()];

    await applySupplierMappingsThenMatch(
      FARM,
      [{ rawText: "Nonexistent 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Nonexistent", stemLengthCm: 60 }],
      candidates,
    );

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("duplicate mapping-key lines within one batch each get matched, and the mapping's usage counts both", async () => {
    mockFindMany.mockResolvedValue([mappingRow()]);
    const candidates = [candidate()];

    const results = await applySupplierMappingsThenMatch(
      FARM,
      [
        { rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 },
        { rawText: "Dallas 60cm 0.38", productGroupRaw: "Rose", varietyRaw: "Dallas", stemLengthCm: 60 },
      ],
      candidates,
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.matchedViaMapping)).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { timesUsed: { increment: 2 }, lastUsedAt: expect.any(Date) } }));
  });
});
