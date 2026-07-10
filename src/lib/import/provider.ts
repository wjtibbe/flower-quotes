import type { ImportParserProvider, ParsedOfferLine } from "./types";
import { segmentOfferLines } from "./segment";
import { parseOfferLine } from "./lineParser";

/**
 * Default, free, fully deterministic provider: regex/heuristic field
 * recognition. Used for Excel is bypassed (excelParser.ts reads columns
 * directly); this provider handles PDFs, emails and OCR'd image text -
 * anything that comes in as unstructured free text.
 */
export class RuleBasedParserProvider implements ImportParserProvider {
  readonly name = "rule-based";

  async parseOfferText(rawText: string): Promise<ParsedOfferLine[]> {
    const candidateLines = segmentOfferLines(rawText);
    return candidateLines.flatMap((line) => parseOfferLine(line));
  }
}

/**
 * Optional LLM-backed provider (Anthropic Claude), used only when
 * ANTHROPIC_API_KEY is configured. Implements the exact same interface as
 * the rule-based provider, so it's a drop-in swap and the rest of the app
 * never needs to know which provider produced a given draft line. Output is
 * validated before being handed back - never trusted blindly (section 24:
 * "Sla geen AI-output direct als definitieve waarheid op").
 */
export class AnthropicParserProvider implements ImportParserProvider {
  readonly name = "anthropic";

  async parseOfferText(rawText: string): Promise<ParsedOfferLine[]> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured");
    }

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });

    const prompt = buildExtractionPrompt(rawText);
    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Anthropic response contained no text block");
    }

    return parseAndValidateModelOutput(textBlock.text);
  }
}

function buildExtractionPrompt(rawText: string): string {
  return `You extract flower farm offer lines from unstructured supplier text into JSON.
Return ONLY a JSON array, no prose. Each item has this shape (all fields optional except rawText):
{
  "rawText": string,
  "productGroupRaw": string, "varietyRaw": string, "colorRaw": string, "gradeRaw": string,
  "treatmentRaw": string, "boxType": string, "boxesAvailable": number, "stemsPerBox": number,
  "fobPricePerStem": string (decimal string, dot separator), "currency": "USD"|"EUR",
  "extraLeadTimeHrs": number, "confidence": "high"|"medium"|"low", "needsReview": boolean,
  "fieldConfidence": object, "parserWarnings": string[]
}
If a line has multiple prices (e.g. normal + tinted), emit one item per price/treatment.
Never invent values you cannot infer from the text - omit the field instead and lower confidence.

TEXT:
"""
${rawText}
"""`;
}

function parseAndValidateModelOutput(text: string): ParsedOfferLine[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Could not find a JSON array in the model response");

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) throw new Error("Model response JSON was not an array");

  return parsed.map((item: Record<string, unknown>) => ({
    rawText: String(item.rawText ?? ""),
    productGroupRaw: optionalString(item.productGroupRaw),
    varietyRaw: optionalString(item.varietyRaw),
    colorRaw: optionalString(item.colorRaw),
    gradeRaw: optionalString(item.gradeRaw),
    treatmentRaw: optionalString(item.treatmentRaw) ?? "normal",
    boxType: optionalString(item.boxType),
    boxesAvailable: optionalNumber(item.boxesAvailable),
    stemsPerBox: optionalNumber(item.stemsPerBox),
    fobPricePerStem: optionalString(item.fobPricePerStem),
    currency: item.currency === "EUR" ? "EUR" : "USD",
    extraLeadTimeHrs: optionalNumber(item.extraLeadTimeHrs),
    confidence: ["high", "medium", "low"].includes(String(item.confidence))
      ? (item.confidence as "high" | "medium" | "low")
      : "low",
    fieldConfidence: typeof item.fieldConfidence === "object" ? (item.fieldConfidence as never) : {},
    needsReview: item.needsReview !== false, // default to true unless the model explicitly says false
    parserWarnings: Array.isArray(item.parserWarnings) ? (item.parserWarnings as string[]) : [],
  }));
}

function optionalString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}
function optionalNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Provider factory - the single place that decides which AI provider to use.
 * Everything else in the app depends only on `ImportParserProvider`.
 */
export function getImportParserProvider(): ImportParserProvider {
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicParserProvider();
  }
  return new RuleBasedParserProvider();
}
