import { normalizeDecimalString, parseLengthCm } from "./normalize";
import type { ParsedOfferLine } from "./types";

/**
 * Deterministic support for the confirmed "length range + shared price table"
 * business rule (see the chunked-extraction spec). A supplier document in this
 * pattern lists product rows whose length is either a single value ("80cm") or
 * a RANGE ("40-60cm"), and prices them not on the row itself but through one
 * shared, discrete price table at the top or bottom of the document, e.g.:
 *
 *     40 cm 0.16
 *     50 cm 0.18
 *     60 cm 0.22
 *     70 cm 0.28
 *
 * The model (see `provider.ts`) is instructed to copy such a range VERBATIM
 * into `length` and to leave `fobPricePerStem` null for these rows - it never
 * expands ranges or reads prices out of the table itself. All of that happens
 * here, deterministically, so the behavior is pure, fully unit-testable and
 * identical every run:
 *
 *   "2hb Alert 40-60cm"  + table above  ->  three lines
 *       Alert | 40cm | qty 2 | HB | 0.16
 *       Alert | 50cm | qty 2 | HB | 0.18
 *       Alert | 60cm | qty 2 | HB | 0.22
 *
 * Quantity and packaging REPEAT unchanged for every length (never divided
 * across the range). The original supplier row is preserved verbatim as
 * `rawText` on every expanded line (critical for auditability and
 * `SupplierLineMapping`); a synthetic per-length string is never substituted.
 * A single length ("1qb be sweet 80cm") stays exactly one line; when the table
 * has no tier for a required length the price is left null and a
 * `parserWarning` is added - never an extrapolation or interpolation.
 *
 * Everything in this module is pure and database-independent. It is a no-op
 * for any document WITHOUT a shared price table (the common case), so it can
 * be run unconditionally on every text import without changing existing
 * behavior.
 */

export interface PriceTier {
  /** Stem length in whole centimeters. */
  lengthCm: number;
  /** Canonical decimal price string (dot separator), never a float. */
  fobPricePerStem: string;
}

export type LengthSpec =
  | { kind: "single"; cm: number }
  | { kind: "range"; min: number; max: number }
  | { kind: "none" };

// A whole line that maps ONE length to ONE price, e.g. "40 cm 0.16",
// "40cm 0.16", "70 cm 0.28 USD". Requires the "cm" marker and a numeric price
// so an ordinary product row ("Dallas 60cm 0.38", "2hb Alert 40-60cm") is
// never misread as a price tier - the product name/box code breaks the match.
const PRICE_TIER_RE =
  /^\s*(\d{1,3})\s*cm\b\s*[:=]?\s*[$€]?\s*(\d+(?:[.,]\d+)?)\s*(?:usd|eur|\$|€)?\s*$/i;

/**
 * Parses a single physical line as a shared-price-table tier, or returns null
 * when the line is not a price tier. Pure; also reused by the chunker to
 * classify "type C" (shared commercial context) lines.
 */
export function parsePriceTierLine(line: string): PriceTier | null {
  const m = line.match(PRICE_TIER_RE);
  if (!m) return null;
  const lengthCm = parseInt(m[1], 10);
  if (!Number.isFinite(lengthCm) || lengthCm <= 0) return null;
  const fobPricePerStem = normalizeDecimalString(m[2]);
  if (!fobPricePerStem) return null;
  return { lengthCm, fobPricePerStem };
}

/**
 * Scans the whole source text for a shared price table (each tier on its own
 * line), returning the tiers sorted ascending by length and de-duplicated by
 * length (last occurrence wins). Returns an empty array when the document has
 * no such table - the signal that no deterministic range expansion applies.
 */
export function parseSharedPriceTable(text: string): PriceTier[] {
  const byLength = new Map<number, string>();
  for (const line of text.split(/\r?\n/)) {
    const tier = parsePriceTierLine(line);
    if (tier) byLength.set(tier.lengthCm, tier.fobPricePerStem);
  }
  return [...byLength.entries()]
    .map(([lengthCm, fobPricePerStem]) => ({ lengthCm, fobPricePerStem }))
    .sort((a, b) => a.lengthCm - b.lengthCm);
}

