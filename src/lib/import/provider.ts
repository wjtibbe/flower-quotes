import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import {
  DEGRADED_LINE_RAWTEXT_PLACEHOLDER,
  SUPPORTED_IMAGE_MEDIA_TYPES,
  type ImageImportSource,
  type ImportContext,
  type ImportParserProvider,
  type ImportSource,
  type ParsedOfferLine,
} from "./types";
import { segmentOfferLines } from "./segment";
import { parseOfferLine } from "./lineParser";
import { normalizeDecimalString, parseLengthCm } from "./normalize";
import { withRetry, withTimeout } from "./asyncUtils";

/**
 * Default, free, fully deterministic provider: regex/heuristic field
 * recognition on plain text. Used for Excel is bypassed (excelParser.ts reads
 * columns directly); this provider handles PDFs and emails. It cannot read
 * images at all (no vision, no OCR) - given an image source it fails with a
 * clear, specific error rather than fabricating empty results.
 */
export class RuleBasedParserProvider implements ImportParserProvider {
  readonly name = "rule-based";

  // `context` is part of the shared ImportParserProvider interface but this
  // provider is purely pattern-based and has no use for supplier/document
  // hints - accepting and ignoring it keeps every provider interchangeable.
  async parseOfferSource(source: ImportSource, _context?: ImportContext): Promise<ParsedOfferLine[]> {
    if (source.kind === "image") {
      throw new RuleBasedImageNotSupportedError();
    }
    const candidateLines = segmentOfferLines(source.text);
    return candidateLines.flatMap((line) => parseOfferLine(line));
  }
}

// ---------------------------------------------------------------------------
// Anthropic-backed provider
// ---------------------------------------------------------------------------

// Verified current and correct - do not change without an explicit request.
const MODEL_ID = "claude-sonnet-5";
const MAX_OUTPUT_TOKENS = 4096;
// Our own timeout is authoritative (produces a specific, typed error); the
// client-level timeout below is only a hard backstop in case Promise.race
// somehow never settles, so it's set well above our own limit.
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1000;
// Defensive cap on how many lines a single response is trusted for - guards
// against a pathological/looping response without ever silently dropping a
// well-formed import (real supplier lists are nowhere near this size per file).
const MAX_LINES_PER_RESPONSE = 1000;

// Conservative cap on a single image upload, sized to this app's actual
// infrastructure rather than an arbitrary number:
//  - The upload first has to pass through the `uploadFarmOffer` Next.js
//    Server Action, whose request body is capped by
//    `experimental.serverActions.bodySizeLimit` in next.config.mjs (raised
//    there to "10mb" for this feature - Next's own default is 1mb, too small
//    for a typical phone screenshot).
//  - Bytes are stored as-is in Postgres (`SourceUpload.fileData Bytes`), so
//    there is no hard ceiling on that side for images this size.
//  - This limit is our own, self-imposed ceiling on top of that: a supplier
//    price-list screenshot/photo is realistically well under a few MB; 8 MB
//    gives generous headroom for a high-resolution photo while staying
//    comfortably inside the Server Action's 10 MB body limit (which also has
//    to fit the rest of the multipart form data) and avoiding an
//    unnecessarily large, slow base64 payload to the AI provider.
// Keep this value and the next.config.mjs limit in sync if either changes.
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export class AnthropicNotConfiguredError extends Error {
  constructor() {
    super(
      "Anthropic AI is niet geconfigureerd (ANTHROPIC_API_KEY ontbreekt). Voer deze aanbieding handmatig in.",
    );
    this.name = "AnthropicNotConfiguredError";
  }
}

export class AnthropicTimeoutError extends Error {
  constructor(timeoutMs: number = REQUEST_TIMEOUT_MS) {
    super(
      `De AI-aanvraag duurde langer dan ${Math.round(timeoutMs / 1000)} seconden en is afgebroken. Probeer het opnieuw of voer de regels handmatig in.`,
    );
    this.name = "AnthropicTimeoutError";
  }
}

export class AnthropicRequestError extends Error {
  constructor(cause?: unknown) {
    super(
      "De AI-provider is momenteel niet bereikbaar of gaf een fout terug. Probeer het later opnieuw of voer de regels handmatig in.",
    );
    this.name = "AnthropicRequestError";
    if (cause !== undefined) this.cause = cause;
  }
}

