import type { ImportContext, ImportParserProvider, ImportResult, ParsedOfferLine, SourceFileKind } from "./types";
import { extractPdfText, isPdfTextUseful } from "./extract/pdfText";
import { extractExcelTables, type ExcelSheetExtraction } from "./extract/excelTable";
import { extractCsvTables } from "./extract/csv";
import { extractEmailText } from "./extract/emailText";
import { resolveImageMediaType, resolveExcelFileKind } from "./extract/detectFileType";
import { parseExcelTable } from "./excelParser";
import { detectTableRegion, buildTabularText, type DetectedTableRegion } from "./excelTableAdapter";
import {
  detectDeterministicColumns,
  hasSufficientDeterministicCoverage,
  extractDeterministicRows,
  buildDescriptionListText,
  mergeDeterministicRowsWithDescriptionLines,
  type DeterministicField,
} from "./excelDeterministicMapper";
import { getImportParserProvider, AnthropicNoLinesDetectedError } from "./provider";
import { chunkTextSupplierOffer, type TextChunk } from "./textChunking";
import { applyLengthRangeExpansion, parseSharedPriceTable } from "./rangeExpansion";

// Human-readable description of each source kind, given to the parser
// provider as part of its context (section 2: "de prompt moet ... document-
// type meekrijgen") so it can tailor its reading strategy accordingly.
const DOCUMENT_LABELS: Record<SourceFileKind, string> = {
  EXCEL: "Excel-bestand",
  PDF: "PDF-document",
  EMAIL: "E-mail of geplakte tekst (bv. WhatsApp)",
  IMAGE: "Screenshot of foto",
  MANUAL: "Handmatige invoer",
};

/** Original filename/MIME type of the uploaded file, when known - only used to resolve an image's exact Anthropic media type and an Excel-ish file's exact kind (xlsx/xls/csv). */
export interface RunImportFileMeta {
  fileName?: string;
  mimeType?: string | null;
}

/**
 * Orchestrates the full import pipeline (spec section 24, steps 1-7):
 * file type -> text/table extraction (or a direct image handoff for
 * screenshots/photos) -> parsing -> confidence -> draft lines. Steps 8-9
 * (user review, definitive save) happen in the UI/API layer, not here - this
 * function never touches the database, and never throws: every failure mode
 * (extraction, AI provider) is caught and reported as `fatalError` with a
 * specific reason, so a bad file or an AI/network hiccup never surfaces as an
 * unhandled exception in the upload action.
 *
 * `context` carries the supplier the user selected before uploading (a
 * strong hint the parser must never override) - see `ImportContext`.
 * `fileMeta` carries the original filename/MIME type, needed only to resolve
 * an image's exact media type or an Excel-ish file's exact kind for the
 * vision-capable provider / the right spreadsheet reader.
 */
export async function runImport(
  fileType: SourceFileKind,
  buffer: Buffer,
  context?: ImportContext,
  fileMeta?: RunImportFileMeta,
): Promise<ImportResult> {
  const resolvedContext: ImportContext = { ...context, documentLabel: DOCUMENT_LABELS[fileType] };
  switch (fileType) {
    case "EXCEL":
      return runExcelImport(buffer, resolvedContext, fileMeta);
    case "PDF":
      return runPdfImport(buffer, resolvedContext);
    case "EMAIL":
      return runTextImportSource(buffer.toString("utf-8"), "EMAIL", extractEmailText, resolvedContext);
    case "IMAGE":
      return runImageImport(buffer, resolvedContext, fileMeta);
    case "MANUAL":
    default:
      // Reached only when a caller passes a file `detectFileType()` couldn't
      // classify at all (or no buffer content) - never for pasted text,
      // which always goes through the dedicated `runPastedTextImport()`
      // entry point below instead. The upload form itself never lets an
      // unrecognized file reach this point at all (see
      // `isUploadableFileKind` in uploadValidation.ts, checked before
      // `runImport` is ever called) - this branch is kept only as a safe,
      // non-throwing default for `runImport()` as a general-purpose exported
      // function.
      return { sourceKind: "MANUAL", rawText: "", lines: [] };
  }
}

/**
 * Entry point for pasted WhatsApp/email text (section 2/3 of the "invoerzijde
 * verbeteren" step): goes through the exact same text-provider flow as an
 * uploaded .eml/.txt file (`runTextImportSource`, shared below - no
 * duplicated parser logic), and never touches a temporary file. `documentLabel`
 * is set explicitly so the parser prompt recognizes this as casual pasted
 * correspondence rather than a formal document, enabling the WhatsApp/email-
 * specific reading rules (see `PASTED_TEXT_INSTRUCTIONS` in provider.ts).
 */
