import { describe, expect, it } from "vitest";
import { detectCsvDelimiter, extractCsvTables } from "../extract/csv";

describe("detectCsvDelimiter", () => {
  it("detects a plain comma-delimited header", () => {
    expect(detectCsvDelimiter("Product,Price\nDallas,0.38\n")).toBe(",");
  });

  it("detects a semicolon-delimited header", () => {
    expect(detectCsvDelimiter("Product;Price\nDallas;0,38\n")).toBe(";");
  });

  it("ignores a comma inside a quoted header cell when counting delimiters", () => {
    // Semicolon-delimited, but one header cell itself contains a comma in quotes.
    expect(detectCsvDelimiter('"Product, name";Price\nDallas;0,38\n')).toBe(";");
  });

  it("defaults to comma when there is only one column (no delimiter present)", () => {
    expect(detectCsvDelimiter("Product\nDallas\n")).toBe(",");
  });

  it("strips a leading BOM before inspecting the first line", () => {
    expect(detectCsvDelimiter("﻿Product,Price\nDallas,0.38\n")).toBe(",");
  });

  it("skips leading blank lines to find the first real line", () => {
    expect(detectCsvDelimiter("\n\nProduct;Price\nDallas;0,38\n")).toBe(";");
  });
});

describe("extractCsvTables", () => {
  it("parses a standard comma-delimited CSV", async () => {
    const buf = Buffer.from("Product,Price\nDallas,0.38\nFreedom,0.45\n", "utf-8");
    const [{ table }] = await extractCsvTables(buf);
    expect(table[0]).toEqual(["Product", "Price"]);
    expect(table[1]).toEqual(["Dallas", 0.38]);
    expect(table[2]).toEqual(["Freedom", 0.45]);
  });

  it("parses a semicolon-delimited CSV with a decimal comma, keeping the price as a string", async () => {
    const buf = Buffer.from("Product;Price\nDallas;0,38\n", "utf-8");
    const [{ table }] = await extractCsvTables(buf);
    expect(table[0]).toEqual(["Product", "Price"]);
    // Number("0,38") is NaN, so ExcelJS's csv reader keeps it as the raw string -
    // normalizeDecimalString() downstream turns "0,38" into "0.38".
    expect(table[1]).toEqual(["Dallas", "0,38"]);
  });

  it("strips a leading UTF-8 BOM from the first header cell", async () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("Product,Price\nDallas,0.38\n", "utf-8")]);
    const [{ table }] = await extractCsvTables(buf);
    expect(table[0][0]).toBe("Product");
  });

  it("keeps a comma inside a quoted value as part of a single field", async () => {
    const buf = Buffer.from('Product,Price\n"Dallas, Red",0.38\n', "utf-8");
    const [{ table }] = await extractCsvTables(buf);
    expect(table[1]).toEqual(["Dallas, Red", 0.38]);
  });

  it("returns an empty table for an empty CSV file", async () => {
    const [{ table }] = await extractCsvTables(Buffer.from("", "utf-8"));
    expect(table).toEqual([]);
  });

  it("rejects a corrupt CSV (unterminated quoted field) with a real error instead of silently mangling it", async () => {
    const buf = Buffer.from('Product,Price\n"Dallas,0.38\nRoos,0.50\n', "utf-8");
    await expect(extractCsvTables(buf)).rejects.toThrow();
  });
});
