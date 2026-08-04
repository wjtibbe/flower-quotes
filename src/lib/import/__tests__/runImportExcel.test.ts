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

async function buildNikitaWorkbookBuffer(dataRows: [number, number, string, string, number, number, number, number][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Aanbiedingen");
  sheet.getCell("A1").value = "Nikita";
  const headers = [
    "Packs left",
    "Pack quantity",
    "Fust code",
    "Product description",
    "Stem length",
    "Stems per bunch",
    "Box weight",
    "FOB price USD",
  ];
  headers.forEach((h, i) => (sheet.getCell(4, i + 1).value = h));
  dataRows.forEach((row, ri) => {
    row.forEach((v, ci) => (sheet.getCell(5 + ri, ci + 1).value = v));
  });
  sheet.addTable({
    name: "OffersTable",
    ref: "A4",
    headerRow: true,
    columns: headers.map((h) => ({ name: h })),
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

describe("Test 4 + Test 7: headers reach the provider as readable table text", () => {
  it("the row-4 header line and pipe-delimited data rows are present in what the provider receives", async () => {
    fakeParse.mockResolvedValue([line()]);
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);

    const result = await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });

    expect(result.fatalError).toBeUndefined();
    expect(fakeParse).toHaveBeenCalledTimes(1);
    const [source] = fakeParse.mock.calls[0];
    expect(source.kind).toBe("text");
    expect(source.text).toContain("Product description");
    expect(source.text).toContain("FOB price USD");
    expect(source.text).toContain("Rosa Ec Crystal Flame | 60 | 25 | 9 | 0.55");
    expect(source.text).not.toContain("Nikita\n"); // title row never sent as a data line
  });
});

describe("Test 8: provider is still the existing (mocked-in-place) Anthropic provider", () => {
  it("Excel routes through the exact same provider factory the text pipeline uses, not a separate Excel-only path", async () => {
    fakeParse.mockResolvedValue([line()]);
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);
    await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });
    expect(fakeParse).toHaveBeenCalledTimes(1);
  });
});

describe("Test 9: a box type the provider couldn't map (e.g. QBE) still reaches downstream normalization", () => {
  it("a null boxType coming back from the provider is preserved as null on the parsed line, ready for the existing default-to-QB business rule", async () => {
    fakeParse.mockResolvedValue([
      line({ boxType: undefined, parserWarnings: ["Box type code 'QBE' is not a recognized standard box type"] }),
    ]);
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);
    const result = await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].boxType).toBeUndefined();
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

  it("never throws even when the provider itself fails", async () => {
    fakeParse.mockRejectedValue(new Error("boom"));
    const buffer = await buildNikitaWorkbookBuffer([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);
    await expect(
      runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" }),
    ).resolves.toMatchObject({ lines: [] });
  });
});

describe("Test 11: an existing header-on-row-1 Excel file (no title rows, no Excel Table) still works", () => {
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
  it("multiple data rows reach the provider in the exact same order as the sheet", async () => {
    fakeParse.mockResolvedValue([line()]);
    const buffer = await buildNikitaWorkbookBuffer([
      [1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55],
      [2, 150, "QB", "Rosa Ec Freedom", 50, 20, 8, 0.42],
      [0, 80, "HB", "Rosa Ec Vendela", 70, 25, 10, 0.6],
    ]);
    await runImport("EXCEL", buffer, { supplierName: "Nikita" }, { fileName: "Nikita TEST.xlsx" });
    const [source] = fakeParse.mock.calls[0];
    const crystalIdx = source.text.indexOf("Crystal Flame");
    const freedomIdx = source.text.indexOf("Freedom");
    const vendelaIdx = source.text.indexOf("Vendela");
    expect(crystalIdx).toBeGreaterThan(-1);
    expect(freedomIdx).toBeGreaterThan(crystalIdx);
    expect(vendelaIdx).toBeGreaterThan(freedomIdx);
  });
});

// Test 12 (text/image/PDF imports remain unchanged) is covered by the
// existing, unmodified regression tests in runImport.test.ts (PDF/IMAGE/CSV
// routing) - this change only touches the EXCEL branch of runImport.ts, and
// the full suite (including those tests) stays green.
