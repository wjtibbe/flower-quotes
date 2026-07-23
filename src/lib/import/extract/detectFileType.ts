import type { SourceFileKind, SupportedImageMediaType } from "../types";

const EXT_MAP: Record<string, SourceFileKind> = {
  pdf: "PDF",
  xlsx: "EXCEL",
  xls: "EXCEL",
  csv: "EXCEL",
  eml: "EMAIL",
  msg: "EMAIL",
  txt: "EMAIL", // pasted/saved email body
  png: "IMAGE",
  jpg: "IMAGE",
  jpeg: "IMAGE",
  webp: "IMAGE",
  gif: "IMAGE",
};

const MIME_MAP: Record<string, SourceFileKind> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "EXCEL",
  "application/vnd.ms-excel": "EXCEL",
  "text/csv": "EXCEL",
  "message/rfc822": "EMAIL",
  "text/plain": "EMAIL",
};

export function detectFileType(fileName: string, mimeType?: string | null): SourceFileKind {
  if (mimeType) {
    for (const [prefix, kind] of Object.entries(MIME_MAP)) {
      if (mimeType === prefix) return kind;
    }
    if (mimeType.startsWith("image/")) return "IMAGE";
  }

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "MANUAL";
}

const IMAGE_EXT_MEDIA_TYPE: Record<string, SupportedImageMediaType> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const IMAGE_MIME_MEDIA_TYPE: Record<string, SupportedImageMediaType> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
};

/**
 * Resolves the exact Anthropic vision media type for an uploaded image, from
 * its MIME type (preferred, when the browser supplied one) or its file
 * extension. Returns null for anything not in
 * `SUPPORTED_IMAGE_MEDIA_TYPES` (e.g. .bmp, .tiff, .heic) so the caller can
 * show a concrete "format not supported" message instead of guessing or
 * silently sending an unsupported type to the API.
 */
export function resolveImageMediaType(fileName: string, mimeType?: string | null): SupportedImageMediaType | null {
  if (mimeType && IMAGE_MIME_MEDIA_TYPE[mimeType]) return IMAGE_MIME_MEDIA_TYPE[mimeType];
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXT_MEDIA_TYPE[ext] ?? null;
}

/**
 * The three spreadsheet-ish formats that all classify as `SourceFileKind`
 * "EXCEL" need three different readers: ExcelJS's OOXML reader only
 * understands .xlsx; ExcelJS has no legacy .xls (BIFF) reader at all (its own
 * README/typings never mention .xls support - only .xlsx); .csv needs
 * ExcelJS's separate fast-csv-backed `workbook.csv` reader. This resolves
 * which of the three a given upload actually is, defaulting to "xlsx" only
 * when neither the MIME type nor the extension say otherwise.
 */
export type ExcelFileKind = "xlsx" | "xls" | "csv";

const EXCEL_EXT_KIND: Record<string, ExcelFileKind> = {
  xlsx: "xlsx",
  xls: "xls",
  csv: "csv",
};

const EXCEL_MIME_KIND: Record<string, ExcelFileKind> = {
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
};

export function resolveExcelFileKind(fileName: string, mimeType?: string | null): ExcelFileKind {
  if (mimeType && EXCEL_MIME_KIND[mimeType]) return EXCEL_MIME_KIND[mimeType];
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXCEL_EXT_KIND[ext] ?? "xlsx";
}
