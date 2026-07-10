import type { SourceFileKind } from "../types";

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
