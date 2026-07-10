import type { ImportResult, ParsedOfferLine, SourceFileKind } from "./types";
import { extractPdfText, isPdfTextUseful } from "./extract/pdfText";
import { extractExcelTables } from "./extract/excelTable";
import { extractEmailText } from "./extract/emailText";
import { extractImageText } from "./extract/imageText";
import { parseExcelTable } from "./excelParser";
import { getImportParserProvider } from "./provider";

/**
 * Orchestrates the full import pipeline (spec section 24, steps 1-7):
 * file type -> text/table extraction -> segmentation+field recognition (or
 * direct column mapping for Excel) -> confidence -> draft lines. Steps 8-9
 * (user review, definitive save) happen in the UI/API layer, not here - this
 * function never touches the database.
 */
export async function runImport(
  fileType: SourceFileKind,
  buffer: Buffer,
): Promise<ImportResult> {
  switch (fileType) {
    case "EXCEL":
      return runExcelImport(buffer);
    case "PDF":
      return runPdfImport(buffer);
    case "EMAIL":
      return runTextImport(buffer.toString("utf-8"), "EMAIL", extractEmailText);
    case "IMAGE":
      return runImageImport(buffer);
    case "MANUAL":
    default:
      return { sourceKind: "MANUAL", rawText: "", lines: [] };
  }
}

async function runExcelImport(buffer: Buffer): Promise<ImportResult> {
  const sheets = await extractExcelTables(buffer);
  const lines: ParsedOfferLine[] = [];
  for (const sheet of sheets) {
    lines.push(...parseExcelTable(sheet.table));
  }

  if (lines.length === 0) {
    // No recognizable header/columns - fall back to flattening cells to text
    // and running the free-text parser, per section 24 (Excel first tries
    // direct columns, then the general parser as a fallback).
    const flattened = sheets
      .flatMap((s) => s.table)
      .map((row) => row.map((c) => String(c ?? "")).join(" "))
      .join("\n");
    const provider = getImportParserProvider();
    const fallbackLines = await provider.parseOfferText(flattened);
    return { sourceKind: "EXCEL", rawText: flattened, lines: fallbackLines };
  }

  const rawText = sheets.map((s) => s.table.map((r) => r.join(" ")).join("\n")).join("\n\n");
  return { sourceKind: "EXCEL", rawText, lines };
}

async function runPdfImport(buffer: Buffer): Promise<ImportResult> {
  const text = await extractPdfText(buffer);
  if (!isPdfTextUseful(text)) {
    // Non-searchable ("scanned") PDF - fall back to OCR.
    try {
      const ocrText = await extractImageText(buffer);
      return runTextImport(ocrText, "PDF", (t) => t);
    } catch (err) {
      return {
        sourceKind: "PDF",
        rawText: "",
        lines: [],
        fatalError: err instanceof Error ? err.message : "PDF could not be read automatically",
      };
    }
  }
  return runTextImport(text, "PDF", (t) => t);
}

async function runImageImport(buffer: Buffer): Promise<ImportResult> {
  try {
    const text = await extractImageText(buffer);
    return runTextImport(text, "IMAGE", (t) => t);
  } catch (err) {
    return {
      sourceKind: "IMAGE",
      rawText: "",
      lines: [],
      fatalError: err instanceof Error ? err.message : "Image could not be read automatically",
    };
  }
}

async function runTextImport(
  raw: string,
  sourceKind: SourceFileKind,
  preprocess: (raw: string) => string,
): Promise<ImportResult> {
  const text = preprocess(raw);
  const provider = getImportParserProvider();
  const lines = await provider.parseOfferText(text);
  return { sourceKind, rawText: text, lines };
}
