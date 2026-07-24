import { describe, expect, it } from "vitest";
import { buildAssortmentPageHref } from "../assortmentPageLinks";

describe("buildAssortmentPageHref", () => {
  it("builds a bare page link with no active filters", () => {
    expect(buildAssortmentPageHref({}, 2)).toBe("/products?page=2");
  });

  it("31: preserves every active filter/search param when navigating to another page", () => {
    const href = buildAssortmentPageHref({ farmId: "farm-1", variety: "Freedom", q: "abc", pageSize: "25" }, 3);
    const params = new URLSearchParams(href.split("?")[1]);
    expect(params.get("farmId")).toBe("farm-1");
    expect(params.get("variety")).toBe("Freedom");
    expect(params.get("q")).toBe("abc");
    expect(params.get("pageSize")).toBe("25");
    expect(params.get("page")).toBe("3");
  });

  it("omits params that are not set", () => {
    const href = buildAssortmentPageHref({ farmId: "farm-1" }, 1);
    expect(href).toBe("/products?farmId=farm-1&page=1");
  });
});
