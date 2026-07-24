import { describe, expect, it } from "vitest";
import {
  isNavLeafActive,
  isNavSection,
  isNavSectionActive,
  mostSpecificActiveHref,
  type NavEntry,
} from "../navSections";

describe("isNavLeafActive", () => {
  it("matches an exact pathname", () => {
    expect(isNavLeafActive("/farms", "/farms")).toBe(true);
  });
  it("matches a sub-route", () => {
    expect(isNavLeafActive("/farms/new", "/farms")).toBe(true);
  });
  it("does not match an unrelated route that merely shares a prefix", () => {
    expect(isNavLeafActive("/farms-other", "/farms")).toBe(false);
  });
  it("does not match a sibling route", () => {
    expect(isNavLeafActive("/products", "/farms")).toBe(false);
  });
});

describe("isNavSection / isNavLeafActive discrimination", () => {
  it("distinguishes a section (has children) from a leaf", () => {
    const leaf: NavEntry = { href: "/dashboard", label: "Dashboard" };
    const section: NavEntry = { label: "Assortiment", children: [{ href: "/products", label: "Overzicht" }] };
    expect(isNavSection(leaf)).toBe(false);
    expect(isNavSection(section)).toBe(true);
  });
});

describe("isNavSectionActive", () => {
  const assortiment = {
    label: "Assortiment",
    children: [
      { href: "/products", label: "Overzicht" },
      { href: "/products/new", label: "Product toevoegen" },
      { href: "/products/bulk", label: "Bulk toevoegen" },
    ],
  };

  it("is active when the pathname matches the overview leaf", () => {
    expect(isNavSectionActive("/products", assortiment)).toBe(true);
  });
  it("is active when the pathname matches a sub-page leaf", () => {
    expect(isNavSectionActive("/products/bulk", assortiment)).toBe(true);
  });
  it("is not active for an unrelated route", () => {
    expect(isNavSectionActive("/farms", assortiment)).toBe(false);
  });
});

describe("mostSpecificActiveHref", () => {
  const entries: NavEntry[] = [
    { href: "/dashboard", label: "Dashboard" },
    {
      label: "Assortiment",
      children: [
        { href: "/products", label: "Overzicht" },
        { href: "/products/new", label: "Product toevoegen" },
        { href: "/products/bulk", label: "Bulk toevoegen" },
      ],
    },
    {
      label: "Leveranciers",
      children: [
        { href: "/farms", label: "Overzicht" },
        { href: "/farms/new", label: "Nieuwe leverancier" },
        { href: "/farms/bulk", label: "Bulk import" },
      ],
    },
  ];

  it("picks the longer, more specific href over its own parent overview href", () => {
    expect(mostSpecificActiveHref("/products/new", entries)).toBe("/products/new");
  });

  it("picks the overview href when on the bare overview route", () => {
    expect(mostSpecificActiveHref("/products", entries)).toBe("/products");
  });

  it("never cross-highlights a sibling section's leaf", () => {
    expect(mostSpecificActiveHref("/farms/bulk", entries)).toBe("/farms/bulk");
    expect(mostSpecificActiveHref("/farms/bulk", entries)).not.toBe("/products/bulk");
  });

  it("returns null when nothing matches", () => {
    expect(mostSpecificActiveHref("/settings", entries)).toBeNull();
  });

  it("resolves every configured leaf href for a deep sub-route", () => {
    expect(mostSpecificActiveHref("/products/new/anything", entries)).toBe("/products/new");
  });
});
