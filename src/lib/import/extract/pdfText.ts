/**
 * Extracts text from a text-based PDF using pdf-parse. Per section 24, OCR is
 * only used as a fallback for non-searchable PDFs (i.e. when this returns
 * effectively empty text) - that fallback is wired up at the call site in the
 * upload API route, which can route to the OCR extractor instead.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  // Imported lazily so this heavy dependency is only loaded on the server,
  // inside the code path that actually needs it.
  const pdfParse = (await import("pdf-parse")).default;
  const result = await pdfParse(buffer);
  return result.text ?? "";
}

/** A text-based PDF is one where extraction actually yielded meaningful content. */
export function isPdfTextUseful(text: string): boolean {
  return text.replace(/\s+/g, "").length > 20;
}
