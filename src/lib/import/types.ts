export type SourceFileKind = "IMAGE" | "PDF" | "EMAIL" | "EXCEL" | "MANUAL";

export type FieldConfidence = "high" | "medium" | "low";

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
  boxType?: string;
  boxesAvailable?: number;
  stemsPerBox?: number;
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
 * Service-interface every import parser "provider" must implement (see spec
 * section 24: "Verberg AI-providerlogica achter een duidelijke
 * service-interface" / "Zorg dat de app later andere AI-providers kan
 * gebruiken"). Providers never write directly to the database - they only
 * turn raw text into draft `ParsedOfferLine`s for the user to review.
 */
export interface ImportParserProvider {
  readonly name: string;
  parseOfferText(rawText: string): Promise<ParsedOfferLine[]>;
}
