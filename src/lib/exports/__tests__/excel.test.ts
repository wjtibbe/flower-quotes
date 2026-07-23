import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildCustomerExcel, buildInternalExcel } from "../excel";
import type { QuoteForExport } from "../types";

// The quote-pipeline consistency fix: exports must use the QuoteLine's own
// frozen snapshot (the actually-quoted quantity/stemsPerBox), never
// re-interpret the FarmOfferLine's live availability - deliberately gives
// the FarmOfferLine a DIFFERENT boxesAvailable than the QuoteLine's
// quantityBoxes below, so a test failure here would mean the export is
// reading the wrong source.
function quoteFixture(overrides: Record<string, unknown> = {}): QuoteForExport {
  const base = {
    quoteNumber: "Q-20260723-0001",
    currency: "USD",
    incoterm: "FOB",
    exchangeRateIsManual: false,
    exchangeRateDefaultValue: null,
    exchangeRateValue: null,
    exchangeRateBase: null,
    exchangeRateQuote: null,
    customer: { companyName: "Acme Flowers", destination: null },
    origin: { country: "Ecuador", city: "Quito" },
    destination: { city: "Miami" },
    lines: [
      {
        id: "quoteline-1",
        farm: { name: "Test Farm" },
        fobPricePerStem: { toString: () => "0.400000" },
        freightPerStem: null,
        clearingAndInspectionPerStem: null,
        handlingPerStem: null,
        additionalCostPerStem: null,
        costPricePerStemSource: { toString: () => "0.400000" },
        costPricePerStemQuote: { toString: () => "0.400000" },
        marginPercent: { toString: () => "20" },
        calculatedSellPricePerStem: { toString: () => "0.480000" },
        manualSellPricePerStem: null,
        sourceCurrency: "USD",
        exchangeRateBase: null,
        exchangeRateQuote: null,
        exchangeRateValue: null,
        // The frozen, actually-quoted quantity - 5 boxes / 100 stems-per-box.
        quantityBoxes: 5,
        stemsPerBox: 100,
        farmOfferLine: {
          productGroupRaw: "Rose",
          varietyRaw: "Freedom",
          colorRaw: null,
          gradeRaw: null,
          treatmentRaw: "normal",
          boxType: "QB",
          // Deliberately different from quantityBoxes above, and deliberately
          // null for the new-style case - the export must never read this.
          boxesAvailable: 999,
          notes: null,
          productVariant: null,
          farmOffer: { farm: { name: "Test Farm" } },
        },
      },
    ],
  };
  return { ...base, ...overrides } as unknown as QuoteForExport;
}

async function readSheet(buffer: Buffer, sheetIndex = 1) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook.worksheets[sheetIndex - 1];
}

describe("buildCustomerExcel - section 19 export uses QuoteLine snapshot", () => {
  it("uses the QuoteLine's quantityBoxes, not the FarmOfferLine's (different) boxesAvailable", async () => {
    const buffer = await buildCustomerExcel(quoteFixture());
    const sheet = await readSheet(buffer);
    const headerRow = sheet.getRow(5).values as unknown[];
    const dozenCol = headerRow.findIndex((v) => v === "Dozen");
    const dataRow = sheet.getRow(6).values as unknown[];
    expect(dataRow[dozenCol]).toBe(5);
    expect(dataRow[dozenCol]).not.toBe(999);
  });

  it("shows total stems as quantityBoxes x stemsPerBox from the snapshot", async () => {
    const buffer = await buildCustomerExcel(quoteFixture());
    const sheet = await readSheet(buffer);
    const headerRow = sheet.getRow(5).values as unknown[];
    const totalCol = headerRow.findIndex((v) => v === "Totaal stelen");
    const dataRow = sheet.getRow(6).values as unknown[];
    expect(dataRow[totalCol]).toBe(500);
  });

  it("stems per box comes from the QuoteLine snapshot", async () => {
    const buffer = await buildCustomerExcel(quoteFixture());
    const sheet = await readSheet(buffer);
    const headerRow = sheet.getRow(5).values as unknown[];
    const stemsCol = headerRow.findIndex((v) => v === "Stelen/doos");
    const dataRow = sheet.getRow(6).values as unknown[];
    expect(dataRow[stemsCol]).toBe(100);
  });
});

describe("buildInternalExcel - section 19 export uses QuoteLine snapshot", () => {
  it("uses the QuoteLine's quantityBoxes/stemsPerBox/total stems, never a boxesAvailable ?? 1 default", async () => {
    const buffer = await buildInternalExcel(quoteFixture());
    const sheet = await readSheet(buffer);
    const headerRow = sheet.getRow(1).values as unknown[];
    const dozenCol = headerRow.findIndex((v) => v === "Dozen");
    const totalCol = headerRow.findIndex((v) => v === "Totaal stelen");
    const dataRow = sheet.getRow(2).values as unknown[];
    expect(dataRow[dozenCol]).toBe(5);
    expect(dataRow[totalCol]).toBe(500);
  });

  it("legacy quote export still works when quantityBoxes/stemsPerBox are present (backward compatibility)", async () => {
    const legacyFixture = quoteFixture({
      lines: [
        {
          ...quoteFixture().lines[0],
          quantityBoxes: 4,
          stemsPerBox: 25,
          farmOfferLine: { ...quoteFixture().lines[0].farmOfferLine, boxesAvailable: 4 },
        },
      ],
    });
    const buffer = await buildInternalExcel(legacyFixture);
    const sheet = await readSheet(buffer);
    const headerRow = sheet.getRow(1).values as unknown[];
    const totalCol = headerRow.findIndex((v) => v === "Totaal stelen");
    const dataRow = sheet.getRow(2).values as unknown[];
    expect(dataRow[totalCol]).toBe(100);
  });
});