export async function runPastedTextImport(text: string, context?: ImportContext): Promise<ImportResult> {
  const resolvedContext: ImportContext = {
    ...context,
    documentLabel: "Geplakte WhatsApp- of e-mailtekst",
    isPastedCorrespondence: true,
  };
  return runTextImportSource(text, "MANUAL", extractEmailText, resolvedContext);
}

async function runExcelImport(
  buffer: Buffer,
  context: ImportContext,
  fileMeta?: RunImportFileMeta,
): Promise<ImportResult> {
  const kind = resolveExcelFileKind(fileMeta?.fileName ?? "", fileMeta?.mimeType);

  if (kind === "xls") {
    // ExcelJS (the only spreadsheet dependency in this project) has no
    // legacy .xls (BIFF) reader at all - only its OOXML .xlsx reader and its
    // separate CSV reader exist (verified in its README/typings). Rather
    // than let this fail with a misleading generic read error, say so
    // directly (section 8: "XLS voor zover de huidige dependency dit
    // werkelijk ondersteunt").
    return {
      sourceKind: "EXCEL",
      rawText: "",
      lines: [],
      fatalError:
        "Dit .xls-bestand (oud Excel-formaat) wordt nog niet ondersteund. Sla het bestand op als .xlsx of .csv en probeer het opnieuw.",
    };
  }

  try {
    const sheets: ExcelSheetExtraction[] = kind === "csv" ? await extractCsvTables(buffer) : await extractExcelTables(buffer);
    return await runExcelSheetsThroughImportPipeline(sheets, context);
  } catch (err) {
    const label = kind === "csv" ? "CSV" : "Excel";
    return {
      sourceKind: "EXCEL",
      rawText: "",
      lines: [],
      fatalError:
        err instanceof Error
          ? `Kon het ${label}-bestand niet lezen: ${err.message}`
          : `Kon het ${label}-bestand niet lezen door een onbekende fout.`,
    };
  }
}

/**
 * Excel/CSV offer lines are always interpreted by the same AI provider every
 * other source uses (section: "de app is bewust gekoppeld aan de
 * Anthropic-provider") - this function never builds a `ParsedOfferLine`
 * itself for a column whose meaning the AI has to guess. For each sheet it
 * first locates the real offer table (preferring an Excel-defined Table,
 * then a generic header scan, then the older exact-match dictionary - see
 * `excelTableAdapter.ts`) so a title row and blank rows above the header
 * never reach the model as if they were data.
 *
 * When that header row matches enough of the KNOWN, exact supplier headers
 * (`excelDeterministicMapper.ts` - "Pack quantity", "Stems per bunch", "Fust
 * code", ...), column meaning is no longer inferred at all: every
 * numeric/structural field is read directly from its named column
 * deterministically, and Claude receives ONLY the free-text product
 * descriptions (never the ambiguous numeric columns) to recognize product/
 * variety from - it is structurally impossible for the model to decide which
 * column is stemsPerBox vs stemsPerBunch when it never sees either number.
 * A sheet whose header doesn't match this known dictionary falls back to the
 * general path: clean pipe-delimited text (still headers + rows only, never
 * the raw sheet) routed through `runTextImportSource`, same as any other
 * text source. A sheet with no detected table region at all falls back to a
 * raw flatten of every row, so a genuinely unstructured sheet still gets
 * *something* in front of the model instead of being silently dropped.
 *
 * The older direct column-mapper (`parseExcelTable`) is kept only as a
 * last-resort, deterministic safety net for when NEITHER of the above paths
 * produces anything (no `ANTHROPIC_API_KEY` configured and the rule-based
 * text provider's WhatsApp-oriented recognizer can't cope with a plain
 * numeric spreadsheet) - never as the primary path.
 */
