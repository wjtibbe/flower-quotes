import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ getServerSession: () => Promise.resolve({ user: { id: "user-1" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockFarmOfferLineFindUnique = vi.fn();
const mockFarmOfferLineUpdate = vi.fn();
const mockSupplierLineMappingFindUnique = vi.fn();
const mockSupplierLineMappingFindMany = vi.fn(); // asserted NEVER called from updateOfferLine (section 32)
const mockSupplierLineMappingCreate = vi.fn();
const mockPackagingWeightProfileFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    farmOfferLine: {
      findUnique: (...a: unknown[]) => mockFarmOfferLineFindUnique(...a),
      update: (...a: unknown[]) => mockFarmOfferLineUpdate(...a),
    },
    supplierLineMapping: {
      findUnique: (...a: unknown[]) => mockSupplierLineMappingFindUnique(...a),
      findMany: (...a: unknown[]) => mockSupplierLineMappingFindMany(...a),
      create: (...a: unknown[]) => mockSupplierLineMappingCreate(...a),
    },
    packagingWeightProfile: {
      findMany: (...a: unknown[]) => mockPackagingWeightProfileFindMany(...a),
    },
  },
}));

const { saveSupplierLineMapping, updateOfferLine } = await import("../actions");

function line(overrides: Record<string, unknown> = {}) {
  return {
    id: "line-1",
    farmOfferId: "offer-1",
    rawText: "Dallas 60cm 0.38",
    productGroupRaw: "Rose",
    varietyRaw: "Dallas",
    stemLengthCm: 60,
    matchStatus: "USER_LINKED",
    packagingWeightProfileId: "profile-1",
    farmOffer: { farmId: "farm-1" },
    packagingWeightProfile: { farmId: "farm-1" },
    extractedSnapshot: null,
    fobPricePerStem: { toString: () => "0.38" },
    currency: "USD",
    unit: null,
    quantity: null,
    totalStems: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSupplierLineMappingCreate.mockResolvedValue({ id: "mapping-new" });
});

describe("saveSupplierLineMapping - section 27 create", () => {
  it("USER_LINKED line with rawText and a profile -> mapping created", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line({ matchStatus: "USER_LINKED" }));
    mockSupplierLineMappingFindUnique.mockResolvedValue(null);

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(true);
    expect(mockSupplierLineMappingCreate).toHaveBeenCalledWith({
      data: {
        farmId: "farm-1",
        normalizedSource: "dallas 60cm 0.38",
        rawSource: "Dallas 60cm 0.38",
        packagingWeightProfileId: "profile-1",
        createdById: "user-1",
      },
    });
  });

  it("AUTO_MATCHED line + explicit user save -> mapping created", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line({ matchStatus: "AUTO_MATCHED" }));
    mockSupplierLineMappingFindUnique.mockResolvedValue(null);

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(true);
    expect(mockSupplierLineMappingCreate).toHaveBeenCalledTimes(1);
  });

  it("no rawText -> blocked, no mapping created", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line({ rawText: "" }));

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(false);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });

  it("whitespace-only rawText -> blocked, no mapping created", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line({ rawText: "   " }));

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(false);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });

  it('a degraded-AI placeholder rawText "(kon oorspronkelijke brontekst niet achterhalen)" -> blocked, no mapping created', async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line({ rawText: "(kon oorspronkelijke brontekst niet achterhalen)" }));

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(false);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });

  it("a manually-added-line placeholder rawText -> blocked, no mapping created", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line({ rawText: "(handmatig ingevoerd)" }));

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(false);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });

  it("no packagingWeightProfileId -> blocked", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(
      line({ packagingWeightProfileId: null, packagingWeightProfile: null, matchStatus: "UNMATCHED" }),
    );

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(false);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });

  it("cross-farm target (profile belongs to a different supplier) -> blocked", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line({ packagingWeightProfile: { farmId: "farm-OTHER" } }));

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(false);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });

  it("duplicate with the SAME target -> idempotent, no duplicate row created", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line());
    mockSupplierLineMappingFindUnique.mockResolvedValue({
      id: "mapping-existing",
      packagingWeightProfileId: "profile-1",
    });

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(true);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });

  it("duplicate with a DIFFERENT target -> conflict, never silently overwritten", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line());
    mockSupplierLineMappingFindUnique.mockResolvedValue({
      id: "mapping-existing",
      packagingWeightProfileId: "profile-OTHER",
    });

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(false);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });

  it("AMBIGUOUS/UNMATCHED status is never eligible, even with a stray profile id", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(line({ matchStatus: "AMBIGUOUS" }));

    const result = await saveSupplierLineMapping("line-1");

    expect(result.ok).toBe(false);
    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });
});

describe("updateOfferLine - section 32 user edit never reapplies a supplier mapping", () => {
  it("a match-affecting correction (variety change) re-matches deterministically and never queries SupplierLineMapping", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(
      line({ varietyRaw: "Dallas", matchStatus: "USER_LINKED", farmOffer: { farmId: "farm-1" } }),
    );
    mockPackagingWeightProfileFindMany.mockResolvedValue([]);
    mockFarmOfferLineUpdate.mockResolvedValue({});

    const fd = new FormData();
    fd.set("productGroupRaw", "Rose");
    fd.set("varietyRaw", "Freedom"); // changed - match-affecting
    fd.set("currency", "USD");

    await updateOfferLine("line-1", fd);

    expect(mockSupplierLineMappingFindMany).not.toHaveBeenCalled();
  });

  it("18: 'Opslaan' (updateOfferLine) never creates a SupplierLineMapping - only explicit 'Save as supplier mapping' does", async () => {
    mockFarmOfferLineFindUnique.mockResolvedValue(
      line({ varietyRaw: "Dallas", matchStatus: "AUTO_MATCHED", farmOffer: { farmId: "farm-1" } }),
    );
    mockPackagingWeightProfileFindMany.mockResolvedValue([]);
    mockFarmOfferLineUpdate.mockResolvedValue({});

    const fd = new FormData();
    fd.set("productGroupRaw", "Rose");
    fd.set("varietyRaw", "Dallas");
    fd.set("currency", "USD");

    await updateOfferLine("line-1", fd);

    expect(mockSupplierLineMappingCreate).not.toHaveBeenCalled();
  });
});
