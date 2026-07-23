import { afterEach, describe, expect, it } from "vitest";
import { runImport, runPastedTextImport } from "../runImport";
import type { ImageImportSource, ImportSource, TextImportSource } from "../types";

const ORIGINAL_API_KEY = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_API_KEY;
});

describe("runPastedTextImport - pasted WhatsApp/email text", () => {
  it("produces offer lines from a recognizable pasted price list via the rule-based fallback (no API key)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await runPastedTextImport("Dallas 60cm 20QBx100 $0.38");
    expect(result.fatalError).toBeUndefined();
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it("preserves the exact original pasted text as rawText, unmodified", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const pasted = "Dallas 60cm 20QBx100 $0.38";
    const result = await runPastedTextImport(pasted);
    expect(result.rawText).toBe(pasted);
  });

  it("gives a concrete fatalError instead of a silent empty success when nothing recognizable is found", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await runPastedTextImport("Good morning! Hope you are well. Best regards, Maria.");
    expect(result.lines).toEqual([]);
    expect(result.fatalError).toBeTruthy();
  });
});

describe("runImport - image without ANTHROPIC_API_KEY (regression)", () => {
  it("returns the existing clear fatalError instead of crashing or fabricating lines", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const buffer = Buffer.from([1, 2, 3, 4]);
    const result = await runImport("IMAGE", buffer, undefined, { fileName: "offer.png", mimeType: "image/png" });
    expect(result.lines).toEqual([]);
    expect(result.fatalError).toMatch(/ANTHROPIC_API_KEY/);
  });
});

describe("runImport - CSV routing", () => {
  it("reads a comma-delimited CSV through the CSV reader and produces offer lines", async () => {
    const csv = "Product,FOB\nDallas,0.38\n";
    const result = await runImport("EXCEL", Buffer.from(csv, "utf-8"), undefined, {
      fileName: "offer.csv",
      mimeType: "text/csv",
    });
    expect(result.fatalError).toBeUndefined();
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines[0].productGroupRaw).toBeTruthy();
  });

  it("gives a clear, specific message for a legacy .xls file instead of a generic read failure", async () => {
    const result = await runImport("EXCEL", Buffer.from("not a real xls"), undefined, {
      fileName: "offer.xls",
      mimeType: "application/vnd.ms-excel",
    });
    expect(result.fatalError).toMatch(/\.xls-bestand/);
    expect(result.lines).toEqual([]);
  });

  it("still reads a real .xlsx file through the normal ExcelJS xlsx reader (regression)", async () => {
    // A corrupt/non-xlsx buffer is enough to prove this path is NOT routed
    // through the CSV reader - it should fail with an Excel-flavored message,
    // not silently succeed as if it were CSV text.
    const result = await runImport("EXCEL", Buffer.from("PK-not-a-real-xlsx"), undefined, {
      fileName: "offer.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(result.fatalError).toMatch(/Excel-bestand/);
  });
});

describe("runImport - PDF text (regression)", () => {
  it("keeps producing a PDF-specific fatalError for an unreadable PDF buffer", async () => {
    const result = await runImport("PDF", Buffer.from("not a real pdf"), undefined);
    expect(result.fatalError).toBeTruthy();
    expect(result.lines).toEqual([]);
  });
});

// Purely a type-level sanity check that ImportSource/TextImportSource/
// ImageImportSource remain assignable the way runImport.ts and provider.ts
// expect - would fail to compile (not at runtime) if the discriminated union
// shape regressed.
function assertSourceShapesCompile(source: ImportSource): void {
  const text: TextImportSource = { kind: "text", text: "x" };
  const image: ImageImportSource = { kind: "image", bytes: Buffer.alloc(0), mediaType: "image/png" };
  void source;
  void text;
  void image;
}
void assertSourceShapesCompile;