async function runExcelSheetsThroughImportPipeline(
  sheets: ExcelSheetExtraction[],
  context: ImportContext,
): Promise<ImportResult> {
  const deterministicLines: ParsedOfferLine[] = [];
  const deterministicRawTextParts: string[] = [];
  const nonDeterministicSheetTexts: string[] = [];

  for (const sheet of sheets) {
    const region = detectTableRegion(sheet.table, sheet.definedTables);
    if (!region) {
      nonDeterministicSheetTexts.push(sheet.table.map((row) => row.map((c) => String(c ?? "")).join(" ")).join("\n"));
      continue;
    }

    const columns = detectDeterministicColumns(sheet.table[region.headerRowIndex] ?? []);
    if (hasSufficientDeterministicCoverage(columns)) {
      deterministicLines.push(...(await runDeterministicExcelSheet(sheet, region, columns, context)));
      deterministicRawTextParts.push(buildTabularText(sheet.table, region));
      continue;
    }

    nonDeterministicSheetTexts.push(buildTabularText(sheet.table, region));
  }

  const combinedText = nonDeterministicSheetTexts.filter((t) => t.trim().length > 0).join("\n\n");
  const aiResult = combinedText.trim().length > 0 ? await runTextImportSource(combinedText, "EXCEL", (t) => t, context) : null;
  const aiLines = aiResult && !aiResult.fatalError ? aiResult.lines : [];
  const combinedRawText = [...deterministicRawTextParts, combinedText].filter((t) => t.trim().length > 0).join("\n\n");
  const allLines = [...deterministicLines, ...aiLines];

  if (allLines.length > 0) {
    return { sourceKind: "EXCEL", rawText: combinedRawText, lines: allLines };
  }

  // Last-resort deterministic fallback (see doc comment above): only reached
  // when neither the deterministic-mapping path nor the AI pipeline
  // produced anything usable.
  const fallbackLines: ParsedOfferLine[] = [];
  for (const sheet of sheets) {
    fallbackLines.push(...parseExcelTable(sheet.table));
  }
  if (fallbackLines.length > 0) {
    return { sourceKind: "EXCEL", rawText: combinedRawText, lines: fallbackLines };
  }

  return (
    aiResult ?? {
      sourceKind: "EXCEL",
      rawText: combinedRawText,
      lines: [],
      fatalError:
        "Er zijn geen herkenbare aanbiedingsregels gevonden in dit Excel-bestand. Controleer de inhoud of voeg de regels handmatig toe.",
    }
  );
}

// Deliberately NOT routed through `runTextImportSource`/`chunkTextSupplierOffer`:
// that chunker decides batch boundaries by looking for numeric "product
// signals" (a cm length, a price, a QB/HB/FB code) in each line - exactly the
// columns this deterministic path strips out before the text ever reaches the
// model. Without a numeric signal, a large description-only list would be
// misclassified as pure "context" and sent as a single oversized call, whose
// *output* (the model still has to fill the full per-line schema even to say
// productGroup/variety) can truncate at the token limit even though the
// *input* itself is small - the exact failure mode this fixed-size batching
// avoids by construction. Same proven batch size as the general chunker's own
// default (`DEFAULT_TARGET_PRODUCT_ROWS` in textChunking.ts).
const DESCRIPTION_BATCH_SIZE = 22;

/**
 * Runs one sheet through the deterministic-header path: every
 * numeric/structural field is read straight from its named column
 * (`extractDeterministicRows`, never via AI); only the free-text product
 * descriptions are sent to the provider, in small fixed-size batches, asking
 * it for product/variety recognition alone. Results are merged back by a
 * stable row-index tag, never by array position (`mergeDeterministicRowsWithDescriptionLines`).
 * A single bad batch (or a total AI outage) never blocks the deterministic
 * numeric data or fails the whole sheet - a row the AI couldn't be matched
 * back to still gets a real (flagged-for-review) line.
 */
async function runDeterministicExcelSheet(
  sheet: ExcelSheetExtraction,
  region: DetectedTableRegion,
  columns: Partial<Record<DeterministicField, number>>,
  context: ImportContext,
): Promise<ParsedOfferLine[]> {
  const rows = extractDeterministicRows(sheet.table, region, columns);
  if (rows.length === 0) return [];

  const provider = getImportParserProvider();
  const descriptionLines: ParsedOfferLine[] = [];

  for (let i = 0; i < rows.length; i += DESCRIPTION_BATCH_SIZE) {
    const batch = rows.slice(i, i + DESCRIPTION_BATCH_SIZE);
    try {
      const batchLines = await provider.parseOfferSource({ kind: "text", text: buildDescriptionListText(batch) }, context);
      descriptionLines.push(...batchLines);
    } catch (err) {
      if (err instanceof AnthropicNoLinesDetectedError) continue;
      // Any other batch failure (transport, truncation, no API key, ...): the
      // rows in THIS batch simply get no AI-matched product/variety - the
      // merge step below still turns each into a real, review-flagged line
      // from its own raw description, never losing the deterministic fields.
      console.warn("[import:excel-deterministic] description batch failed", {
        batchIndex: Math.floor(i / DESCRIPTION_BATCH_SIZE),
        batchSize: batch.length,
        errorName: err instanceof Error ? err.name : typeof err,
      });
    }
  }

  return mergeDeterministicRowsWithDescriptionLines(rows, descriptionLines);
}

