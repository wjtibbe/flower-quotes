import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import type { ParsedOfferLine } from "../types";

// Same pattern as runImportChunking.test.ts: replace the provider FACTORY
// with a controllable fake so the Excel routing/adapter is tested without
// any network call, while keeping every other real export (error classes,
// etc.) intact.
const { fakeParse } = vi.hoisted(() => ({ fakeParse: vi.fn() }));

vi.mock("../provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../provider")>();
  return {
    ...actual,
    getImportParserProvider: () => ({ name: "anthropic-fake", parseOfferSource: fakeParse }),
  };
});

import { runImport } from "../runImport";

function line(overrides: Partial<ParsedOfferLine> = {}): ParsedOfferLine {
  return {
    rawText: "1 100 QBE Rosa Ec Crystal Flame 60 25 9 0.55",
    productGroupRaw: "Rosa",
    varietyRaw: "Crystal Flame",
    lengthCm: 60,
    fobPricePerStem: "0.55",
    currency: "USD",
    confidence: "high",
    fieldConfidence: {},
    needsReview: false,
    parserWarnings: [],
    ...overrides,
  };
}

/** A fake provider response for the DETERMINISTIC path's description-only call: preserves the "#N | " row tag exactly, as the real prompt requires the model to (rawText copied verbatim). */
function descriptionLine(rowIndex: number, description: string, overrides: Partial<ParsedOfferLine> = {}): ParsedOfferLine {
  const spaceIdx = description.indexOf(" ");
  const productGroupRaw = spaceIdx === -1 ? description : description.slice(0, spaceIdx);
  const varietyRaw = spaceIdx === -1 ? undefined : description.slice(spaceIdx + 1);
  return {
    rawText: `#${rowIndex} | ${description}`,
    productGroupRaw,
    varietyRaw,
    confidence: "high",
    fieldConfidence: {},
    needsReview: false,
    parserWarnings: [],
    ...overrides,
  };
}

const NIKITA_HEADERS = [
  "Packs left",
  "Pack quantity",
  "Fust code",
  "Product description",
  "Stem length",
  "Stems per bunch",
  "Box weight",
  "FOB price USD",
];

async function buildNikitaWorkbookBuffer(dataRows: [number, number, string, string, number, number, number, number][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Aanbiedingen");
  sheet.getCell("A1").value = "Nikita";
  NIKITA_HEADERS.forEach((h, i) => (sheet.getCell(4, i + 1).value = h));
  dataRows.forEach((row, ri) => {
    row.forEach((v, ci) => (sheet.getCell(5 + ri, ci + 1).value = v));
  });
  sheet.addTable({
    name: "OffersTable",
    ref: "A4",
    headerRow: true,
    columns: NIKITA_HEADERS.map((h) => ({ name: h })),
    rows: dataRows.map(() => []),
  } as unknown as ExcelJS.TableProperties);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

beforeEach(() => {
  fakeParse.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Test 4 + Test 7: known Excel headers activate the deterministic path - the provider receives ONLY the free-text description, never the ambiguous numeric columns", () => {
  it("the provider's input contains the product description but never the header row or any numeric column value", async () => {
    fakeParse.mockResolvedValue([descriptionLine(1, "Rosa Ec Crystal Flame")]);
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);

    const result = await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });

    expect(result.fatalError).toBeUndefined();
    expect(fakeParse).toHaveBeenCalledTimes(1);
    const [source] = fakeParse.mock.calls[0];
    expect(source.kind).toBe("text");
    expect(source.text).toBe("#1 | Rosa Ec Crystal Flame");
    // The deterministic numeric columns must never reach the model at all.
    expect(source.text).not.toContain("Pack quantity");
    expect(source.text).not.toContain("Stems per bunch");
    expect(source.text).not.toContain("100");
    expect(source.text).not.toContain("0.55");
    expect(source.text).not.toContain("Nikita");
  });

  it("the final parsed line still has the deterministic fields, read straight from the sheet, not from the provider", async () => {
    fakeParse.mockResolvedValue([descriptionLine(1, "Rosa Ec Crystal Flame")]);
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);
    const result = await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });
    expect(result.lines).toHaveLength(1);
    const l = result.lines[0];
    expect(l.stemsPerBox).toBe(100); // "Pack quantity" - ALWAYS, never "Stems per bunch"
    expect(l.stemsPerBunch).toBe(25); // "Stems per bunch" - kept as its own distinct field
    expect(l.weightPerBoxKg).toBe("9");
    expect(l.fobPricePerStem).toBe("0.55");
    expect(l.lengthCm).toBe(60);
    expect(l.boxType).toBe("QBE");
    expect(l.boxesAvailable).toBe(1);
    expect(l.productGroupRaw).toBe("Rosa");
    expect(l.varietyRaw).toBe("Ec Crystal Flame");
  });
});

describe("Test 8: provider is still the existing (mocked-in-place) Anthropic provider", () => {
  it("Excel routes through the exact same provider factory the text pipeline uses, not a separate Excel-only path", async () => {
    fakeParse.mockResolvedValue([descriptionLine(1, "Rosa Ec Crystal Flame")]);
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);
    await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });
    expect(fakeParse).toHaveBeenCalledTimes(1);
  });
});

describe("Test 9: a box type the deterministic mapper read straight from 'Fust code' (e.g. QBE) still reaches downstream normalization", () => {
  it("boxType 'QBE' is read verbatim onto the parsed line (never inferred/rejected by the provider)", async () => {
    fakeParse.mockResolvedValue([descriptionLine(1, "Rosa Ec Crystal Flame")]);
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);
    const result = await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].boxType).toBe("QBE");
  });
});

