import { MAX_IMAGE_BYTES } from "./provider";
import type { SourceFileKind } from "./types";

/**
 * General upload file size cap, shared by every file type (PDF/Excel/CSV/
 * EML/TXT/image). Deliberately reuses the vision provider's own
 * `MAX_IMAGE_BYTES` (8 MB) as a single source of truth rather than a second,
 * independent magic number that could drift out of sync - an image upload is
 * already checked against exactly this limit a second time, deeper in
 * `AnthropicParserProvider.parseOfferSource` (defense in depth), and every
 * other supported file type is realistically well under this size too. Stays
 * comfortably below the Server Action's 10 MB `bodySizeLimit`
 * (next.config.mjs), which also has to fit the rest of the multipart form
 * data (supplier id, title, ...).
 */
export const MAX_UPLOAD_FILE_BYTES = MAX_IMAGE_BYTES;

/**
 * Cap on pasted WhatsApp/email text, in characters. 100,000 characters is
 * generously above any realistic pasted price list (even a very long
 * WhatsApp thread or a multi-page email runs to a few thousand characters) -
 * this exists purely to reject an accidental paste of an entire unrelated
 * document, not to constrain normal use.
 */
export const MAX_PASTED_TEXT_LENGTH = 100_000;

/** Minimal, framework-agnostic shape of an uploaded file, enough to validate without touching its bytes. */
export interface UploadFileMeta {
  name: string;
  size: number;
}

export interface ValidateUploadSourceInput {
  /** The farm/supplier id selected in the form, if any. */
  farmId: string | null;
  /** The chosen file, or null when the user didn't pick one. */
  file: UploadFileMeta | null;
  /** The pasted text, or null/empty when the user didn't paste anything. */
  pastedText: string | null;
}

export type ValidateUploadSourceResult =
  | { ok: true; source: "file" }
  | { ok: true; source: "text"; text: string }
  | { ok: false; message: string };

/**
 * Validates the upload form's source choice before any file is read or any
 * import is attempted (section 1/7: exactly one of file-or-pasted-text,
 * supplier required, size/length limits). Pure and side-effect-free - takes
 * only plain metadata, never a real `File`/`Buffer`, so it's directly
 * unit-testable without constructing browser File objects or touching disk.
 */
export function validateUploadSource(input: ValidateUploadSourceInput): ValidateUploadSourceResult {
  if (!input.farmId || !input.farmId.trim()) {
    return { ok: false, message: "Kies eerst een leverancier voordat je een aanbieding uploadt." };
  }

  const hasFile = input.file !== null && input.file.size > 0;
  const trimmedText = (input.pastedText ?? "").trim();
  const hasText = trimmedText.length > 0;

  if (hasFile && hasText) {
    return { ok: false, message: "Gebruik óf een bestand óf geplakte tekst, niet allebei tegelijk." };
  }
  if (!hasFile && !hasText) {
    return { ok: false, message: "Kies een bestand om te uploaden of plak WhatsApp-/e-mailtekst." };
  }

  if (hasFile) {
    if (input.file!.size > MAX_UPLOAD_FILE_BYTES) {
      return {
        ok: false,
        message: `Dit bestand is groter dan de maximale ${Math.round(MAX_UPLOAD_FILE_BYTES / (1024 * 1024))} MB. Verklein het bestand en probeer het opnieuw.`,
      };
    }
    return { ok: true, source: "file" };
  }

  if (trimmedText.length > MAX_PASTED_TEXT_LENGTH) {
    return {
      ok: false,
      message: `De geplakte tekst is te lang (maximaal ${MAX_PASTED_TEXT_LENGTH.toLocaleString("nl-NL")} tekens). Plak een kortere selectie.`,
    };
  }
  return { ok: true, source: "text", text: trimmedText };
}

/**
 * Whether `detectFileType()` recognized the uploaded file at all. A real file
 * that resolves to "MANUAL" means its extension/MIME type matched nothing we
 * support - that must produce a clear, specific validation error (section 8)
 * rather than silently proceeding into an empty manual import.
 */
export function isUploadableFileKind(fileType: SourceFileKind): boolean {
  return fileType !== "MANUAL";
}

const SUPPORTED_FILE_TYPES_MESSAGE =
  "Dit bestandstype wordt niet ondersteund. Gebruik PDF, Excel (.xlsx/.csv), e-mail (.eml/.txt), of een afbeelding (PNG/JPG/WEBP/GIF).";

export function unsupportedFileTypeMessage(): string {
  return SUPPORTED_FILE_TYPES_MESSAGE;
}
