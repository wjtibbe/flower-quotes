import type { ImportContext, ImportResult, ParsedOfferLine, SourceFileKind } from "./types";
import { extractPdfText, isPdfTextUseful } from "./extract/pdfText";
import { extractExcelTables } from "./extract/excelTable";
import { extractCsvTables } from "./extract/csv";
import { extractEmailText } from "./extract/emailText";
import { resolveImageMediaType, resolveExcelFileKind } from "./extract/detectFileType";
import { parseExcelTable } from "./excelParser";
import { getImportParserProvider } from "./provider";

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
    const sheets = kind === "csv" ? await extractCsvTables(buffer) : await extractExcelTables(buffer);
    const lines: ParsedOfferLine[] = [];
    for (const sheet of sheets) {
      lines.push(...parseExcelTable(sheet.table));
    }

    if (lines.length === 0) {
      // No recognizable header/columns - fall back to flattening cells to text
      // and running them through the general text parser, per section 24
      // (Excel/CSV first tries direct columns, then the general parser as a
      // fallback) - this also now correctly reports a fatalError instead of a
      // silent empty result if that fallback also finds nothing (see
      // `runTextImportSource`).
      const flattened = sheets
        .flatMap((s) => s.table)
        .map((row) => row.map((c) => String(c ?? "")).join(" "))
        .join("\n");
      return runTextImportSource(flattened, "EXCEL", (t) => t, context);
    }

    const rawText = sheets.map((s) => s.table.map((r) => r.join(" ")).join("\n")).join("\n\n");
    return { sourceKind: "EXCEL", rawText, lines };
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
 * Shared entry point for every plain-text source: an uploaded .eml/.txt file,
 * PDF-extracted text, the Excel/CSV flatten-to-text fallback, and pasted
 * WhatsApp/email text (via `runPastedTextImport` above) - all funnel through
 * here so there is exactly one place that builds a `TextImportSource`, calls
 * the provider factory, and interprets the result (section 3: "Voorkom
 * dubbele parserlogica").
 */
export async function runTextImportSource(
  raw: string,
  sourceKind: SourceFileKind,
  preprocess: (raw: string) => string,
  context: ImportContext,
): Promise<ImportResult> {
  const text = preprocess(raw);
  const provider = getImportParserProvider();
  try {
    const lines = await provider.parseOfferSource({ kind: "text", text }, context);
    if (lines.length === 0) {
      // A syntactically successful parse with zero recognized lines is not a
      // silent technical success (section 3: "Eén lege parseruitkomst moet
      // een concrete fout geven, geen succesvol aanbod met nul regels"). The
      // Anthropic provider already guards against this for its own responses
      // (AnthropicNoLinesDetectedError), but the rule-based provider (used
      // whenever ANTHROPIC_API_KEY isn't configured) has no such guard, so
      // this check applies uniformly to every provider and every text-based
      // source.
      return {
        sourceKind,
        rawText: text,
        lines: [],
        fatalError:
          "Er zijn geen herkenbare aanbiedingsregels gevonden in deze tekst. Controleer de inhoud of voeg de regels handmatig toe.",
      };
    }
    return { sourceKind, rawText: text, lines };
  } catch (err) {
    // A provider failure (AI unavailable, timeout, malformed JSON, ...) must
    // never surface as a raw/generic exception - report it as a fatalError
    // with the provider's specific reason so the reviewer can fall back to
    // manual entry, exactly like the PDF/IMAGE extraction failures above.
    return {
      sourceKind,
      rawText: text,
      lines: [],
      fatalError:
        err instanceof Error ? err.message : "Automatisch uitlezen is mislukt door een onbekende fout.",
    };
  }
}
