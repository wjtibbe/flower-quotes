import { describe, expect, it } from "vitest";
import { blockedDeleteMessage } from "../deletionMessage";

describe("blockedDeleteMessage", () => {
  it("returns null when nothing references the record", () => {
    expect(blockedDeleteMessage("Deze leverancier", [{ count: 0, label: "assortimentregel(s)" }])).toBeNull();
    expect(blockedDeleteMessage("Deze klant", [])).toBeNull();
  });

  it("lists the single blocker with its count", () => {
    expect(blockedDeleteMessage("Deze leverancier", [{ count: 128, label: "assortimentregel(s)" }])).toBe(
      "Deze leverancier kan niet worden verwijderd omdat deze nog wordt gebruikt door 128 assortimentregel(s).",
    );
  });

  it("joins multiple blockers and skips zero-count ones", () => {
    const msg = blockedDeleteMessage("Deze leverancier", [
      { count: 3, label: "assortimentregel(s)" },
      { count: 0, label: "offerteregel(s)" },
      { count: 2, label: "leveranciersaanbieding(en)" },
    ]);
    expect(msg).toBe(
      "Deze leverancier kan niet worden verwijderd omdat deze nog wordt gebruikt door 3 assortimentregel(s), 2 leveranciersaanbieding(en).",
    );
  });
});