export class AnthropicResponseFormatError extends Error {
  constructor() {
    super("De AI-respons bevatte geen leesbare tekst. Probeer het opnieuw of voer de regels handmatig in.");
    this.name = "AnthropicResponseFormatError";
  }
}

export class AnthropicJsonParseError extends Error {
  constructor(detail?: string) {
    super(
      `De AI-respons kon niet als JSON worden gelezen${detail ? ` (${detail})` : ""}. Probeer het opnieuw of voer de regels handmatig in.`,
    );
    this.name = "AnthropicJsonParseError";
  }
}

export class AnthropicUnsupportedImageTypeError extends Error {
  constructor() {
    super("Dit afbeeldingsformaat wordt nog niet ondersteund. Gebruik PNG, JPG of WEBP.");
    this.name = "AnthropicUnsupportedImageTypeError";
  }
}

export class AnthropicEmptyImageError extends Error {
  constructor() {
    super("Deze afbeelding is leeg of kon niet worden gelezen. Upload een geldig bestand.");
    this.name = "AnthropicEmptyImageError";
  }
}

export class AnthropicImageTooLargeError extends Error {
  constructor(maxBytes: number = MAX_IMAGE_BYTES) {
    super(
      `Deze afbeelding is groter dan de maximale ${Math.round(maxBytes / (1024 * 1024))} MB. Verklein de afbeelding en probeer het opnieuw.`,
    );
    this.name = "AnthropicImageTooLargeError";
  }
}

export class AnthropicNoLinesDetectedError extends Error {
  constructor() {
    super(
      "De AI heeft geen herkenbare aanbiedingsregels gevonden in deze bron. Voer de regels handmatig in of gebruik plakken.",
    );
    this.name = "AnthropicNoLinesDetectedError";
  }
}

export class RuleBasedImageNotSupportedError extends Error {
  constructor() {
    super(
      "Automatische afbeeldingsherkenning vereist een geconfigureerde Anthropic AI-provider (ANTHROPIC_API_KEY). Voer deze aanbieding handmatig in of via plakken.",
    );
    this.name = "RuleBasedImageNotSupportedError";
  }
}

// --- Prompt, split into clearly separate, composable sections (section 11:
// "Maak de prompt modulair") so a later step can add supplier-specific
// context without touching the persona/instructions/schema/glossary below. ---

const SYSTEM_PERSONA = `You are a specialist in international flower availability lists, working for a professional flower import/export trading desk. You have precise knowledge of cut-flower trade terminology: varieties and cultivars across roses, carnations (standard and spray/mini), dianthus, hydrangeas, alstroemeria and other common export flowers; stem length conventions measured in centimeters; packaging conventions (QB = Quarter Box, HB = Half Box, FB = Full Box, with regional stems-per-box conventions that vary by stem length); box weight in kilograms; and FOB pricing conventions where growers quote a price per stem in USD or EUR.

Your only task is structured data extraction from a supplier's availability list. You never negotiate, comment, or add sales language. You never invent or guess a value that is not clearly present in the source - when uncertain, you output null for that field and explain why in parserWarnings. You are careful, literal and conservative.`;

const EXTRACTION_INSTRUCTIONS = `Extract every distinct flower offer line from the source into a JSON array of objects, one object per sellable price/variant combination.

Rules:
- If one source line lists multiple prices for the same variety (e.g. a normal price and a separate tinted/painted price), emit one JSON object per price variant, each with its own "rawText" copy of the full original source line.
- Never invent a value you cannot directly infer from the source. When a field is not stated, or you are not confident, output null for that field - do not guess a "likely" value.
- Numbers must be actual JSON numbers, except prices and weights, which must be decimal strings using a dot (.) as the decimal separator, e.g. "0.38" - never a comma, never a currency symbol.
- Stem length may appear as "60", "60cm", "60 cm", "60CM" or similar - copy it into "length" exactly as written; do not compute, convert or reformat it yourself, and NEVER append it to "variety" (variety must contain only the cultivar name).
- If a price is quoted per bunch or per box rather than per stem, and stemsPerBox is stated and unambiguous, convert it to price-per-stem and note the conversion in parserWarnings. If you cannot convert with confidence, set fobPricePerStem to null and explain in parserWarnings instead of guessing.
- Grade/size qualifiers such as Select, Premium, Fancy, Jumbo, Extra or Standard belong in the "grade" field - never append them to "variety".
- Set needsReview to true whenever boxType, stemsPerBox, fobPricePerStem or currency is null or uncertain, or the line is otherwise ambiguous.
- Output ONLY a JSON array - no prose, no markdown code fences, no explanation before or after it.`;

