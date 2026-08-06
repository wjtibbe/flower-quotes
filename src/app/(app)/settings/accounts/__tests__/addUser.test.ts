import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRedirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed") } }));

const mockUserCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { create: (...a: unknown[]) => mockUserCreate(...a) },
  },
}));

const { addUser } = await import("../actions");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserCreate.mockResolvedValue({ id: "user-new" });
});

describe("addUser - required field validation (regression: used to throw uncaught, crashing the page with a 500 instead of the friendly /settings?err= banner)", () => {
  it("rejects a missing name via redirect+err instead of throwing", async () => {
    await expect(addUser(formData({ email: "a@b.com", password: "longenough" }))).rejects.toThrow(
      "REDIRECT:/settings/accounts?err=",
    );
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing email via redirect+err instead of throwing", async () => {
    await expect(addUser(formData({ name: "Jan", password: "longenough" }))).rejects.toThrow(
      "REDIRECT:/settings/accounts?err=",
    );
  });

  it("rejects a password shorter than 8 characters via redirect+err instead of throwing", async () => {
    await expect(addUser(formData({ name: "Jan", email: "a@b.com", password: "short" }))).rejects.toThrow(
      "REDIRECT:/settings/accounts?err=",
    );
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("creates the user when all fields are valid", async () => {
    await addUser(formData({ name: "Jan", email: "a@b.com", password: "longenough" }));
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Jan", email: "a@b.com" }) }),
    );
  });

  it("rejects a duplicate email via redirect+err instead of an uncaught database error", async () => {
    mockUserCreate.mockRejectedValue(new Error("Unique constraint failed on the fields: (`email`)"));
    await expect(addUser(formData({ name: "Jan", email: "dup@b.com", password: "longenough" }))).rejects.toThrow(
      "REDIRECT:/settings/accounts?err=",
    );
  });
});
