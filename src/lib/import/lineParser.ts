import type { FieldConfidence, ParsedOfferLine } from "./types";
import {
  extractBoxType,
  findGradeKeyword,
  normalizeDecimalString,
  parseBoxPattern,
  parseExtraLeadTime,
} from "./normalize";
import { resolveProductGroup } from "./productGroups";

const PRICE_RE = /[$€]\s*([\d.,]+)/;
const TREATMENT_SEGMENT_RE = /^([a-z]+)\b[\s:]*[$€]?\s*([\d.,]+)?/i;

/**
 * Rule-based field recognizer for a single free-text farm offer line, e.g.:
 *   "Hyd White select 30QBx40 $0,45 | Tinted $0,60"
 *   "Alstro red angelina fancy 10qb*200 $0,15"
 *   "Eryngium 20QBx100 $0,39| tinted $0,46 (Additional time required 72 HR)"
 *
 * A single raw line can describe multiple sellable variants (e.g. a normal
 * and a tinted price for the same product) - these are returned as separate
 * `ParsedOfferLine`s, both keeping the full original line as `rawText` for
 * traceability.
 */
export function parseOfferLine(rawLine: string): ParsedOfferLine[] {
  const line = rawLine.trim();
  const extraLeadTimeHrs = parseExtraLeadTime(line);
  const withoutLeadTime = line.replace(/\(\s*additional\s+time\s+required[^)]*\)/i, "").trim();

  const segments = withoutLeadTime
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) {
    return [emptyLine(line)];
  }

  const [base, ...variants] = segments;
  const baseLine = parseBaseSegment(base, line, extraLeadTimeHrs);

  const results: ParsedOfferLine[] = [baseLine];

  for (const variantSegment of variants) {
    const variantLine = parseVariantSegment(variantSegment, baseLine, line);
    if (variantLine) {
      results.push(variantLine);
    } else {
      baseLine.parserWarnings.push(`Kon prijsvariant niet volledig herkennen: "${variantSegment}"`);
    }
  }

  return results;
}

function parseBaseSegment(
  segment: string,
  rawText: string,
  extraLeadTimeHrs: number | undefined,
): ParsedOfferLine {
  const fieldConfidence: ParsedOfferLine["fieldConfidence"] = {};
  const parserWarnings: string[] = [];

  const boxMatch = parseBoxPattern(segment);
  const priceMatch = segment.match(PRICE_RE);
  const currency: "USD" | "EUR" = segment.includes("€") ? "EUR" : "USD";

  let nameText = segment;
  if (boxMatch) nameText = nameText.replace(boxMatch.matchedText, " ");
  if (priceMatch) nameText = nameText.replace(priceMatch[0], " ");
  nameText = nameText.replace(/\s+/g, " ").trim();

  const grade = findGradeKeyword(nameText);
  let remainder = nameText;
  if (grade) {
    remainder = remainder.replace(new RegExp(`\\b${grade}\\b`, "i"), "").trim();
  }

  const words = remainder.split(/\s+/).filter(Boolean);
  const productGroupWord = words.shift() ?? "";
  const varietyRaw = words.join(" ").trim() || undefined;

  const { name: productGroupRaw, recognized } = productGroupWord
    ? resolveProductGroup(productGroupWord)
    : { name: "", recognized: false };

  if (productGroupWord) fieldConfidence.productGroupRaw = recognized ? "high" : "medium";
  if (varietyRaw) fieldConfidence.varietyRaw = "low";
  if (grade) fieldConfidence.gradeRaw = "high";

  let fobPricePerStem: string | undefined;
  if (priceMatch) {
    const normalized = normalizeDecimalString(priceMatch[1]);
    if (normalized) {
      fobPricePerStem = normalized;
      fieldConfidence.fobPricePerStem = "high";
    } else {
      parserWarnings.push(`Kon prijs "${priceMatch[1]}" niet interpreteren`);
    }
  } else {
    parserWarnings.push("Geen prijs gevonden op deze regel");
  }

  let boxesAvailable: number | undefined;
  let stemsPerBox: number | undefined;
  let boxType: string | undefined;
  if (boxMatch) {
    boxesAvailable = boxMatch.boxesAvailable;
    stemsPerBox = boxMatch.stemsPerBox;
    boxType = extractBoxType(segment);
    fieldConfidence.boxesAvailable = "high";
    fieldConfidence.stemsPerBox = "high";
    fieldConfidence.boxType = "high";
  } else {
    parserWarnings.push("Geen doos-/stelenpatroon (QB) gevonden op deze regel");
  }

  const needsReview = !boxMatch || !fobPricePerStem || !recognized;
  const confidence = overallConfidence({
    hasBox: !!boxMatch,
    hasPrice: !!fobPricePerStem,
    productRecognized: recognized,
  });

  return {
    rawText,
    productGroupRaw: productGroupRaw || undefined,
    varietyRaw,
    gradeRaw: grade,
    treatmentRaw: "normal",
    boxType,
    boxesAvailable,
    stemsPerBox,
    fobPricePerStem,
    currency,
    extraLeadTimeHrs,
    confidence,
    fieldConfidence,
    needsReview,
    parserWarnings,
  };
}

function parseVariantSegment(
  segment: string,
  base: ParsedOfferLine,
  rawText: string,
): ParsedOfferLine | null {
  const match = segment.match(TREATMENT_SEGMENT_RE);
  if (!match) return null;

  const treatmentRaw = match[1].toLowerCase();
  const priceRaw = match[2];
  if (!priceRaw) return null;

  const normalized = normalizeDecimalString(priceRaw);
  if (!normalized) return null;

  return {
    ...base,
    rawText,
    treatmentRaw,
    fobPricePerStem: normalized,
    fieldConfidence: { ...base.fieldConfidence, treatmentRaw: "high", fobPricePerStem: "high" },
    needsReview: base.needsReview,
    parserWarnings: [],
  };
}

function overallConfidence(params: {
  hasBox: boolean;
  hasPrice: boolean;
  productRecognized: boolean;
}): FieldConfidence {
  if (!params.hasBox || !params.hasPrice) return "low";
  if (!params.productRecognized) return "medium";
  return "high";
}

function emptyLine(rawText: string): ParsedOfferLine {
  return {
    rawText,
    treatmentRaw: "normal",
    confidence: "low",
    fieldConfidence: {},
    needsReview: true,
    parserWarnings: ["Regel kon niet worden geïnterpreteerd"],
  };
}
