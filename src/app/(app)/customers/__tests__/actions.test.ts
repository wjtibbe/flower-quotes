import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockCustomerCreate = vi.fn();
const mockCustomerUpdate = vi.fn();
const mockCustomerDestinationFindUniqueOrThrow = vi.fn();
const mockTransaction = vi.fn((cb: (tx: unknown) => unknown) => (typeof cb === "function" ? cb({}) : Promise.all(cb as unknown[])));

vi.mock("@/lib/db", () => ({
  prisma: {
    customer: {
      create: (...a: unknown[]) => mockCustomerCreate(...a),
      update: (...a: unknown[]) => mockCustomerUpdate(...a),
    },
    customerDestination: {
      findUniqueOrThrow: (...a: unknown[]) => mockCustomerDestinationFindUniqueOrThrow(...a),
    },
    $transaction: (arg: unknown) => mockTransaction(arg as never),
  },
}));

const { saveCustomer, addCustomerDestination, setDefaultCustomerDestination } = await import("../actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation((cb: unknown) =>
    typeof cb === "function" ? (cb as (tx: unknown) => unknown)({ customer: { create: mockCustomerCreate }, customerDestination: { create: vi.fn() } }) : Promise.resolve(),
  );
});

describe("saveCustomer - required field validation (regression: used to throw uncaught, crashing the page with a 500 instead of the friendly /customers?err= banner)", () => {
  it("rejects a missing company name via redirect+err instead of throwing", async () => {
    await expect(saveCustomer(formData({}))).rejects.toThrow("REDIRECT:/customers?err=");
  });

  it("rejects a whitespace-only company name the same way", async () => {
    await expect(saveCustomer(formData({ companyName: "   " }))).rejects.toThrow("REDIRECT:/customers?err=");
  });

  it("rejects a new customer with no destinationId via redirect+err", async () => {
    await expect(saveCustomer(formData({ companyName: "Acme Flowers" }))).rejects.toThrow(
      "REDIRECT:/customers?err=",
    );
  });

  it("editing an existing customer (id present) does not require a destinationId", async () => {
    mockCustomerUpdate.mockResolvedValue({ id: "cust-1" });
    await saveCustomer(formData({ id: "cust-1", companyName: "Acme Flowers" }));
    expect(mockCustomerUpdate).toHaveBeenCalled();
  });
});

describe("addCustomerDestination - required field validation", () => {
  it("rejects a missing destinationId via redirect+err instead of throwing", async () => {
    await expect(addCustomerDestination("cust-1", formData({}))).rejects.toThrow(
      "REDIRECT:/customers?err=",
    );
  });
});

describe("setDefaultCustomerDestination - cross-customer guard", () => {
  it("rejects a destination link that belongs to a different customer via redirect+err instead of throwing", async () => {
    mockCustomerDestinationFindUniqueOrThrow.mockResolvedValue({ id: "link-1", customerId: "other-customer", destinationId: "dest-1" });
    await expect(setDefaultCustomerDestination("cust-1", "link-1")).rejects.toThrow(
      "REDIRECT:/customers?err=",
    );
  });
});
