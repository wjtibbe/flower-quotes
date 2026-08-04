import { describe, expect, it } from "vitest";
import {
  detectDeterministicColumns,
  hasSufficientDeterministicCoverage,
  extractDeterministicRows,
  buildDescriptionListText,
  parseRowIndexFromRawText,
  mergeDeterministicRowsWithDescriptionLines,
} from "../excelDeterministicMapper";
import type { SheetTable } from "../excelParser";
import type { ParsedOfferLine } from "../types";

const NIKITA_HEADER_ROW = [
  "Packs left",
  "Pack quantity",
  "Fust code",
  "Product description",
  "Stem length",
  "Stems per bunch",
  "Box weight",
  "FOB price USD",
];

function nikitaTable(rows: [number, number, string, string, number, number, number, number][]): SheetTable {
  return [["Nikita"], [], [], NIKITA_HEADER_ROW, ...rows];
}

describe("detectDeterministicColumns", () => {
  it("maps every known header to its field, case-insensitively", () => {
    const columns = detectDeterministicColumns(NIKITA_HEADER_ROW);
    expect(columns).toEqual({
      quantity: 0,
      stemsPerBox: 1,
      boxType: 2,
      sourceDescription: 3,
      lengthCm: 4,
      stemsPerBunch: 5,
      weightPerBoxKg: 6,
      fobPricePerStem: 7,
    });
  });

  it("is case-insensitive and trims whitespace", () => {
    const columns = detectDeterministicColumns(["  PACK QUANTITY  ", "product description"]);
    expect(columns.stemsPerBox).toBe(0);
    expect(columns.sourceDescription).toBe(1);
  });

  it("ignores unrecognized headers rather than erroring", () => {
    const columns = detectDeterministicColumns(["Some Other Column", "Product description"]);
    expect(columns.sourceDescription).toBe(1);
    expect(Object.keys(columns)).toEqual(["sourceDescription"]);
  });
});

describe("hasSufficientDeterministicCoverage", () => {
  it("is true for the full Nikita header set", () => {
    expect(hasSufficientDeterministicCoverage(detectDeterministicColumns(NIKITA_HEADER_ROW))).toBe(true);
  });

  it("is false when the description column itself is missing", () => {
    expect(hasSufficientDeterministicCoverage({ stemsPerBox: 0, boxType: 1, lengthCm: 2, weightPerBoxKg: 3 })).toBe(false);
  });

  it("is false when only description plus a couple of other fields are recognized (an unrelated sheet)", () => {
    expect(hasSufficientDeterministicCoverage({ sourceDescription: 0, boxType: 1 })).toBe(false);
  });
});

describe("Regression: Nikita's real column layout never lets 'Stems per bunch' be read as stemsPerBox", () => {
  it("Pack quantity ALWAYS maps to stemsPerBox, Stems per bunch ALWAYS maps to stemsPerBunch - even when they disagree", () => {
    const table = nikitaTable([[1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55]]);
    const region = { headerRowIndex: 3, lastDataRowIndex: 4, source: "excel-table" as const };
    const columns = detectDeterministicColumns(table[3]);
    const rows = extractDeterministicRows(table, region, columns);
    expect(rows).toHaveLength(1);
    expect(rows[0].stemsPerBox).toBe(100); // Pack quantity
    expect(rows[0].stemsPerBunch).toBe(25); // Stems per bunch - never confused with stemsPerBox
  });

  it("holds across every row of a 149-row-shaped sheet, never flipping which column wins", () => {
    const rows149: [number, number, string, string, number, number, number, number][] = Array.from({ length: 149 }, (_, i) => [
      1,
      100 + i, // Pack quantity varies per row
      "QBE",
      `Rosa Ec Variety ${i}`,
      60,
      25, // Stems per bunch stays constant - historically the value Claude sometimes picked instead
      9,
      0.5,
    ]);
    const table = nikitaTable(rows149);
    const region = { headerRowIndex: 3, lastDataRowIndex: table.length - 1, source: "excel-table" as const };
    const columns = detectDeterministicColumns(table[3]);
    const rows = extractDeterministicRows(table, region, columns);
    expect(rows).toHaveLength(149);
    rows.forEach((row, i) => {
      expect(row.stemsPerBox).toBe(100 + i); // always Pack quantity
      expect(row.stemsPerBunch).toBe(25); // always Stems per bunch, distinct field
    });
  });
});