// Two lengths separated by a dash (or en/em dash, slash, "to", Spanish "a"),
// e.g. "40-60cm", "40 - 60 cm", "70/80", "40 to 60". Operates on the narrow
// `length` field only, so the loose separators are safe here.
const LENGTH_RANGE_RE =
  /(\d{1,3}(?:[.,]\d+)?)\s*(?:-|–|—|\/|\bto\b|\ba\b)\s*(\d{1,3}(?:[.,]\d+)?)/i;

/**
 * Classifies a raw length field as a single length, a range, or unparseable.
 * A range needs two distinct numbers; "40-40" or a lone number is `single`,
 * anything without a number is `none`.
 */
export function parseLengthSpec(raw: string | null | undefined): LengthSpec {
  if (!raw) return { kind: "none" };
  const rangeMatch = raw.match(LENGTH_RANGE_RE);
  if (rangeMatch) {
    const a = parseLengthCm(rangeMatch[1]);
    const b = parseLengthCm(rangeMatch[2]);
    if (a !== null && b !== null && a !== b) {
      return { kind: "range", min: Math.min(a, b), max: Math.max(a, b) };
    }
  }
  const single = parseLengthCm(raw);
  if (single !== null) return { kind: "single", cm: single };
  return { kind: "none" };
}

// Conservative range detector for a FULL supplier row (rawText), used by the
// mapping-safety guards. Requires two 2-3 digit numbers joined by a dash, with
// an optional trailing "cm" - i.e. exactly how these documents write a length
// range ("40-60cm", "70-80 cm", "40-60"). Deliberately stricter than
// `LENGTH_RANGE_RE` (no slash / "to" / "a") so an ordinary row is never
// misflagged as ranged.
const RAWTEXT_LENGTH_RANGE_RE = /\b(\d{2,3})\s*[-–—]\s*(\d{2,3})\s*(?:cm)?\b/i;

/**
 * Whether a full supplier row contains a length RANGE (e.g. "2hb Alert
 * 40-60cm"). Such a row is expanded across several lengths - and therefore
 * several packaging/weight profiles - so it must never be saved as a single
 * `SupplierLineMapping` (one source -> one profile). Pure and
 * database-independent; used by the mapping-safety guards.
 */
export function hasLengthRange(rawText: string | null | undefined): boolean {
  if (!rawText) return false;
  const m = rawText.match(RAWTEXT_LENGTH_RANGE_RE);
  if (!m) return false;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  return Number.isFinite(a) && Number.isFinite(b) && a !== b;
}

/**
 * Whether `warning` is the AI's own explanation for THIS line's price being
 * unresolved because of its length range/table dependency (the model's
 * system prompt instructs it to explain a null field via `parserWarnings` -
 * see `TEXT_STRUCTURE_INSTRUCTIONS` in `provider.ts`). Deliberately narrow:
 * only matches a warning that names the EXACT length spec text as written on
 * this row (e.g. "40-60cm") together with a price-related word - so it can
 * never accidentally drop an unrelated, still-genuine warning.
 */
function isObsoleteRangePriceWarning(warning: string, lengthSpecText: string): boolean {
  const w = warning.toLowerCase();
  return w.includes(lengthSpecText.toLowerCase()) && /prijs|price/.test(w);
}

/**
 * Drops a now-stale "price depends on the range/table" warning once THIS
 * expanded child line's price has actually been resolved - see
 * `isObsoleteRangePriceWarning`. Every other warning (genuinely unresolved
 * ones, unrelated field warnings) passes through unchanged.
 */
function dropObsoleteRangeWarnings(warnings: readonly string[], lengthSpecText: string): string[] {
  return warnings.filter((w) => !isObsoleteRangePriceWarning(w, lengthSpecText));
}

function appendWarnings(line: ParsedOfferLine, warnings: string[]): ParsedOfferLine {
  if (warnings.length === 0) return line;
  return {
    ...line,
    parserWarnings: [...line.parserWarnings, ...warnings],
    needsReview: true,
  };
}

