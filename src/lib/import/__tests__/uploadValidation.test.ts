import { describe, expect, it } from "vitest";
import {
  MAX_PASTED_TEXT_LENGTH,
  MAX_UPLOAD_FILE_BYTES,
  isUploadableFileKind,
  validateUploadSource,
} from "../uploadValidation";

const FARM_ID = "farm-1";

describe("validateUploadSource - source XOR validation", () => {
  it("a file without pasted text is valid", () => {
    const result = validateUploadSource({ farmId: FARM_ID, file: { name: "offer.pdf", size: 1000 }, pastedText: null });
    expect(result).toEqual({ ok: true, source: "file" });
  });

  it("pasted text without a file is valid", () => {
    const result = validateUploadSource({ farmId: FARM_ID, file: null, pastedText: "Dallas 60cm 0.38" });
    expect(result).toEqual({ ok: true, source: "text", text: "Dallas 60cm 0.38" });
  });

  it("a file AND pasted text together is invalid", () => {
    const result = validateUploadSource({
      farmId: FARM_ID,
      file: { name: "offer.pdf", size: 1000 },
      pastedText: "Dallas 60cm 0.38",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/niet allebei/i);
  });

  it("neither a file nor pasted text is invalid", () => {
    const result = validateUploadSource({ farmId: FARM_ID, file: null, pastedText: null });
    expect(result.ok).toBe(false);
  });

  it("whitespace-only pasted text counts as empty (same as no text at all)", () => {
    const result = validateUploadSource({ farmId: FARM_ID, file: null, pastedText: "   \n\t  " });
    expect(result.ok).toBe(false);
  });

  it("pasted text longer than MAX_PASTED_TEXT_LENGTH is invalid", () => {
    const tooLong = "a".repeat(MAX_PASTED_TEXT_LENGTH + 1);
    const result = validateUploadSource({ farmId: FARM_ID, file: null, pastedText: tooLong });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/te lang/i);
  });

  it("pasted text exactly at the limit is still valid", () => {
    const exact = "a".repeat(MAX_PASTED_TEXT_LENGTH);
    const result = validateUploadSource({ farmId: FARM_ID, file: null, pastedText: exact });
    expect(result.ok).toBe(true);
  });

  it("trims pasted text before returning it", () => {
    const result = validateUploadSource({ farmId: FARM_ID, file: null, pastedText: "  Dallas 60cm 0.38  \n" });
    expect(result).toEqual({ ok: true, source: "text", text: "Dallas 60cm 0.38" });
  });
});

describe("validateUploadSource - supplier required", () => {
  it("rejects when no supplier is selected", () => {
    const result = validateUploadSource({ farmId: null, file: null, pastedText: "Dallas 60cm 0.38" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/leverancier/i);
  });

  it("rejects a blank/whitespace farmId", () => {
    const result = validateUploadSource({ farmId: "   ", file: null, pastedText: "Dallas 60cm 0.38" });
    expect(result.ok).toBe(false);
  });
});

describe("validateUploadSource - file size", () => {
  it("rejects a file larger than MAX_UPLOAD_FILE_BYTES", () => {
    const result = validateUploadSource({
      farmId: FARM_ID,
      file: { name: "offer.pdf", size: MAX_UPLOAD_FILE_BYTES + 1 },
      pastedText: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/groter dan/i);
  });

  it("accepts a file exactly at MAX_UPLOAD_FILE_BYTES", () => {
    const result = validateUploadSource({
      farmId: FARM_ID,
      file: { name: "offer.pdf", size: MAX_UPLOAD_FILE_BYTES },
      pastedText: null,
    });
    expect(result.ok).toBe(true);
  });

  it("treats a zero-byte file as no file at all (falls through to the 'neither' error)", () => {
    const result = validateUploadSource({ farmId: FARM_ID, file: { name: "empty.pdf", size: 0 }, pastedText: null });
    expect(result.ok).toBe(false);
  });
});

describe("isUploadableFileKind", () => {
  it("accepts every real supported file kind", () => {
    expect(isUploadableFileKind("PDF")).toBe(true);
    expect(isUploadableFileKind("EXCEL")).toBe(true);
    expect(isUploadableFileKind("EMAIL")).toBe(true);
    expect(isUploadableFileKind("IMAGE")).toBe(true);
  });

  it("rejects MANUAL - an unrecognized file extension/MIME type", () => {
    expect(isUploadableFileKind("MANUAL")).toBe(false);
  });
});