describe("extractDeterministicRows: other known-header mappings", () => {
  it("maps Box weight -> weightPerBoxKg, FOB price USD -> fobPricePerStem, Fust code -> boxType, Stem length -> lengthCm, Packs left -> quantity", () => {
    const table = nikitaTable([[3, 100, "QB", "Rosa Freedom", 50, 25, 8, 0.42]]);
    const region = { headerRowIndex: 3, lastDataRowIndex: 4, source: "excel-table" as const };
    const columns = detectDeterministicColumns(table[3]);
    const [row] = extractDeterministicRows(table, region, columns);
    expect(row.quantity).toBe(3);
    expect(row.weightPerBoxKg).toBe("8");
    expect(row.fobPricePerStem).toBe("0.42");
    expect(row.boxType).toBe("QB");
    expect(row.lengthCm).toBe(50);
    expect(row.sourceDescription).toBe("Rosa Freedom");
  });

  it("skips a fully blank data row without producing an empty entry", () => {
    const table: SheetTable = [NIKITA_HEADER_ROW, [], [1, 100, "QB", "Rosa Freedom", 50, 25, 8, 0.42]];
    const region = { headerRowIndex: 0, lastDataRowIndex: 2, source: "excel-table" as const };
    const columns = detectDeterministicColumns(table[0]);
    const rows = extractDeterministicRows(table, region, columns);
    expect(rows).toHaveLength(1);
  });

  it("assigns stable, sequential row indices independent of skipped blank rows", () => {
    const table: SheetTable = [
      NIKITA_HEADER_ROW,
      [1, 100, "QB", "Rosa A", 50, 25, 8, 0.42],
      [],
      [1, 100, "QB", "Rosa B", 50, 25, 8, 0.42],
    ];
    const region = { headerRowIndex: 0, lastDataRowIndex: 3, source: "excel-table" as const };
    const columns = detectDeterministicColumns(table[0]);
    const rows = extractDeterministicRows(table, region, columns);
    expect(rows.map((r) => r.rowIndex)).toEqual([1, 2]);
  });
});

describe("buildDescriptionListText / parseRowIndexFromRawText: round trip", () => {
  it("builds a numbered, description-only list with no numeric columns present", () => {
    const table = nikitaTable([
      [1, 100, "QBE", "Rosa Ec Crystal Flame", 60, 25, 9, 0.55],
      [2, 150, "QB", "Rosa Ec Freedom", 50, 20, 8, 0.42],
    ]);
    const region = { headerRowIndex: 3, lastDataRowIndex: table.length - 1, source: "excel-table" as const };
    const columns = detectDeterministicColumns(table[3]);
    const rows = extractDeterministicRows(table, region, columns);
    const text = buildDescriptionListText(rows);
    expect(text).toBe("#1 | Rosa Ec Crystal Flame\n#2 | Rosa Ec Freedom");
    expect(text).not.toMatch(/\b100\b|\b150\b|0\.55|0\.42/);
  });

  it("recovers the row index from a preserved '#N | ...' rawText tag", () => {
    expect(parseRowIndexFromRawText("#7 | Rosa Ec Freedom")).toBe(7);
    expect(parseRowIndexFromRawText("#42 | some text")).toBe(42);
  });

  it("returns null (never guesses) when the tag is missing or malformed", () => {
    expect(parseRowIndexFromRawText("Rosa Ec Freedom")).toBeNull();
    expect(parseRowIndexFromRawText(undefined)).toBeNull();
    expect(parseRowIndexFromRawText("")).toBeNull();
  });
});

