/**
 * Stable matching key for a supplier line mapping (section 3). Deliberately
 * a MUCH lighter-touch normalization than `normalizeForMatching` in
 * `lib/import/normalize.ts` (used for fuzzy alias matching): this key must
 * make trivial formatting differences (leading/trailing whitespace, extra
 * spaces, tabs, line endings, casing, accents) collapse to the same value,
 * while NEVER touching anything that could change the line's actual
 * meaning - numbers, decimal points, box codes and other punctuation are
 * kept exactly as typed. Two lines that differ only in stem length or price
 * MUST still normalize to two different keys (e.g. "Dallas 60cm 0.38" vs
 * "Dallas 70cm 0.38" vs "Dallas 60cm 0.40" are all distinct) - this is why
 * punctuation/digits are never stripped here, unlike the fuzzy-matching
 * normalizer.
 */
export function normalizeSupplierMappingSource(rawSource: string): string {
  return rawSource
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents (safe Unicode normalization, never touches ASCII digits/punctuation)
    .replace(/\r\n?/g, "\n") // normalize line endings
    .replace(/[\t\n]/g, " ") // tabs/newlines become plain spaces, joined below
    .toLowerCase()
    .replace(/\s+/g, " ") // collapse any run of whitespace to one space
    .trim();
}
