export type SourceFileKind = "IMAGE" | "PDF" | "EMAIL" | "EXCEL" | "MANUAL";

export type FieldConfidence = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// Internal placeholder rawText values
// ---------------------------------------------------------------------------

/**
 * The placeholder `rawText` a degraded AI line gets when the model's output
 * failed schema validation and no usable original source text could be
 * recovered (see `buildDegradedLine` in `provider.ts`). Never real
 * supplier-authored text.
 */
export const DEGRADED_LINE_RAWTEXT_PLACEHOLDER = "(kon oorspronkelijke brontekst niet achterhalen)";

/**
 * The placeholder `rawText` a manually-added review line gets - there is no
 * supplier source line for a hand-typed row (see `addManualOfferLine`).
 * Never real supplier-authored text.
 */
export const MANUAL_LINE_RAWTEXT_PLACEHOLDER = "(handmatig ingevoerd)";

/**
 * Every internal, non-supplier-authored `rawText` placeholder. A line whose
 * `rawText` is one of these must never be usable as a `SupplierLineMapping`
 * source - see `isValidSupplierMappingSource` in
 * `lib/supplierMapping/mappingSource.ts`.
 */
export const INTERNAL_RAWTEXT_PLACEHOLDERS: readonly string[] = [
  DEGRADED_LINE_RAWTEXT_PLACEHOLDER,
  MANUAL_LINE_RAWTEXT_PLACEHOLDER,
];

/**
 * Mirrors the Prisma `OfferUnit` enum, kept as a plain string-literal union
 * here (rather than importing `@prisma/client` into the provider-agnostic
 * parser layer) - the same pattern already used for `currency` below. Cast
 * `as OfferUnit` at the actual Prisma call site (see `offerLineMapping.ts`),
 * matching how `currency` is cast `as Currency` in `uploadFarmOffer`.
 */
export type OfferUnitLike = "STEMS" | "BUNCHES" | "BOXES" | "KILOGRAMS";

export interface ParsedOfferLine {
  rawText: string;

  farmNameRaw?: string;
  countryOfOrigin?: string;
  productGroupRaw?: string;
  productNameRaw?: string;
  varietyRaw?: string;
  colorRaw?: string;
  gradeRaw?: string;
  treatmentRaw?: string; // "normal" | "tinted" | "painted" | ... (free text, standardized where possible)
  /**
   * Stem length in centimeters, kept as its own typed value - NEVER folded
   * into `varietyRaw` (e.g. `varietyRaw` must stay "Dallas", never "Dallas
   * 60cm"). Persisted to `FarmOfferLine.stemLengthCm` (an `Int?`, whole
   * centimeters) via `mapParsedOfferLineToCreateInput` in
   * `offerLineMapping.ts` - a range like "50-70cm" must never be collapsed
   * into a single number here; leave this undefined instead and let the
   * mapping helper add a validation warning.
   */
  lengthCm?: number;
  /**
   * The stem length EXACTLY as written in the source ("60cm", "40-60cm",
   * "70-80 cm"), preserved verbatim so the deterministic range expander
   * (`rangeExpansion.ts`) can tell a single length from a range without ever
   * losing the original wording. For a single length this mirrors `lengthCm`;
   * for a range `lengthCm` stays undefined and the range lives only here until
   * expansion resolves it into one concrete `lengthCm` per shared price-table
   * tier. Transient parser metadata - never persisted (there is no column for
   * it); expansion runs before the offer lines are ever written.
   */
  lengthRaw?: string;
  boxType?: string;
  boxesAvailable?: number;
  stemsPerBox?: number;
  /**
   * Generic quantity + unit (preferred over `boxesAvailable` for new
   * imports, section 3 of "invoerzijde verbeteren"). `quantity` is a decimal
   * string, never a float, matching `fobPricePerStem`/`weightPerBoxKg` below
   * - it maps straight onto `FarmOfferLine.quantity` (a Prisma `Decimal`).
   * No current provider (rule-based or Anthropic) populates these yet - that
   * is a later step - but the mapping/finalization helpers already support
   * them so a future provider change is additive, not another schema change.
   */
  quantity?: string;
  unit?: OfferUnitLike;
  fobPricePerStem?: string; // decimal string, never a float
  currency?: "USD" | "EUR";
  weightPerBoxKg?: string;
  notes?: string;
  extraLeadTimeHrs?: number;

