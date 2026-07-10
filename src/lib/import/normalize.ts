/**
 * Normalize a price/number string that may use a comma OR a dot as the
 * decimal separator (farms are inconsistent - see spec section 3/24), and
 * may use the other character as a thousands separator. Returns a canonical
 * decimal string (dot separator) suitable for `new Decimal(...)`, or null if
 * the input can't be parsed as a number at all.
 */
export function normalizeDecimalString(input: string): string | null {
  let s = input.trim().replace(/[^0-9.,]/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever separator appears last is the decimal separator; the other is
    // a thousands separator and gets stripped, e.g. "1.234,56" -> "1234.56".
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    // Only a comma: treat as decimal separator (European style: "0,45" -> "0.45").
    s = s.replace(",", ".");
  }
  // Only a dot, or no separator at all: already canonical.

  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

export interface BoxPatternMatch {
  boxesAvailable: number;
  stemsPerBox: number;
  matchedText: string;
}

/**
 * Recognizes the "<boxes>QB<sep><stemsPerBox>" pattern used by farms in many
 * spelling variants: 30QBx40, 100qbx30, 20QB*200, 10qb*200, 50 QB x 180, etc.
 */
export function parseBoxPattern(text: string): BoxPatternMatch | null {
  const match = text.match(/(\d+)\s*(?:QB|HB|FB)\s*[x×*]?\s*(\d+)/i);
  if (!match) return null;
  const boxesAvailable = parseInt(match[1], 10);
  const stemsPerBox = parseInt(match[2], 10);
  if (Number.isNaN(boxesAvailable) || Number.isNaN(stemsPerBox)) return null;
  return { boxesAvailable, stemsPerBox, matchedText: match[0] };
}

export function extractBoxType(text: string): string {
  const match = text.match(/\b(QB|HB|FB)\b/i);
  return match ? match[1].toUpperCase() : "QB";
}

/** Extracts "(Additional time required 72 HR)" style notes. */
export function parseExtraLeadTime(text: string): number | undefined {
  const match = text.match(/additional\s+time\s+required\s+(\d+)\s*hr/i);
  if (!match) return undefined;
  return parseInt(match[1], 10);
}

const GRADE_KEYWORDS = [
  "select",
  "sel",
  "premium",
  "prem",
  "fancy",
  "super",
  "jumbo",
  "choice",
  "extra",
  "standard",
  "std",
];

const TREATMENT_KEYWORDS = ["tinted", "painted", "dyed", "bleached", "normal"];

export function findKeyword(text: string, keywords: string[]): string | undefined {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(lower)) return kw;
  }
  return undefined;
}

export function findGradeKeyword(text: string): string | undefined {
  return findKeyword(text, GRADE_KEYWORDS);
}

export function findTreatmentKeyword(text: string): string | undefined {
  return findKeyword(text, TREATMENT_KEYWORDS);
}

/**
 * Normalizes a free-text product/farm name for fuzzy alias matching:
 * lowercase, strip punctuation, collapse whitespace. E.g. "Hyd White SEL",
 * "Hyd white sel.", "Hyd. White  Select" all normalize close enough for
 * Levenshtein-based matching in aliasMatching.ts.
 */
export function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Simple Levenshtein distance, used for fuzzy alias suggestions. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/** Similarity in [0, 1], 1 = identical, based on normalized Levenshtein distance. */
export function similarity(a: string, b: string): number {
  const na = normalizeForMatching(a);
  const nb = normalizeForMatching(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}