// Keep in sync with ModelLineSchema below - every key here must exist there
// with the same type, and vice versa.
const JSON_SCHEMA_TEXT = `Each element of the array MUST be an object with EXACTLY these fields - no missing fields, no extra fields:
{
  "rawText": string,
  "farmName": string | null,
  "countryOfOrigin": string | null,
  "productGroup": string | null,
  "variety": string | null,
  "length": string | null,
  "color": string | null,
  "grade": string | null,
  "treatment": string | null,
  "boxType": "QB" | "HB" | "FB" | null,
  "boxesAvailable": number | null,
  "stemsPerBox": number | null,
  "fobPricePerStem": string | null,
  "currency": "USD" | "EUR" | null,
  "weightPerBoxKg": string | null,
  "extraLeadTimeHrs": number | null,
  "confidence": "high" | "medium" | "low",
  "needsReview": boolean,
  "parserWarnings": string[]
}`;

const FLOWER_DOMAIN_GLOSSARY = `Domain glossary (for your understanding, not to be echoed back):
- variety: the specific cultivar name of the flower, e.g. "Freedom", "Dallas", "Vendela" for roses - never includes the stem length.
- length: stem length in centimeters, a key pricing/quality dimension for cut flowers - always its own field, never merged into variety.
- stems: individual flower stems; the smallest countable unit.
- bunches: a small bundle of stems (commonly 10 or 25), sometimes used instead of boxes as the offered quantity - only convert to boxes/stems when the source makes the stems-per-bunch and bunches-per-box unambiguous.
- QB / HB / FB: Quarter Box, Half Box, Full Box - standard export packaging sizes; the same box type can carry a different stemsPerBox depending on stem length.
- box weight: the gross or net weight of one packed box, in kilograms.
- currencies: growers virtually always quote FOB prices in USD or EUR; never assume a currency the source does not state or clearly imply (e.g. via a $ or € sign).`;

const PARSING_RULES = `Notation you must treat as equivalent when reading the source (but only copy fields in the exact format described above - do not silently alter the source's own wording beyond what these rules require):
- Decimal separators: "0,38" and "0.38" mean the same number; always emit fobPricePerStem/weightPerBoxKg using a dot.
- Stem length notations "60", "60cm", "60 cm", "60CM" all mean the same 60 cm length.
- Box type is case-insensitive and may appear with or without a following "x" / "×" / "*" before the stems-per-box count.`;

const IMAGE_READING_INSTRUCTIONS = `Additional instructions for reading an attached image (a screenshot, photo or scan of a supplier's availability list):

Visual layouts you must be able to handle, sometimes even within the same image:
- A plain table with visible gridlines.
- A table with no visible gridlines at all - only spacing/alignment separates the columns; use that alignment to determine which values belong together.
- A WhatsApp-style chat screenshot where each product is a line of running text rather than a table row.
- A simple list with one product per line.
- A table with column headers (e.g. "Variety | Length | Stems/box | Price"), or one where the product name is in the first column and its attributes follow in the next columns on the same row.
- A supplier/farm name shown once near the top of the image, applying to every row below it.

Rules specific to reading an image:
- Only use information you can actually see in the image. Never infer a price, quantity, packaging value or currency without clear visual evidence for it - when in doubt, output null and add a parserWarning explaining what was unclear.
- Fill every field you cannot read with null rather than guessing.
- A value that appears once in a header or a line above the table (e.g. a shared currency, box type, or the supplier name) may be applied to every row it visibly covers, but never to rows outside that scope - and never invent that such a shared value exists without visual evidence.
- Read the image from top to bottom and keep the original row order.
- Never create a duplicate line by reading both a header/label row and a data row as if each were its own product - a header is a label, never an offer line.
- Add a parserWarning whenever a column or value is visually uncertain (faint, cut off, ambiguous alignment, overlapping text, etc.) instead of guessing at it.
- Pay attention to: variety vs. product group (a variety name is specific, e.g. "Dallas"; a product group is generic, e.g. "Rose"), stem length in centimeters, quantity and its unit (stems, bunches or boxes), stems per box, box weight, box type abbreviations (QB/HB/FB), currency, and whether the shown price is per stem, per bunch or per box.`;

