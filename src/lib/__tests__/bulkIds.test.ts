import { describe, it, expect } from "vitest";
import { normalizeBulkIds, MAX_BULK } from "@/lib/bulkIds";

describe("normalizeBulkIds", () => {
  it("rejects an empty selection", () => {
    expect(normalizeBulkIds([])).toEqual({ error: "Niets geselecteerd." });
  });

  it("drops empty strings and rejects when nothing is left", () => {
    expect(normalizeBulkIds(["", ""])).toEqual({ error: "Niets geselecteerd." });
  });

  it("drops empty strings but keeps the real ids", () => {
    expect(normalizeBulkIds(["", "a", ""])).toEqual({ ids: ["a"] });
  });

  it("de-duplicates ids", () => {
    const res = normalizeBulkIds(["a", "a", "b"]);
    expect(res).toEqual({ ids: ["a", "b"] });
  });

  it("keeps a clean selection unchanged", () => {
    expect(normalizeBulkIds(["x", "y", "z"])).toEqual({ ids: ["x", "y", "z"] });
  });

  it("enforces the bulk ceiling", () => {
    const many = Array.from({ length: MAX_BULK + 1 }, (_, i) => `id-${i}`);
    const res = normalizeBulkIds(many);
    expect(res).toHaveProperty("error");
  });

  it("allows exactly the ceiling", () => {
    const many = Array.from({ length: MAX_BULK }, (_, i) => `id-${i}`);
    expect(normalizeBulkIds(many)).toHaveProperty("ids");
  });
});
