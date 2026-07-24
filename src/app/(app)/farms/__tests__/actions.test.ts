import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const mockFarmCreate = vi.fn();
const mockFarmUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    farm: {
      create: (...args: unknown[]) => mockFarmCreate(...args),
      update: (...args: unknown[]) => mockFarmUpdate(...args),
    },
  },
}));

const { saveFarm } = await import("../actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFarmCreate.mockResolvedValue({ id: "farm-new" });
  mockFarmUpdate.mockResolvedValue({ id: "farm-1" });
});

describe("saveFarm - supplier default currency", () => {
  it("2: a new supplier with no defaultCurrency field submitted defaults to USD", async () => {
    await saveFarm(formData({ name: "New Farm", country: "Ecuador" }));
    expect(mockFarmCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultCurrency: "USD" }) }),
    );
  });

  it("a new supplier explicitly submitted with USD is created with USD", async () => {
    await saveFarm(formData({ name: "New Farm", country: "Ecuador", defaultCurrency: "USD" }));
    expect(mockFarmCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultCurrency: "USD" }) }),
    );
  });

  it("3: an existing supplier's defaultCurrency can be changed to EUR", async () => {
    await saveFarm(formData({ id: "farm-1", name: "Mystic Flowers", country: "Colombia", defaultCurrency: "EUR" }));
    expect(mockFarmUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "farm-1" }, data: expect.objectContaining({ defaultCurrency: "EUR" }) }),
    );
  });

  it("an invalid/unsupported currency value falls back to USD rather than being persisted as-is", async () => {
    await saveFarm(formData({ name: "New Farm", country: "Ecuador", defaultCurrency: "COP" }));
    expect(mockFarmCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ defaultCurrency: "USD" }) }),
    );
  });
});
