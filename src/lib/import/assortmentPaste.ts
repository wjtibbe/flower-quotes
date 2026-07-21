/**
 * Pure helpers for the multi-supplier assortment paste-import. Kept free of
 * Prisma/React so the column parsing, the "Inkoop Artikel" -> product/variety
 * split and the fuzzy supplier matching can be unit-tested directly and reused
 * by the server action.
 *
 * Expected paste columns (Tab-separated, one variety per line), matching the
 * supplier's own export:
 *   Leverancier <TAB> Inkoop Artikel <TAB> Lengte <TAB> Doos <TAB> Stelen/doos <TAB> KG/doos
 */

export interface AssortmentPasteRow {
  supplierName: string;
  article: string;
  stemLength: string | null;
  boxType: string;
  stemsPerBox: number;
  weightPerBoxKg: string;
}

/** True for a header line like "Leverancier<TAB>Inkoop Artikel<TAB>...". */
export function isHeaderRow(line: string): boolean {
  const first = (line.includes("\t") ? line.split("\t") : line.split(","))[0]?.trim().toLowerCase();
  return first === "leverancier";
}

/**
 * Parses one pasted line into a row, or null when it is unusable (too few
 * columns, missing supplier/article, non-positive stems, or missing weight).
 * Tab-separated is preferred; a comma fallback covers CSV pastes.
 */
export function parseAssortmentPasteRow(line: string): AssortmentPasteRow | null {
  const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
  if (cols.length < 6) return null;
  const [supplierName, article, stemLength, boxType, stems, weight] = cols;
  const stemsPerBox = parseInt(stems, 10);
  if (!supplierName || !article || !Number.isFinite(stemsPerBox) || stemsPerBox <= 0 || !weight) return null;
  return {
    supplierName,
    article,
    stemLength: stemLength || null,
    boxType: boxType || "QB",
    stemsPerBox,
    weightPerBoxKg: weight,
  };
}

/**
 * Splits an "Inkoop Artikel" into a central product name and a variety.
 * "Dianthus St/Sp/Solomio/Spray X" -> product "Dianthus <type>", variety "X",
 * so Dianthus St and Dianthus Sp are separate central products (per the user's
 * choice). Anything else -> first word is the product, the rest the variety
 * (e.g. "Inirida Summer" -> "Inirida" / "Summer"). Returns null when there is
 * no variety left (a bare product name).
 */
export function splitArticle(article: string): { productName: string; variety: string } | null {
  const tokens = article.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  if (tokens[0].toLowerCase() === "dianthus" && tokens.length >= 3) {
    return { productName: `${tokens[0]} ${tokens[1]}`, variety: tokens.slice(2).join(" ") };
  }
  return { productName: tokens[0], variety: tokens.slice(1).join(" ") };
}

// Corporate/legal tokens dropped before comparing supplier names, so
// "La Gaitana Farms S.A.S." matches an existing "La Gaitana Farms".
const LEGAL_TOKENS = new Set(["ci", "sas", "sa", "ltda", "cia", "eu", "inc", "corp", "s", "a", "c", "i"]);

/** Lower-cased, accent- and punctuation-stripped name with legal tokens removed. */
export function normalizeFarmName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining accents
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !LEGAL_TOKENS.has(t))
    .join(" ")
    .trim();
}

/**
 * Finds the existing farm that best matches a pasted supplier name, tolerant of
 * legal suffixes/punctuation differences ("goed zoeken"): exact normalized
 * match first, then a whole-name containment either way. Returns null when
 * nothing matches - the caller reports it instead of inventing a supplier.
 */
export function matchFarm<T extends { id: string; name: string }>(farms: T[], rawName: string): T | null {
  const target = normalizeFarmName(rawName);
  if (!target) return null;
  const exact = farms.find((f) => normalizeFarmName(f.name) === target);
  if (exact) return exact;
  return (
    farms.find((f) => {
      const fn = normalizeFarmName(f.name);
      return fn !== "" && (fn.includes(target) || target.includes(fn));
    }) ?? null
  );
}
