import { describe, expect, it } from "vitest";
import { isNavSection, isNavSectionActive, mostSpecificActiveHref } from "@/lib/navSections";
import { ENTRIES } from "../Nav";

const settingsSection = ENTRIES.find((e) => "label" in e && e.label === "Instellingen");

describe("Nav - settings submenu structure", () => {
  it("12/13/14/15: Instellingen expands into Algemeen, Accountbeheer, Aanvullende kostensoorten and Wisselkoersen", () => {
    expect(settingsSection && isNavSection(settingsSection)).toBe(true);
    if (!settingsSection || !isNavSection(settingsSection)) throw new Error("unreachable");
    expect(settingsSection.children).toEqual([
      { href: "/settings", label: "Algemeen" },
      { href: "/settings/accounts", label: "Accountbeheer" },
      { href: "/settings/additional-cost-types", label: "Aanvullende kostensoorten" },
      { href: "/settings/exchange-rates", label: "Wisselkoersen" },
    ]);
  });

  it("16: there is no top-level Wisselkoersen link outside the Instellingen submenu", () => {
    const topLevelHrefs = ENTRIES.filter((e) => !("children" in e)).map((e) => (e as { href: string }).href);
    expect(topLevelHrefs).not.toContain("/exchange-rates");
    // Confirm it only lives inside the submenu, not duplicated anywhere else.
    const allChildHrefs = ENTRIES.flatMap((e) => ("children" in e ? e.children.map((c) => c.href) : []));
    expect(allChildHrefs.filter((h) => h === "/settings/exchange-rates")).toHaveLength(1);
  });

  it("B6: settings links are not duplicated at the top level", () => {
    const topLevelHrefs = ENTRIES.filter((e) => !("children" in e)).map((e) => (e as { href: string }).href);
    for (const href of ["/settings", "/settings/accounts", "/settings/additional-cost-types", "/settings/exchange-rates"]) {
      expect(topLevelHrefs).not.toContain(href);
    }
  });

  it("21: /settings/accounts resolves as the most specific active link, not /settings (Algemeen)", () => {
    expect(mostSpecificActiveHref("/settings/accounts", ENTRIES)).toBe("/settings/accounts");
  });

  it("21: /settings alone resolves to Algemeen only", () => {
    expect(mostSpecificActiveHref("/settings", ENTRIES)).toBe("/settings");
  });

  it("B1: the Instellingen section is recognized as active (and so stays expanded) for every settings sub-route", () => {
    if (!settingsSection || !isNavSection(settingsSection)) throw new Error("unreachable");
    for (const path of ["/settings", "/settings/accounts", "/settings/additional-cost-types", "/settings/exchange-rates"]) {
      expect(isNavSectionActive(path, settingsSection)).toBe(true);
    }
  });
});