describe("Test 10: a malformed workbook gives a controlled error, never an uncaught exception", () => {
  it("a corrupt .xlsx buffer returns a fatalError instead of throwing", async () => {
    const result = await runImport("EXCEL", Buffer.from("not a real workbook"), undefined, {
      fileName: "broken.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    expect(result.fatalError).toBeTruthy();
    expect(result.lines).toEqual([]);
  });

  it("never throws even when the provider itself fails, and the deterministic numeric data survives an AI outage", async () => {
    fakeParse.mockRejectedValue(new Error("boom"));
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);
    const result = await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });
    expect(result.fatalError).toBeUndefined();
    expect(result.lines).toHaveLength(1);
    // Product/variety recognition degrades gracefully; the deterministic
    // fields are completely unaffected by the provider failure.
    expect(result.lines[0].needsReview).toBe(true);
    expect(result.lines[0].stemsPerBox).toBe(100);
    expect(result.lines[0].fobPricePerStem).toBe("0.55");
  });
});

describe("Test 11: an existing header-on-row-1 Excel file (unknown headers - no deterministic match) still routes through the general AI path", () => {
  it("routes through the provider with the row-1 header intact", async () => {
    fakeParse.mockResolvedValue([line({ productGroupRaw: "Dallas" })]);
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet("Open Market");
    sheet.addRow(["Product", "Color", "Variety", "FOB BTA", "STEMS X QB"]);
    sheet.addRow(["Rose", "Red", "Dallas", 0.38, 20]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const result = await runImport("EXCEL", buffer, undefined, { fileName: "open-market.xlsx" });

    expect(result.fatalError).toBeUndefined();
    expect(fakeParse).toHaveBeenCalledTimes(1);
    const [source] = fakeParse.mock.calls[0];
    expect(source.text).toContain("Product | Color | Variety | FOB BTA | STEMS X QB");
    expect(source.text).toContain("Rose | Red | Dallas | 0.38 | 20");
  });
});

describe("Test 6 (integration): rows stay in source order end to end", () => {
  it("multiple data rows reach the provider (description-only) in the exact same order as the sheet", async () => {
    fakeParse.mockImplementation(async (source: { text: string }) => {
      return source.text
        .split("\n")
        .map((l: string) => {
          const m = /^#(\d+) \| (.+)$/.exec(l);
          return m ? descriptionLine(Number(m[1]), m[2]) : null;
        })
        .filter((l): l is ParsedOfferLine => l !== null);
    });
    const buffer = await buildNikitaWorkbookBuffer([
      [1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55],
      [2, 150, "QB", "Rosa Ec Freedom", 50, 20, 8, 0.42],
      [0, 80, "HB", "Rosa Ec Vendela", 70, 25, 10, 0.6],
    ]);
    const result = await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });

    const [source] = fakeParse.mock.calls[0];
    const crystalIdx = source.text.indexOf("Crystal Flame");
    const freedomIdx = source.text.indexOf("Freedom");
    const vendelaIdx = source.text.indexOf("Vendela");
    expect(crystalIdx).toBeGreaterThan(-1);
    expect(freedomIdx).toBeGreaterThan(crystalIdx);
    expect(vendelaIdx).toBeGreaterThan(freedomIdx);

    expect(result.lines.map((l) => l.varietyRaw)).toEqual(["Ec Crystal Flame", "Ec Freedom", "Ec Vendela"]);
    expect(result.lines.map((l) => l.stemsPerBox)).toEqual([100, 150, 80]);
  });
});

describe("Regression: a large description-only list is batched, never sent as one oversized call", () => {
  it("149 rows produce multiple provider calls, not a single call that could truncate the model's output", async () => {
    fakeParse.mockImplementation(async (source: { text: string }) => {
      return source.text
        .split("\n")
        .map((l: string) => {
          const m = /^#(\d+) \| (.+)$/.exec(l);
          return m ? descriptionLine(Number(m[1]), m[2]) : null;
        })
        .filter((l): l is ParsedOfferLine => l !== null);
    });
    const rows: [number, number, string, string, number, number, number, number][] = Array.from({ length: 149 }, (_, i) => [
      1,
      100,
      "QBE",
      `Rosa Ec Variety ${i}`,
      60,
      25,
      9,
      0.5,
    ]);
    const buffer = await buildNikitaWorkbookBuffer(rows);

    const result = await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });

    expect(result.fatalError).toBeUndefined();
    expect(result.lines).toHaveLength(149);
    // A single un-chunked call for 149 rows is exactly the bug this guards
    // against (the real Nikita file: one oversized call hit max_tokens and
    // silently dropped every row's product/variety recognition).
    expect(fakeParse.mock.calls.length).toBeGreaterThan(1);
    // Every call must stay well under a size that risks truncating the
    // model's per-line output.
    for (const [source] of fakeParse.mock.calls) {
      expect(source.text.split("\n").length).toBeLessThanOrEqual(22);
    }
    // Every row still gets its deterministic stemsPerBox (Pack quantity),
    // never the Stems per bunch value, regardless of batching.
    expect(result.lines.every((l) => l.stemsPerBox === 100)).toBe(true);
  });
});

// Test 12 (text/image/PDF imports remain unchanged) is covered by the
// existing, unmodified regression tests in runImport.test.ts (PDF/IMAGE/CSV
// routing) - this change only touches the EXCEL branch of runImport.ts, and
// the full suite (including those tests) stays green.
