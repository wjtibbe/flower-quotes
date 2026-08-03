import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: () => Promise.resolve({ user: { id: "user-1" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockDeleteMany = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockFindUniqueOrThrow = vi.fn();
const mockTransaction = vi.fn((ops: unknown[]) => Promise.all(ops));

vi.mock("@/lib/db", () => ({
  prisma: {
    exchangeRate: {
      deleteMany: (...a: unknown[]) => mockDeleteMany(...a),
      create: (...a: unknown[]) => mockCreate(...a),
      update: (...a: unknown[]) => mockUpdate(...a),
      findUniqueOrThrow: (...a: unknown[]) => mockFindUniqueOrThrow(...a),
    },
    $transaction: (...a: [unknown[]]) => mockTransaction(...a),
  },
}));

const { addExchangeRate, editExchangeRate } = await import("../actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
  mockDeleteMany.mockResolvedValue({ count: 0 });
  mockCreate.mockResolvedValue({ id: "rate-new" });
  mockUpdate.mockResolvedValue({ id: "rate-1" });
});

describe("addExchangeRate - EUR is the single base currency", () => {
  it("1: stores the new rate with baseCurrency EUR", async () => {
    await expect(addExchangeRate(formData({ quoteCurrency: "USD", rate: "1.17" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?msg=rate-added",
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ baseCurrency: "EUR", quoteCurrency: "USD", rate: "1.17" }),
      }),
    );
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { baseCurrency: "EUR", quoteCurrency: "USD" } });
  });

  it("10: ignores a client-submitted baseCurrency override and still stores EUR", async () => {
    await expect(
      addExchangeRate(formData({ baseCurrency: "USD", quoteCurrency: "USD", rate: "1.17" })),
    ).rejects.toThrow("REDIRECT:");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ baseCurrency: "EUR" }) }),
    );
  });

  it("3: rejects EUR as the target currency (via redirect+err, not a raw throw - no error.tsx exists on this route)", async () => {
    await expect(addExchangeRate(formData({ quoteCurrency: "EUR", rate: "1.17" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?err=",
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an unknown currency code", async () => {
    await expect(addExchangeRate(formData({ quoteCurrency: "GBP", rate: "1.17" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?err=",
    );
  });

  it("11: rejects a zero rate", async () => {
    await expect(addExchangeRate(formData({ quoteCurrency: "USD", rate: "0" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?err=",
    );
  });

  it("11: rejects a negative rate", async () => {
    await expect(addExchangeRate(formData({ quoteCurrency: "USD", rate: "-1.17" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?err=",
    );
  });

  it("rejects a non-numeric rate", async () => {
    await expect(addExchangeRate(formData({ quoteCurrency: "USD", rate: "abc" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?err=",
    );
  });
});

describe("editExchangeRate - base and target stay fixed", () => {
  it("2: updates only the rate/notes, never the currencies", async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: "rate-1", baseCurrency: "EUR", quoteCurrency: "USD" });
    await expect(editExchangeRate("rate-1", formData({ rate: "1.20" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?msg=rate-updated",
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "rate-1" }, data: expect.objectContaining({ rate: "1.20" }) }),
    );
    const updateData = mockUpdate.mock.calls[0][0].data;
    expect(updateData.baseCurrency).toBeUndefined();
    expect(updateData.quoteCurrency).toBeUndefined();
  });

  it("2: a client-submitted baseCurrency in the form is ignored - it is never read", async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: "rate-1", baseCurrency: "EUR", quoteCurrency: "USD" });
    await expect(
      editExchangeRate("rate-1", formData({ baseCurrency: "USD", rate: "1.20" })),
    ).rejects.toThrow("REDIRECT:");
    expect(mockUpdate.mock.calls[0][0].data.baseCurrency).toBeUndefined();
  });

  it("10: defensively rejects editing a legacy row that is not EUR-based (via redirect+err, not a raw throw)", async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: "rate-legacy", baseCurrency: "USD", quoteCurrency: "EUR" });
    await expect(editExchangeRate("rate-legacy", formData({ rate: "1.20" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?err=",
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("11: rejects a zero/negative rate on edit", async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ id: "rate-1", baseCurrency: "EUR", quoteCurrency: "USD" });
    await expect(editExchangeRate("rate-1", formData({ rate: "0" }))).rejects.toThrow(
      "REDIRECT:/exchange-rates?err=",
    );
  });
});