describe("mergeDeterministicRowsWithDescriptionLines", () => {
  function row(rowIndex: number, overrides: Partial<Parameters<typeof mergeDeterministicRowsWithDescriptionLines>[0][number]> = {}) {
    return {
      rowIndex,
      rawText: `${rowIndex} | 100 | QBE | Rosa Ec Crystal Flame | 60 | 25 | 9 | 0.55`,
      sourceDescription: "Rosa Ec Crystal Flame",
      quantity: 1,
      stemsPerBox: 100,
      stemsPerBunch: 25,
      weightPerBoxKg: "9",
      fobPricePerStem: "0.55",
      boxType: "QBE",
      lengthCm: 60,
      ...overrides,
    };
  }

  it("matches AI product/variety output back to the right row by index tag, not array position", () => {
    const rows = [row(1), row(2, { sourceDescription: "Rosa Ec Freedom" })];
    // Deliberately returned OUT OF ORDER - must still match correctly.
    const aiLines: ParsedOfferLine[] = [
      { rawText: "#2 | Rosa Ec Freedom", productGroupRaw: "Rosa", varietyRaw: "Freedom", confidence: "high", fieldConfidence: {}, needsReview: false, parserWarnings: [] },
      { rawText: "#1 | Rosa Ec Crystal Flame", productGroupRaw: "Rosa", varietyRaw: "Crystal Flame", confidence: "high", fieldConfidence: {}, needsReview: false, parserWarnings: [] },
    ];
    const merged = mergeDeterministicRowsWithDescriptionLines(rows, aiLines);
    expect(merged[0].varietyRaw).toBe("Crystal Flame");
    expect(merged[1].varietyRaw).toBe("Freedom");
  });

  it("deterministic fields always win, never overwritten by whatever the AI line happens to carry", () => {
    const rows = [row(1)];
    const aiLines: ParsedOfferLine[] = [
      {
        rawText: "#1 | Rosa Ec Crystal Flame",
        productGroupRaw: "Rosa",
        varietyRaw: "Crystal Flame",
        stemsPerBox: 999, // must be ignored entirely
        fobPricePerStem: "999.99", // must be ignored entirely
        boxType: "FB", // must be ignored entirely
        confidence: "high",
        fieldConfidence: {},
        needsReview: false,
        parserWarnings: [],
      },
    ];
    const merged = mergeDeterministicRowsWithDescriptionLines(rows, aiLines);
    expect(merged[0].stemsPerBox).toBe(100);
    expect(merged[0].fobPricePerStem).toBe("0.55");
    expect(merged[0].boxType).toBe("QBE");
  });

  it("a row with no matching AI line still produces a real, reviewable line (deterministic data survives an AI gap)", () => {
    const rows = [row(1)];
    const merged = mergeDeterministicRowsWithDescriptionLines(rows, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].needsReview).toBe(true);
    expect(merged[0].productGroupRaw).toBeTruthy();
    expect(merged[0].stemsPerBox).toBe(100);
    expect(merged[0].fobPricePerStem).toBe("0.55");
  });

  it("Regression: does NOT blindly trust the AI line's own needsReview flag - that field reflects box type/price/currency being null on a call that never saw them, not product/variety confidence", () => {
    const rows = [row(1)];
    const aiLines: ParsedOfferLine[] = [
      {
        rawText: "#1 | Rosa Ec Crystal Flame",
        productGroupRaw: "Rosa",
        varietyRaw: "Crystal Flame",
        needsReview: true, // as the shared schema always sets it here - must be ignored
        confidence: "high",
        fieldConfidence: {},
        parserWarnings: [],
      },
    ];
    const merged = mergeDeterministicRowsWithDescriptionLines(rows, aiLines);
    expect(merged[0].needsReview).toBe(false);
  });

  it("still flags needsReview true when the AI genuinely couldn't recognize a product group", () => {
    const rows = [row(1)];
    const aiLines: ParsedOfferLine[] = [
      {
        rawText: "#1 | Rosa Ec Crystal Flame",
        productGroupRaw: undefined,
        needsReview: false, // even if the AI itself claims confidence, no productGroupRaw means review is needed
        confidence: "low",
        fieldConfidence: {},
        parserWarnings: [],
      },
    ];
    const merged = mergeDeterministicRowsWithDescriptionLines(rows, aiLines);
    expect(merged[0].needsReview).toBe(true);
  });

  it("carries stemsPerBunch through as its own distinct field, never merged into stemsPerBox", () => {
    const rows = [row(1)];
    const merged = mergeDeterministicRowsWithDescriptionLines(rows, []);
    expect(merged[0].stemsPerBunch).toBe(25);
    expect(merged[0].stemsPerBox).toBe(100);
    expect(merged[0].stemsPerBunch).not.toBe(merged[0].stemsPerBox);
  });
});
