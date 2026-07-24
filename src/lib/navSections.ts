/** One flat navigation link. */
export interface NavLeaf {
  href: string;
  label: string;
}

/** An expandable group of related links (e.g. "Assortiment" -> Overzicht/Product toevoegen/Bulk toevoegen). */
export interface NavSection {
  label: string;
  children: NavLeaf[];
}

export type NavEntry = NavLeaf | NavSection;

export function isNavSection(entry: NavEntry): entry is NavSection {
  return "children" in entry;
}

/**
 * A leaf is "active" for the current pathname when it's an exact match, or
 * the pathname is a sub-route of it (e.g. `/farms/new` under `/farms`) -
 * except the leaf `/farms` itself must not swallow `/farms/new`'s OWN more
 * specific leaf being active too; both can be simultaneously "active" by this
 * rule (a sub-route highlights its own submenu item, not the parent
 * Overzicht item) - callers needing the single most-specific match should use
 * `mostSpecificActiveHref`.
 */
export function isNavLeafActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/**
 * Of every leaf href across all entries, returns the LONGEST one that
 * matches the current pathname (most specific wins) - so `/farms/new` lights
 * up "Nieuwe leverancier", never also "Overzicht" (`/farms`), even though
 * both hrefs technically satisfy `isNavLeafActive`.
 */
export function mostSpecificActiveHref(pathname: string, entries: readonly NavEntry[]): string | null {
  const allHrefs = entries.flatMap((e) => (isNavSection(e) ? e.children.map((c) => c.href) : [e.href]));
  const matches = allHrefs.filter((href) => isNavLeafActive(pathname, href));
  if (matches.length === 0) return null;
  return matches.reduce((longest, href) => (href.length > longest.length ? href : longest));
}

/** A section is active when its most-specific active leaf lives inside it - used to auto-expand the right group on load. */
export function isNavSectionActive(pathname: string, section: NavSection): boolean {
  return section.children.some((c) => isNavLeafActive(pathname, c.href));
}