const PASTED_TEXT_INSTRUCTIONS = `Additional instructions for reading pasted WhatsApp or email correspondence (as opposed to a formal price list document):

This kind of source often mixes real product information with conversational text around it. You must be able to handle, sometimes within the same message:
- Greetings and sign-offs (e.g. "Good morning", "Best regards", "Saludos") that are not product information.
- Commercial remarks before or after the product list (e.g. "Special offer this week", "Let me know if you need more").
- Multiple products listed on separate lines, one product per line.
- A single product's details spread across more than one line.
- A value stated once and then implicitly repeated for every line below it (e.g. a lone line reading "60 cm" or "USD/stem" that applies to the whole list that follows, not just the line right after it).
- Box type abbreviations such as QB, HB and FB.
- A price stated per stem.
- Quantities expressed in stems, bunches, boxes or kilograms.
- Text written in English or Spanish, sometimes mixed in the same message.
- Both comma and dot used as the decimal separator.
- WhatsApp-style dates and timestamps (e.g. "[14:32, 3/7/2026]") and forwarded-message markers.
- A sender's name or contact/phone line that is not a product line.

Rules specific to reading pasted correspondence:
- Use only information actually present in the source and the supplier context you were given - never invent or assume a value the text doesn't state.
- Ignore greetings, sign-offs, timestamps and sender signatures - never turn one of these into a product line.
- Never create a product line for a header or a value that is only being stated once to apply to the rows below it - only the actual product rows are offer lines.
- Preserve the original order the products appear in.
- Leave a field null when it is missing rather than guessing it - never guess a price, quantity, currency or packaging value.
- Add a concrete parserWarning whenever something is ambiguous (e.g. a shared value whose scope is unclear, or a line that could be read two ways).`;

function buildSystemPrompt(sourceKind: ImportSource["kind"], context?: ImportContext): string {
  const parts = [SYSTEM_PERSONA, EXTRACTION_INSTRUCTIONS, JSON_SCHEMA_TEXT, FLOWER_DOMAIN_GLOSSARY, PARSING_RULES];
  if (sourceKind === "image") parts.push(IMAGE_READING_INSTRUCTIONS);
  if (sourceKind === "text" && context?.isPastedCorrespondence) parts.push(PASTED_TEXT_INSTRUCTIONS);
  return parts.join("\n\n");
}

/**
 * Renders the (optional) supplier/document context as its own prompt block.
 * Kept separate from the system prompt so later work can extend this with
 * supplier-specific hints (section 11) without touching the persona,
 * instructions, schema or glossary above.
 */
function buildSupplierContextBlock(context?: ImportContext): string {
  if (!context?.supplierName && !context?.supplierCountry && !context?.documentLabel) {
    return "No supplier or document-type context was provided for this import.";
  }
  const lines: string[] = [];
  if (context.supplierName) lines.push(`Supplier: ${context.supplierName}`);
  if (context.supplierCountry) lines.push(`Supplier country: ${context.supplierCountry}`);
  if (context.documentLabel) lines.push(`Source document type: ${context.documentLabel}`);
  lines.push(
    "This supplier was chosen by the user before uploading and is a strong hint - use it to interpret ambiguous abbreviations or regional conventions. Never output a different supplier as fact, and never silently act on a mismatch: if the source clearly names a different supplier, note the discrepancy in parserWarnings on the affected line(s) instead.",
  );
  return lines.join("\n");
}

function buildUserInstructionText(source: ImportSource, context?: ImportContext): string {
  const contextBlock = buildSupplierContextBlock(context);
  if (source.kind === "text") {
    return `${contextBlock}\n\nSOURCE TEXT:\n"""\n${source.text}\n"""`;
  }
  const extra = source.additionalText?.trim()
    ? `\n\nAdditional text supplied alongside the image:\n"""\n${source.additionalText.trim()}\n"""`
    : "";
  return `${contextBlock}\n\nThe attached image is the supplier's availability list. Read it carefully from top to bottom and extract the offer lines exactly as instructed above.${extra}`;
}

