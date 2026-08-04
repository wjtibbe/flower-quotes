import { describe, expect, it } from "vitest";
import { detectTableRegion, buildTabularText, safeStringifyCell, parseRangeRef } from "../excelTableAdapter";
import type { SheetTable } from "../excelParser";

/** Builds a table matching the described Nikita workbook shape: title row 1, blank rows 2-3, headers row 4 (index 3), data from row 5 (index 4). */
function nikitaTable(dataRowCount = 3): SheetTable {
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
  const table: SheetTable = [
    ["Nikita"],
    [],
    [],
    headers,
  ];
  for (let i = 0; i < dataRowCount; i++) {
    table.push([1, 100, "QBE", `Rosa Ec Crystal Flame ${i}`, 60, 25, 9, 0.55 + i * 0.01]);
  }
  return table;
}

describe("Test 1: Excel Table A4:H153 is detected", () => {
  it("uses the defined Excel Table's ref to locate the header row, not row 1", () => {
    const table = nikitaTable(149);
    const region = detectTableRegion(table, [{ name: "OffersTable", ref: "A4:H153" }]);
    expect(region).not.toBeNull();
    expect(region!.source).toBe("excel-table");
    expect(region!.headerRowIndex).toBe(3); // row 4, 0-indexed
    expect(region!.lastDataRowIndex).toBe(152); // row 153, 0-indexed
  });

  it("parseRangeRef parses A4:H153 into 1-indexed row bounds", () => {
    expect(parseRangeRef("A4:H153")).toEqual({ startRow: 4, endRow: 153 });
  });

  it("returns null for a malformed ref instead of throwing", () => {
    expect(parseRangeRef("not-a-range")).toBeNull();
    expect(parseRangeRef("A4")).toBeNull();
  });
});

describe("Test 2: title row is ignored as data", () => {
  it("the title text 'Nikita' in row 1 never appears in the built tabular text", () => {
    const table = nikitaTable(3);
    const region = detectTableRegion(table, [{ name: "OffersTable", ref: "A4:H7" }]);
    const text = buildTabularText(table, region!);
    expect(text).not.toContain("Nikita");
  });
});

describe("Test 3: blank rows are ignored", () => {
  it("blank rows 2-3 above the header never become empty data lines", () => {
    const table = nikitaTable(2);
    const region = detectTableRegion(table, [{ name: "OffersTable", ref: "A4:H6" }]);
    const text = buildTabularText(table, region!);
    const lines = text.split("\n");
    // header + 2 data rows only - no blank lines anywhere
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
  });

  it("a genuinely blank data row inside the detected range is skipped, not sent as an empty line", () => {
    const table = nikitaTable(2);
    table.push([]); // blank row inside the range
    const region = { headerRowIndex: 3, lastDataRowIndex: table.length - 1, source: "excel-table" as const };
    const text = buildTabularText(table, region);
    expect(text.split("\n")).toHaveLength(3); // header + 2 real rows, blank row dropped
  });
});

describe("Test 5: numeric/date/blank cells are serialized safely", () => {
  it("never throws for numbers, strings, blanks, decimals or dates, and produces readable text", () => {
    expect(safeStringifyCell(100)).toBe("100");
    expect(safeStringifyCell(0.55)).toBe("0.55");
    expect(safeStringifyCell(null)).toBe("");
    expect(safeStringifyCell(undefined)).toBe("");
    expect(safeStringifyCell("  Rosa Ec  ")).toBe("Rosa Ec");
    expect(safeStringifyCell(true)).toBe("true");
    expect(() => safeStringifyCell(new Date("2026-08-04T00:00:00Z"))).not.toThrow();
    expect(safeStringifyCell(new Date("2026-08-04T00:00:00Z"))).toBe("2026-08-04");
  });

  it("buildTabularText never calls a string-only method on a numeric/blank cell", () => {
    const table: SheetTable = [
      ["Product", "Qty", "Price"],
      ["Rosa", 100, 0.55],
      ["Freedom", null, undefined],
    ];
    const region = { headerRowIndex: 0, lastDataRowIndex: 2, source: "scanned-header" as const };
    expect(() => buildTabularText(table, region)).not.toThrow();
    const text = buildTabularText(table, region);
    expect(text).toContain("Rosa | 100 | 0.55");
    expect(text).toContain("Freedom |  |");
  });
});

describe("Test 6: rows stay in source order", () => {
  it("data rows appear in the tabular text in the exact same order as the sheet", () => {
    const table = nikitaTable(5);
    const region = detectTableRegion(table, [{ name: "OffersTable", ref: "A4:H9" }]);
    const text = buildTabularText(table, region!);
    const lines = text.split("\n").slice(1); // drop header
    lines.forEach((line, i) => {
      expect(line).toContain(`Rosa Ec Crystal Flame ${i}`);
    });
  });
});

describe("Test 7: provider receives readable, pipe-delimited table text", () => {
  it("builds header + rows joined with ' | ', one row per line", () => {
    const table: SheetTable = [
      ["Product description", "FOB price USD"],
      ["Rosa Freedom", 0.42],
    ];
    const region = { headerRowIndex: 0, lastDataRowIndex: 1, source: "scanned-header" as const };
    const text = buildTabularText(table, region);
    expect(text).toBe("Product description | FOB price USD\nRosa Freedom | 0.42");
  });
});

describe("generic header-row scan (no Excel Table present)", () => {
  it("locates a textual header row followed by numeric data, ignoring a title row above it", () => {
    const table = nikitaTable(3);
    const region = detectTableRegion(table); // no definedTables passed
    expect(region).not.toBeNull();
    expect(region!.headerRowIndex).toBe(3);
    expect(region!.source === "scanned-header" || region!.source === "synonym-header").toBe(true);
  });

  it("returns null for a sheet with no plausible header at all", () => {
    const table: SheetTable = [[], [], []];
    expect(detectTableRegion(table)).toBeNull();
  });
});