/**
 * Expands every length-range row against a shared price table (the business
 * rule documented at the top of this file). A no-op when `priceTable` is empty
 * - so it is safe to call on every text import; only documents that actually
 * carry a shared price table are ever transformed.
 *
 * Rules, applied deterministically per source line:
 *  - RANGE ("40-60cm"): one output line per price-table tier whose length
 *    falls inside the inclusive [min, max] range, each carrying that tier's
 *    price. Quantity/packaging repeat unchanged; `rawText` stays the original
 *    row verbatim. If a range endpoint has no tier, a warning is added (no
 *    interpolation). A range that covers no tier at all yields one line with a
 *    warning and a null price.
 *  - SINGLE ("80cm"): stays exactly one line. If the row has no explicit price
 *    of its own, the table's tier for that length fills it in; when the table
 *    has no tier for that length the price is left null and a warning is added.
 *  - NONE (no readable length): passed through unchanged.
 */
export function applyLengthRangeExpansion(
  lines: ParsedOfferLine[],
  priceTable: PriceTier[],
): ParsedOfferLine[] {
  if (priceTable.length === 0) return lines;

  const priceByLength = new Map(priceTable.map((t) => [t.lengthCm, t.fobPricePerStem]));
  const result: ParsedOfferLine[] = [];

  for (const line of lines) {
    const specSource = line.lengthRaw ?? (line.lengthCm != null ? String(line.lengthCm) : undefined);
    const spec = parseLengthSpec(specSource);

    if (spec.kind === "range") {
      const tiers = priceTable.filter((t) => t.lengthCm >= spec.min && t.lengthCm <= spec.max);

      // Warn about explicitly-stated range endpoints that have no tier (a real
      // pricing gap the reviewer must see) - never invent/interpolate one.
      const endpointWarnings: string[] = [];
      for (const endpoint of [spec.min, spec.max]) {
        if (!priceByLength.has(endpoint)) {
          endpointWarnings.push(
            `Lengte ${endpoint}cm uit de range "${specSource}" heeft geen prijstrede in de gedeelde prijstabel - controleer handmatig.`,
          );
        }
      }

      if (tiers.length === 0) {
        result.push(
          appendWarnings({ ...line, lengthCm: undefined, fobPricePerStem: undefined }, [
            `Lengterange "${specSource}" valt volledig buiten de gedeelde prijstabel - er kon geen prijs worden bepaald.`,
          ]),
        );
        continue;
      }

      // This length now has a resolved price - any AI-authored warning that
      // was only explaining the (now-resolved) range/price dependency for
      // THIS row is dropped so it doesn't linger as stale on every expanded
      // child (genuinely unrelated warnings are left untouched).
      const carriedWarnings = dropObsoleteRangeWarnings(line.parserWarnings, specSource!);

      tiers.forEach((tier, idx) => {
        // Endpoint warnings are attached once (to the first expanded line) so
        // they aren't duplicated across every expanded length.
        const base: ParsedOfferLine = {
          ...line,
          parserWarnings: carriedWarnings,
          lengthCm: tier.lengthCm,
          fobPricePerStem: tier.fobPricePerStem,
        };
        result.push(idx === 0 ? appendWarnings(base, endpointWarnings) : base);
      });
      continue;
    }

    if (spec.kind === "single") {
      const next: ParsedOfferLine = { ...line, lengthCm: spec.cm };
      if (!next.fobPricePerStem) {
        const tablePrice = priceByLength.get(spec.cm);
        if (tablePrice) {
          next.fobPricePerStem = tablePrice;
          next.parserWarnings = dropObsoleteRangeWarnings(next.parserWarnings, specSource!);
        } else {
          result.push(
            appendWarnings(next, [
              `Lengte ${spec.cm}cm komt niet voor in de gedeelde prijstabel - de prijs kon niet worden afgeleid.`,
            ]),
          );
          continue;
        }
      }
      result.push(next);
      continue;
    }

    result.push(line);
  }

  return result;
}