/**
 * Builds the Anthropic Messages API `content` array for one `ImportSource` -
 * a text source becomes a single text block; an image source becomes an
 * image block (base64) plus a trailing text instruction block, per the
 * `ImageBlockParam`/`TextBlockParam` shapes in the installed
 * @anthropic-ai/sdk (resources/messages.d.ts) - this shape is not invented,
 * it mirrors that package's own types. Pure and side-effect-free so it can be
 * unit-tested without ever touching the network.
 */
export function buildMessageContent(
  source: ImportSource,
  context?: ImportContext,
): Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  const instructionText = buildUserInstructionText(source, context);

  if (source.kind === "text") {
    return [{ type: "text", text: instructionText }];
  }

  return [
    {
      type: "image",
      source: {
        type: "base64",
        media_type: source.mediaType,
        data: source.bytes.toString("base64"),
      },
    },
    { type: "text", text: instructionText },
  ];
}

/**
 * Validates an image source before it's ever sent to the API (section 4):
 * supported media type, non-empty, within `MAX_IMAGE_BYTES`. Pure and
 * side-effect-free so it's directly unit-testable.
 */
export function validateImageSource(source: ImageImportSource): void {
  if (!SUPPORTED_IMAGE_MEDIA_TYPES.includes(source.mediaType)) {
    throw new AnthropicUnsupportedImageTypeError();
  }
  if (source.bytes.length === 0) {
    throw new AnthropicEmptyImageError();
  }
  if (source.bytes.length > MAX_IMAGE_BYTES) {
    throw new AnthropicImageTooLargeError();
  }
}

// --- Strict wire schema for the model's JSON output. `.strict()` rejects any
// key not listed here, enforcing "uitsluitend vaste velden" - Claude cannot
// smuggle in an unconstrained free-form field. ---
const ModelLineSchema = z
  .object({
    rawText: z.string(),
    farmName: z.string().nullable(),
    countryOfOrigin: z.string().nullable(),
    productGroup: z.string().nullable(),
    variety: z.string().nullable(),
    length: z.string().nullable(),
    color: z.string().nullable(),
    grade: z.string().nullable(),
    treatment: z.string().nullable(),
    boxType: z.enum(["QB", "HB", "FB"]).nullable(),
    boxesAvailable: z.number().nullable(),
    stemsPerBox: z.number().nullable(),
    fobPricePerStem: z.string().nullable(),
    currency: z.enum(["USD", "EUR"]).nullable(),
    weightPerBoxKg: z.string().nullable(),
    extraLeadTimeHrs: z.number().nullable(),
    confidence: z.enum(["high", "medium", "low"]),
    needsReview: z.boolean(),
    parserWarnings: z.array(z.string()),
  })
  .strict();

type ModelLine = z.infer<typeof ModelLineSchema>;

export class AnthropicParserProvider implements ImportParserProvider {
  readonly name = "anthropic";

  async parseOfferSource(source: ImportSource, context?: ImportContext): Promise<ParsedOfferLine[]> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new AnthropicNotConfiguredError();

    if (source.kind === "image") {
      validateImageSource(source);
    }

    const { default: AnthropicClient } = await import("@anthropic-ai/sdk");
    // maxRetries: 0 - retries are handled explicitly below (withRetry), so
    // failures are testable and logged once per attempt instead of being
    // silently retried inside the SDK.
    const client = new AnthropicClient({ apiKey, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS * 2 });

    const system = buildSystemPrompt(source.kind, context);
    const content = buildMessageContent(source, context);
    const inputSizeBytes = source.kind === "image" ? source.bytes.length : Buffer.byteLength(source.text, "utf-8");
    const logMeta = {
      model: MODEL_ID,
      sourceKind: source.kind,
      ...(source.kind === "image" ? { mediaType: source.mediaType } : {}),
    };
    const startedAt = Date.now();

