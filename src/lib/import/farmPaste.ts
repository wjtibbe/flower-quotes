/**
 * Pure helper for the bulk supplier (farm) paste-import. Kept free of Prisma so
 * the column parsing can be unit-tested and reused by the server action.
 *
 * Accepted per line (Tab-separated, as pasted from Excel):
 *   Land <TAB> Naam        (two columns)
 *   Naam                   (one column - the shared default country is used)
 */

export interface FarmPasteRow {
  name: string;
  country: string;
}

/** True for a header line like "Land<TAB>Naam" / "Land<TAB>Leverancier". */
export function isFarmHeaderRow(line: string): boolean {
  const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim().toLowerCase());
  const first = cols[0];
  const second = cols[1] ?? "";
  return first === "land" || (["naam", "leverancier", "kweker"].includes(first) && second === "");
}

/**
 * Parses one pasted line into { name, country }, or null when unusable. When a
 * line has a single column the shared `defaultCountry` is applied; a two-column
 * line is "Land<TAB>Naam". Tab is preferred; a comma fallback covers CSV pastes.
 */
export function parseFarmRow(line: string, defaultCountry: string): FarmPasteRow | null {
  const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
  let country: string;
  let name: string;
  if (cols.length >= 2) {
    country = cols[0];
    name = cols.slice(1).join(" ").trim();
  } else {
    country = "";
    name = cols[0] ?? "";
  }
  country = country || defaultCountry.trim();
  if (!name || !country) return null;
  return { name, country };
}
