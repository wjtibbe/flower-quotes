/**
 * OCR extraction for screenshots/photos and non-searchable PDFs (section 24:
 * "Gebruik OCR alleen voor screenshots, afbeeldingen en niet-doorzoekbare
 * PDF's"). No OCR engine is bundled in the MVP - wiring in e.g. Tesseract.js
 * or a cloud OCR API is a config-only change behind this function signature.
 * Until then, image uploads always fall back to manual entry, which is an
 * explicit, spec-mandated fallback path (section 24: "Maak een fallback voor
 * handmatige invoer wanneer parsing mislukt").
 */
export async function extractImageText(_buffer: Buffer): Promise<string> {
  throw new OcrNotConfiguredError();
}

export class OcrNotConfiguredError extends Error {
  constructor() {
    super(
      "OCR is not configured in this deployment. Please enter this offer's product lines manually.",
    );
    this.name = "OcrNotConfiguredError";
  }
}