    let responseText: string;
    try {
      const response = await withRetry(
        () =>
          withTimeout(
            client.messages.create({
              model: MODEL_ID,
              max_tokens: MAX_OUTPUT_TOKENS,
              system,
              messages: [{ role: "user", content }],
            }),
            REQUEST_TIMEOUT_MS,
            () => new AnthropicTimeoutError(REQUEST_TIMEOUT_MS),
          ),
        {
          retries: MAX_RETRIES,
          isRetryable: isRetryableAnthropicError,
          delayMs: (attempt) => RETRY_BASE_DELAY_MS * attempt,
          onRetry: (attempt, err) => {
            // Never log source.bytes/source.text or the base64 payload - only
            // safe metadata (section 3: privacy).
            console.warn("[import:anthropic] retrying after failure", {
              ...logMeta,
              attempt,
              errorName: err instanceof Error ? err.name : typeof err,
            });
          },
        },
      );

      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        console.error("[import:anthropic] response had no text block", {
          ...logMeta,
          durationMs: Date.now() - startedAt,
        });
        throw new AnthropicResponseFormatError();
      }
      responseText = textBlock.text;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      // errorMessage is always one of OUR OWN typed error messages (a fixed,
      // safe Dutch string) or the Anthropic SDK's own error text about the
      // request itself - never the document content, base64 data or any
      // extracted product/price information.
      console.error("[import:anthropic] request failed", {
        ...logMeta,
        durationMs,
        inputSizeBytes,
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      throw toAnthropicError(err);
    }

    const durationMs = Date.now() - startedAt;
    const lines = parseAndValidateModelOutput(responseText);

    if (lines.length === 0) {
      // A syntactically valid response with zero lines is not a silent
      // success (section 11: "moet geen technisch succes zijn") - the
      // reviewer needs to know explicitly so the manual/paste fallback stays
      // available instead of the offer silently ending up empty.
      console.warn("[import:anthropic] response parsed to zero offer lines", {
        ...logMeta,
        durationMs,
        inputSizeBytes,
        outputLength: responseText.length,
      });
      throw new AnthropicNoLinesDetectedError();
    }

    console.info("[import:anthropic] request completed", {
      ...logMeta,
      durationMs,
      inputSizeBytes,
      outputLength: responseText.length,
      lineCount: lines.length,
    });
    return lines;
  }
}

function isRetryableAnthropicError(err: unknown): boolean {
  if (err instanceof AnthropicTimeoutError) return true;
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return true; // network/connection-style errors have no status - worth a retry
}

function toAnthropicError(err: unknown): Error {
  if (err instanceof AnthropicTimeoutError) return err;
  return new AnthropicRequestError(err);
}

function stripMarkdownFences(text: string): string {
  return text.replace(/```json/gi, "").replace(/```/g, "");
}

/**
 * Parses and validates the model's JSON response. A response that isn't
 * readable JSON at all (or isn't an array) is a total failure - the caller
 * has nothing to recover, so this throws a specific `AnthropicJsonParseError`.
 * An individual line that fails the strict schema is NOT dropped and does not
 * fail the whole batch: it's recovered as best-effort (see
 * `buildDegradedLine`) and forced into review, so one malformed element never
 * costs the user the other, valid lines.
 */
