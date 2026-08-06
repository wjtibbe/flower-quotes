"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { isNavSection, isNavSectionActive, mostSpecificActiveHref, type NavEntry, type NavSection } from "@/lib/navSections";

// Assortiment, Leveranciers and Instellingen each expand into their own
// sub-pages; Routes & vracht stays a single flat link since everything is
// managed in-place on that one page, so a second nav-only page would be a
// fake duplicate route. Instellingen's children are the settings submenu -
// they only ever appear here, never duplicated inside the settings pages
// themselves.
export const ENTRIES: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/farm-offers", label: "Leveranciersaanbiedingen" },
  { href: "/quotes", label: "Offertes" },
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
  { href: "/routes", label: "Routes & vracht" },
  { href: "/customers", label: "Klanten" },
  {
    label: "Instellingen",
    children: [
      { href: "/settings", label: "Algemeen" },
      { href: "/settings/accounts", label: "Accountbeheer" },
      { href: "/settings/additional-cost-types", label: "Aanvullende kostensoorten" },
      { href: "/settings/exchange-rates", label: "Wisselkoersen" },
    ],
  },
];

export default function Nav({ userName }: { userName: string }) {
  const pathname = usePathname();
  const activeHref = mostSpecificActiveHref(pathname, ENTRIES);
  // Sections the user explicitly toggled this session, overriding the
  // auto-expand-if-active default below (a section with the active page
  // inside it starts open; the user can still collapse it manually).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  function isExpanded(section: NavSection) {
    const forced = toggled[section.label];
    if (forced !== undefined) return forced;
    return isNavSectionActive(pathname, section);
  }

  return (
    <nav className="w-64 shrink-0 bg-brand-900 text-brand-50 flex flex-col">
      <div className="px-4 py-5 border-b border-brand-800">
        <div className="font-semibold text-lg">Flower Quotes</div>
        <div className="text-xs text-brand-300 mt-0.5">{userName}</div>
      </div>
      <ul className="flex-1 overflow-y-auto py-2">
        {ENTRIES.map((entry) => {
          if (!isNavSection(entry)) {
            const active = entry.href === activeHref;
            return (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  className={`block px-4 py-2 text-sm ${
                    active ? "bg-brand-700 text-white" : "text-brand-100 hover:bg-brand-800"
                  }`}
                >
                  {entry.label}
                </Link>
              </li>
            );
          }

          const expanded = isExpanded(entry);
          const sectionActive = isNavSectionActive(pathname, entry);
          return (
            <li key={entry.label}>
              <button
                type="button"
                onClick={() => setToggled((prev) => ({ ...prev, [entry.label]: !expanded }))}
                aria-expanded={expanded}
                className={`w-full flex items-center justify-between px-4 py-2 text-sm text-left ${
                  sectionActive && !expanded ? "bg-brand-800 text-white" : "text-brand-100 hover:bg-brand-800"
                }`}
              >
                <span>{entry.label}</span>
                <span className={`text-xs transition-transform ${expanded ? "rotate-90" : ""}`}>›</span>
              </button>
              {expanded && (
                <ul>
                  {entry.children.map((child) => {
                    const active = child.href === activeHref;
                    return (
                      <li key={child.href}>
                        <Link
                          href={child.href}
                          className={`block pl-8 pr-4 py-1.5 text-sm ${
                            active ? "bg-brand-700 text-white" : "text-brand-200 hover:bg-brand-800"
                          }`}
                        >
                          {child.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-3 border-t border-brand-800">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-sm text-brand-200 hover:text-white"
        >
          Uitloggen
        </button>
      </div>
    </nav>
  );
}