async function runPdfImport(buffer: Buffer, context: ImportContext): Promise<ImportResult> {
  let text: string;
  try {
    text = await extractPdfText(buffer);
  } catch (err) {
    return {
      sourceKind: "PDF",
      rawText: "",
      lines: [],
      fatalError:
        err instanceof Error ? `Kon het PDF-bestand niet lezen: ${err.message}` : "Kon het PDF-bestand niet lezen.",
    };
  }

  if (!isPdfTextUseful(text)) {
    // A scanned PDF has no searchable text. The installed Anthropic SDK
    // (0.30.1) has no native PDF/document content block - only text and
    // base64 images exist (see ImageBlockParam in
    // node_modules/@anthropic-ai/sdk/resources/messages.d.ts) - and
    // converting PDF pages to images would need a new dependency this step
    // isn't scoped to add. A scanned PDF is therefore a clear, honest
    // fallback to manual entry (or, now, pasting the text directly) rather
    // than an unreliable image conversion.
    return {
      sourceKind: "PDF",
      rawText: "",
      lines: [],
      fatalError:
        "Deze PDF lijkt gescand (geen doorzoekbare tekst) en kan nog niet automatisch worden gelezen. Plak de tekst in plaats daarvan, of voeg de regels handmatig toe.",
    };
  }
  return runTextImportSource(text, "PDF", (t) => t, context);
}

async function runImageImport(
  buffer: Buffer,
  context: ImportContext,
  fileMeta?: RunImportFileMeta,
): Promise<ImportResult> {
  const mediaType = resolveImageMediaType(fileMeta?.fileName ?? "", fileMeta?.mimeType);
  if (!mediaType) {
    return {
      sourceKind: "IMAGE",
      rawText: "",
      lines: [],
      fatalError: "Dit afbeeldingsformaat wordt nog niet ondersteund. Gebruik PNG, JPG of WEBP.",
    };
  }

  const provider = getImportParserProvider();
  try {
    // The original image bytes go straight to the (vision-capable) provider
    // - no OCR step, no intermediate text extraction.
    const lines = await provider.parseOfferSource(
      { kind: "image", bytes: buffer, mediaType, fileName: fileMeta?.fileName },
      context,
    );
    return { sourceKind: "IMAGE", rawText: "", lines };
  } catch (err) {
    // Covers: no API key, unsupported/empty/too-large image, timeout,
    // request rejected, invalid response, zero lines detected - every one of
    // these is a specific, typed error from the provider (see provider.ts);
    // never a raw/generic exception.
    return {
      sourceKind: "IMAGE",
      rawText: "",
      lines: [],
      fatalError:
        err instanceof Error ? err.message : "Afbeelding kon niet automatisch worden gelezen door een onbekende fout.",
    };
  }
}

/**
 * One extraction batch failed hard (transport error, truncation, invalid tool
 * input, ...). This fails the WHOLE import - no partial result is ever
 * persisted - and names which part of a chunked list failed so the reviewer
 * knows exactly where to look before retrying. Only used when the source was
 * split into more than one batch; a single-batch failure surfaces the
 * provider's own specific error unchanged.
 */
export class TextBatchExtractionError extends Error {
  constructor(
    readonly batchIndex: number,
    readonly totalBatches: number,
    readonly cause: unknown,
  ) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(
      `De AI kon deel ${batchIndex + 1} van ${totalBatches} van deze leverancierslijst niet verwerken. Probeer het opnieuw. (${causeMessage})`,
    );
    this.name = "TextBatchExtractionError";
  }
}

/**
 * Runs every chunk of a (possibly large) text source through the provider's
 * existing forced-tool-use flow, sequentially, and concatenates the results in
 * source order (section: durable chunked extraction). Failure policy:
 *  - A batch that legitimately found NO lines contributes nothing but does not
 *    fail its siblings - the caller's final empty-result check reports the
 *    overall "no recognizable lines" case uniformly.
 *  - Any real batch failure (transport, truncation, invalid tool input) throws
 *    and fails the whole import; nothing partial is returned or persisted.
 * Only safe metadata is logged (never the supplier text).
 */