export function parseAndValidateModelOutput(text: string): ParsedOfferLine[] {
  const cleaned = stripMarkdownFences(text);
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new AnthropicJsonParseError("geen JSON-array gevonden in de respons");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (err) {
    throw new AnthropicJsonParseError(err instanceof Error ? err.message : "ongeldige JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new AnthropicJsonParseError("respons was geen array");
  }

  let items = parsed;
  if (parsed.length > MAX_LINES_PER_RESPONSE) {
    console.warn("[import:anthropic] response line count truncated", {
      totalLines: parsed.length,
      keptLines: MAX_LINES_PER_RESPONSE,
    });
    items = parsed.slice(0, MAX_LINES_PER_RESPONSE);
  }

  let recoveredCount = 0;
  const result = items.map((item) => {
    const validated = ModelLineSchema.safeParse(item);
    if (validated.success) return mapValidatedLine(validated.data);
    recoveredCount++;
    return buildDegradedLine(item, validated.error.issues);
  });

  if (recoveredCount > 0) {
    console.warn("[import:anthropic] some lines failed schema validation and were partially recovered", {
      recoveredCount,
      totalLines: items.length,
    });
  }

  return result;
}

function mapValidatedLine(parsed: ModelLine): ParsedOfferLine {
  const warnings = [...parsed.parserWarnings];

  // Length is ALWAYS kept as its own typed value - never appended to variety
  // (see the correction note on ParsedOfferLine.lengthCm).
  const lengthCm = parsed.length ? parseLengthCm(parsed.length) : null;
  if (parsed.length && lengthCm === null) {
    warnings.push(`Lengte "${parsed.length}" kon niet worden geïnterpreteerd - controleer handmatig.`);
  }

  let fobPricePerStem: string | undefined;
  if (parsed.fobPricePerStem !== null) {
    const normalized = normalizeDecimalString(parsed.fobPricePerStem);
    if (normalized) {
      fobPricePerStem = normalized;
    } else {
      warnings.push(`FOB-prijs "${parsed.fobPricePerStem}" kon niet worden geïnterpreteerd als getal.`);
    }
  }

  let weightPerBoxKg: string | undefined;
  if (parsed.weightPerBoxKg !== null) {
    const normalized = normalizeDecimalString(parsed.weightPerBoxKg);
    if (normalized) {
      weightPerBoxKg = normalized;
    } else {
      warnings.push(`Doosgewicht "${parsed.weightPerBoxKg}" kon niet worden geïnterpreteerd als getal.`);
    }
  }

  if (!parsed.currency) {
    warnings.push("Valuta niet vermeld in de bron - controleer bij review.");
  }

  const needsReview =
    parsed.needsReview || !parsed.boxType || !parsed.stemsPerBox || !fobPricePerStem || !parsed.currency;

  return {
    rawText: parsed.rawText,
    farmNameRaw: parsed.farmName ?? undefined,
    countryOfOrigin: parsed.countryOfOrigin ?? undefined,
    productGroupRaw: parsed.productGroup ?? undefined,
    varietyRaw: parsed.variety ?? undefined,
    lengthCm: lengthCm ?? undefined,
    colorRaw: parsed.color ?? undefined,
    gradeRaw: parsed.grade ?? undefined,
    treatmentRaw: parsed.treatment ?? "normal",
    boxType: parsed.boxType ?? undefined,
    boxesAvailable: parsed.boxesAvailable ?? undefined,
    stemsPerBox: parsed.stemsPerBox ?? undefined,
    fobPricePerStem,
    currency: parsed.currency ?? undefined,
    weightPerBoxKg,
    extraLeadTimeHrs: parsed.extraLeadTimeHrs ?? undefined,
    confidence: parsed.confidence,
    fieldConfidence: {},
    needsReview,
    parserWarnings: warnings,
  };
}

/**
 * Best-effort recovery for a single array element that failed the strict
 * schema (extra/missing keys, wrong type, invalid enum value, ...). Never
 * drops the line - pulls out whatever fields DO look usable, forces the line
 * into review, and records which schema checks failed (field paths only,
 * never the raw document content) so the reviewer knows why.
 */
function buildDegradedLine(item: unknown, issues: z.ZodIssue[]): ParsedOfferLine {
  const obj = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
  const issueSummary = issues.slice(0, 5).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  const lengthCm = typeof obj.length === "string" ? parseLengthCm(obj.length) ?? undefined : undefined;

  return {
    rawText:
      typeof obj.rawText === "string" && obj.rawText.trim()
        ? obj.rawText
        : DEGRADED_LINE_RAWTEXT_PLACEHOLDER,
    farmNameRaw: optionalString(obj.farmName),
    countryOfOrigin: optionalString(obj.countryOfOrigin),
    productGroupRaw: optionalString(obj.productGroup),
    varietyRaw: optionalString(obj.variety),
    lengthCm,
    colorRaw: optionalString(obj.color),
    gradeRaw: optionalString(obj.grade),
    treatmentRaw: optionalString(obj.treatment) ?? "normal",
    boxType: optionalString(obj.boxType),
    boxesAvailable: optionalNumber(obj.boxesAvailable),
    stemsPerBox: optionalNumber(obj.stemsPerBox),
    fobPricePerStem:
      typeof obj.fobPricePerStem === "string" ? normalizeDecimalString(obj.fobPricePerStem) ?? undefined : undefined,
    currency: obj.currency === "EUR" ? "EUR" : obj.currency === "USD" ? "USD" : undefined,
    weightPerBoxKg:
      typeof obj.weightPerBoxKg === "string" ? normalizeDecimalString(obj.weightPerBoxKg) ?? undefined : undefined,
    extraLeadTimeHrs: optionalNumber(obj.extraLeadTimeHrs),
    confidence: "low",
    fieldConfidence: {},
    needsReview: true,
    parserWarnings: [
      "Deze regel kon niet volledig worden gevalideerd en is deels automatisch hersteld - controleer alle velden.",
      ...issueSummary,
    ],
  };
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
