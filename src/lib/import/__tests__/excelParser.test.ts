import { describe, expect, it } from "vitest";
import { parseExcelTable, findHeaderRow } from "../excelParser";
import type { SheetTable } from "../excelParser";

// Shape mirrors the real "OPEN MARKET - FCA BOGOTA" sample sheet.
const table: SheetTable = [
  ["Open Market - jul - 09", null, null, null, null, null, null, null, null, 0.0924],
  ["La Gaitana Farms", null, null, null, null, null, null, null, null, 0.0616],
  [null, new Date(2026, 6, 9), null, null, null, null, null, null, null, null],
  [
    "Product",
    "Color",
    "Variety",
    "Grade",
    "Move (stems)",
    "Additional (stems)",
    "Availability (QB)",
    "Total Stems",
    "FOB BTA",
    "CIF MIA",
    "STEMS X QB",
  ],
  ["Barbatus", "Hot pink", "Wonder", "60 cms", 0, 2000, 20, 2000, 0.35, 0.46, 100],
  ["Carnations", "Red", "Don pedro", "sel", 0, 5000, 20, 5000, 0.2, 0.26, 250],
  [null, null, null, null, null, null, null, null, null, null, null],
];

describe("findHeaderRow", () => {
  it("locates the header row even with metadata rows above it", () => {
    expect(findHeaderRow(table)).toBe(3);
  });

  it("returns null when there is no recognizable header", () => {
    expect(findHeaderRow([["a", "b"], ["c", "d"]])).toBeNull();
  });

  it("recognizes a minimal product + price header", () => {
    expect(findHeaderRow([["Product", "Price"], ["Dallas", "0.38"]])).toBe(0);
  });

  it("recognizes a minimal variety + quantity header", () => {
    expect(findHeaderRow([["Variety", "Quantity"], ["Dallas", "100"]])).toBe(0);
  });

  it("recognizes a minimal description + length header", () => {
    expect(findHeaderRow([["Description", "Length"], ["Dallas", "60"]])).toBe(0);
  });

  it("recognizes Spanish headers (producto/variedad + precio/cantidad/largo)", () => {
    expect(findHeaderRow([["Producto", "Variedad", "Precio", "Cantidad"], ["Rosa", "Dallas", "0.38", "100"]])).toBe(0);
    expect(findHeaderRow([["Artículo", "Largo"], ["Rosa", "60"]])).toBe(0);
  });

  it("does not treat a row as a header when it has an anchor column but no commercial column at all", () => {
    expect(findHeaderRow([["Product", "Notes"], ["Dallas", "some remark"]])).toBeNull();
  });

  it("does not treat a row as a header when it only has a commercial column and no product/variety/description anchor", () => {
    expect(findHeaderRow([["Price", "Weight"], ["0.38", "8"]])).toBeNull();
  });

  it("skips a loose title row above the real header even when the title mentions a product-ish word in passing", () => {
    const withTitle: SheetTable = [
      ["Weekly rose offer - week 30"],
      ["Product", "Price"],
      ["Dallas", "0.38"],
    ];
    expect(findHeaderRow(withTitle)).toBe(1);
  });

  it("finds a header within the default 10-row scan limit", () => {
    const rows: SheetTable = Array.from({ length: 9 }, (_, i) => [`metadata ${i}`]);
    rows.push(["Product", "Price"]);
    rows.push(["Dallas", "0.38"]);
    expect(findHeaderRow(rows)).toBe(9);
  });

  it("does not find a header past the scan limit, but does when the limit is raised to cover it", () => {
    const rows: SheetTable = Array.from({ length: 11 }, (_, i) => [`metadata ${i}`]);
    rows.push(["Product", "Price"]);
    rows.push(["Dallas", "0.38"]);
    expect(findHeaderRow(rows)).toBeNull();
    expect(findHeaderRow(rows, 15)).toBe(11);
  });
});

describe("parseExcelTable", () => {
  it("maps known columns directly and skips blank rows", () => {
    const lines = parseExcelTable(table);
    expect(lines).toHaveLength(2);

    const [barbatus, carnation] = lines;
    expect(barbatus.productGroupRaw).toBe("Barbatus (Sweet William)");
    expect(barbatus.colorRaw).toBe("Hot pink");
    expect(barbatus.varietyRaw).toBe("Wonder");
    expect(barbatus.gradeRaw).toBe("60 cms");
    expect(barbatus.fobPricePerStem).toBe("0.35");
    expect(barbatus.confidence).toBe("high");
    expect(barbatus.needsReview).toBe(false);

    expect(carnation.productGroupRaw).toBe("Carnation");
    expect(carnation.fobPricePerStem).toBe("0.2");
  });

  it("returns an empty array when no header row can be found", () => {
    expect(parseExcelTable([["random", "junk"]])).toEqual([]);
  });
});