  /** Overall confidence for this line, derived from the per-field confidences. */
  confidence: FieldConfidence;
  /** Per-field confidence, only for fields that were actually populated. */
  fieldConfidence: Partial<Record<keyof ParsedOfferLine, FieldConfidence>>;
  /** True whenever the line could not be fully, unambiguously parsed. */
  needsReview: boolean;
  /** Non-blocking notes explaining parsing decisions/ambiguities, shown to the reviewer. */
  parserWarnings: string[];
}

export interface ImportResult {
  sourceKind: SourceFileKind;
  rawText: string;
  lines: ParsedOfferLine[];
  /** Set when the whole file could not be parsed at all and manual entry is required. */
  fatalError?: string;
}

/**
 * Context about the upload that helps a parser produce better output. The
 * supplier is always a strong hint the user chose before uploading - a
 * provider must never invent or silently change it; a suspected mismatch
 * between the source text and this supplier may only surface as a
 * `parserWarnings` entry on the affected line, never as an automatic change.
 * `documentLabel` is filled in by `runImport()` from the detected file type
 * (e.g. "Excel-bestand", "Screenshot of foto") so a provider can tailor its
 * reading strategy to the kind of source it's looking at. Every field is
 * optional and providers that don't use context (e.g. the rule-based one)
 * can simply ignore the parameter - this keeps the interface
 * provider-agnostic and easy to extend later (e.g. with supplier-specific
 * hints) without another breaking signature change.
 */
export interface ImportContext {
  supplierName?: string;
  supplierCountry?: string;
  documentLabel?: string;
  /**
   * True only for text pasted directly into the upload form (WhatsApp/email
   * correspondence), as opposed to text extracted from an uploaded file (PDF,
   * .eml/.txt, or the Excel/CSV flatten-to-text fallback). Lets the Anthropic
   * provider apply the WhatsApp/email-specific reading rules (greetings,
   * signoffs, timestamps, sender names that aren't product lines, ...) only
   * where they're actually relevant - see `PASTED_TEXT_INSTRUCTIONS` in
   * provider.ts.
   */
  isPastedCorrespondence?: boolean;
}

// Media types Anthropic's Messages API accepts for image content blocks (see
// `ImageBlockParam.Source.media_type` in the installed
// @anthropic-ai/sdk's resources/messages.d.ts, whose own doc comment
// confirms all four are supported for the base64 source type) - not invented.
export const SUPPORTED_IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type SupportedImageMediaType = (typeof SUPPORTED_IMAGE_MEDIA_TYPES)[number];

/** A plain-text source: already-extracted text (from Excel/PDF/email) or pasted text. */
export interface TextImportSource {
  kind: "text";
  text: string;
}

/**
 * A screenshot/photo source, sent multimodally to a vision-capable provider -
 * never OCR'd first. `bytes` are the original, untouched image bytes (never
 * modified, cropped or re-encoded).
 */
export interface ImageImportSource {
  kind: "image";
  bytes: Buffer;
  mediaType: SupportedImageMediaType;
  /** Original filename, if known - safe metadata (never logged as document content). */
  fileName?: string;
  /** Optional extra text supplied alongside the image (e.g. a typed caption/note). */
  additionalText?: string;
}

/**
 * Generic import source, provider-agnostic (section: "Provider-onafhankelijke
 * bronstructuur"). A discriminated union so a provider that can't handle a
 * given `kind` (e.g. the rule-based provider given an image) can check
 * `source.kind` and fail with a clear, specific error instead of guessing.
 */
export type ImportSource = TextImportSource | ImageImportSource;

/**
 * Service-interface every import parser "provider" must implement (see spec
 * section 24: "Verberg AI-providerlogica achter een duidelijke
 * service-interface" / "Zorg dat de app later andere AI-providers kan
 * gebruiken"). Providers never write directly to the database - they only
 * turn a raw `ImportSource` into draft `ParsedOfferLine`s for the user to
 * review.
 */
export interface ImportParserProvider {
  readonly name: string;
  parseOfferSource(source: ImportSource, context?: ImportContext): Promise<ParsedOfferLine[]>;
}