async function extractTextInBatches(
  provider: ImportParserProvider,
  chunks: TextChunk[],
  context: ImportContext,
): Promise<ParsedOfferLine[]> {
  const merged: ParsedOfferLine[] = [];
  for (const chunk of chunks) {
    let chunkLines: ParsedOfferLine[];
    try {
      chunkLines = await provider.parseOfferSource({ kind: "text", text: chunk.composedText }, context);
    } catch (err) {
      if (err instanceof AnthropicNoLinesDetectedError) {
        // This batch found nothing - tolerate it and let the merged-empty
        // check below decide the overall outcome. (For a single-batch import
        // this reproduces the previous "zero lines -> fatalError" behavior.)
        console.info("[import:chunking] batch found no lines", {
          batchIndex: chunk.index,
          totalBatches: chunks.length,
          productRowCount: chunk.productRowCount,
        });
        continue;
      }
      if (chunks.length > 1) throw new TextBatchExtractionError(chunk.index, chunks.length, err);
      throw err;
    }
    merged.push(...chunkLines);
    console.info("[import:chunking] batch extracted", {
      batchIndex: chunk.index,
      totalBatches: chunks.length,
      productRowCount: chunk.productRowCount,
      outputLineCount: chunkLines.length,
    });
  }
  return merged;
}

/**
 * Shared entry point for every plain-text source: an uploaded .eml/.txt file,
 * PDF-extracted text, the Excel/CSV flatten-to-text fallback, and pasted
 * WhatsApp/email text (via `runPastedTextImport` above) - all funnel through
 * here so there is exactly one place that builds text batches, calls the
 * provider factory, and interprets the result (section 3: "Voorkom dubbele
 * parserlogica").
 *
 * Large lists are segmented into bounded batches (`chunkTextSupplierOffer`),
 * each extracted through the provider's existing forced structured-tool-use
 * flow and merged back in source order - so a 100+ row list no longer
 * truncates a single over-large call. A shared "length range + price table"
 * document is then expanded deterministically (`applyLengthRangeExpansion`),
 * which is a no-op for any source without such a table. Small lists stay a
 * single, byte-for-byte-unchanged call.
 */
export async function runTextImportSource(
  raw: string,
  sourceKind: SourceFileKind,
  preprocess: (raw: string) => string,
  context: ImportContext,
): Promise<ImportResult> {
  const text = preprocess(raw);
  const provider = getImportParserProvider();
  const chunks = chunkTextSupplierOffer(text);
  const priceTable = parseSharedPriceTable(text);

  console.info("[import:chunking] source segmented", {
    sourceKind,
    sourceBytes: Buffer.byteLength(text, "utf-8"),
    chunkCount: chunks.length,
    priceTierCount: priceTable.length,
  });

  try {
    const merged = await extractTextInBatches(provider, chunks, context);
    // Deterministic business rule: expand length-range rows across the shared
    // price table (no-op when the document has no such table).
    const lines = applyLengthRangeExpansion(merged, priceTable);

    if (lines.length === 0) {
      // A syntactically successful parse with zero recognized lines is not a
      // silent technical success (section 3: "Eén lege parseruitkomst moet
      // een concrete fout geven, geen succesvol aanbod met nul regels"). This
      // applies uniformly to every provider (the rule-based provider has no
      // zero-lines guard of its own) and every text-based source.
      return {
        sourceKind,
        rawText: text,
        lines: [],
        fatalError:
          "Er zijn geen herkenbare aanbiedingsregels gevonden in deze tekst. Controleer de inhoud of voeg de regels handmatig toe.",
      };
    }

    console.info("[import:chunking] import merged", {
      sourceKind,
      chunkCount: chunks.length,
      mergedLineCount: merged.length,
      finalLineCount: lines.length,
    });
    return { sourceKind, rawText: text, lines };
  } catch (err) {
    // A provider/batch failure (AI unavailable, timeout, truncation, one batch
    // failing, ...) must never surface as a raw/generic exception - report it
    // as a fatalError with the specific reason so the reviewer can fall back
    // to manual entry, exactly like the PDF/IMAGE extraction failures above.
    // No partial lines are ever returned.
    return {
      sourceKind,
      rawText: text,
      lines: [],
      fatalError:
        err instanceof Error ? err.message : "Automatisch uitlezen is mislukt door een onbekende fout.",
    };
  }
}
