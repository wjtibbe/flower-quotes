import { describe, expect, it } from "vitest";
import {
  chunkTextSupplierOffer,
  classifySourceLine,
  DELIMITER_BATCH_PRODUCT_ROWS,
  DELIMITER_DOCUMENT_CONTEXT,
  DELIMITER_SHARED_CONTEXT,
} from "../textChunking";

// A Gutimilko-style small list: a greeting, 7 product rows, a signoff.
const GUTIMILKO = `Good morning, our availability today:
Freedom 60cm 0.38
Freedom 70cm 0.42
Dallas 50cm 0.30
Explorer 60cm 0.40
Vendela 70cm 0.45
Mondial 80cm 0.55
Playa Blanca 40cm 0.25
Best regards, Guti`;

// The Mystic-style shared price table.
const PRICE_TABLE = `40 cm 0.16
50 cm 0.18
60 cm 0.22
70 cm 0.28`;

// Builds a large Mystic-style document: a header, N ranged product rows under a
// "ROSES" heading, then the shared price table at the bottom.
function buildLargeMystic(productRows: number): string {
  const header = `Dear friends,\nMystic Flowers weekly availability:\n\nROSES`;
  const rows: string[] = [];
  for (let i = 0; i < productRows; i++) {
    rows.push(`2hb Variety${i} 40-60cm`);
  }
  return `${header}\n${rows.join("\n")}\n\nPrices per stem:\n${PRICE_TABLE}\n\nBest regards`;
}

describe("24.A: classifySourceLine - structural, not flower-domain", () => {
  it("classifies document/section context as A", () => {
    expect(classifySourceLine("Dear friends")).toBe("A");
    expect(classifySourceLine("ROSES")).toBe("A");
    expect(classifySourceLine("Mystic Flowers")).toBe("A");
    expect(classifySourceLine("Best regards")).toBe("A");
    expect(classifySourceLine("")).toBe("A");
    expect(classifySourceLine("Available week 30")).toBe("A"); // bare integer, no product signal
  });

  it("classifies probable product rows as B", () => {
    expect(classifySourceLine("2hb Alert 40-60cm")).toBe("B");
    expect(classifySourceLine("1qb be sweet 80cm")).toBe("B");
    expect(classifySourceLine("Dallas 60cm 0.38")).toBe("B");
  });

  it("classifies shared price-table tiers as C", () => {
    expect(classifySourceLine("40 cm 0.16")).toBe("C");
    expect(classifySourceLine("70 cm 0.28")).toBe("C");
  });
});

describe("24.B: small input stays a single, byte-for-byte unchanged call", () => {
  it("Gutimilko-style 7-row list -> exactly 1 chunk, composedText === original", () => {
    const chunks = chunkTextSupplierOffer(GUTIMILKO);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].composedText).toBe(GUTIMILKO);
    expect(chunks[0].total).toBe(1);
    expect(chunks[0].index).toBe(0);
    expect(chunks[0].productRowCount).toBe(7);
    // No delimiters injected for the single-call path.
    expect(chunks[0].composedText).not.toContain(DELIMITER_BATCH_PRODUCT_ROWS);
  });
});

describe("24.C-E: large input is split into ordered, bounded batches", () => {
  it("C: 110 product rows -> multiple chunks", () => {
    const chunks = chunkTextSupplierOffer(buildLargeMystic(110), { targetProductRows: 22 });
    expect(chunks.length).toBeGreaterThan(1);
    // ceil(110 / 22) = 5
    expect(chunks.length).toBe(5);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.total).toBe(chunks.length);
    });
  });

  it("D: every chunk carries both the document header and the shared price table", () => {
    const chunks = chunkTextSupplierOffer(buildLargeMystic(110), { targetProductRows: 22 });
    for (const c of chunks) {
      expect(c.composedText).toContain(DELIMITER_DOCUMENT_CONTEXT);
      expect(c.composedText).toContain("Mystic Flowers weekly availability");
      expect(c.composedText).toContain(DELIMITER_BATCH_PRODUCT_ROWS);
      expect(c.composedText).toContain(DELIMITER_SHARED_CONTEXT);
      // The full 4-tier table is copied into each chunk.
      expect(c.composedText).toContain("40 cm 0.16");
      expect(c.composedText).toContain("70 cm 0.28");
    }
  });

  it("E: every product row appears exactly once across the chunks, in source order", () => {
    const chunks = chunkTextSupplierOffer(buildLargeMystic(110), { targetProductRows: 22 });
    const seen: string[] = [];
    for (const c of chunks) {
      const body = c.composedText.split(DELIMITER_BATCH_PRODUCT_ROWS)[1].split(DELIMITER_SHARED_CONTEXT)[0];
      for (let i = 0; i < 110; i++) {
        if (body.includes(`2hb Variety${i} 40-60cm`)) seen.push(`Variety${i}`);
      }
    }
    expect(seen).toHaveLength(110);
    // Source order preserved end to end.
    expect(seen).toEqual(Array.from({ length: 110 }, (_, i) => `Variety${i}`));
    // Total product-row count across chunks equals the input.
    expect(chunks.reduce((n, c) => n + c.productRowCount, 0)).toBe(110);
  });

  it("F: price-table tiers and header lines are never counted as product rows", () => {
    const chunks = chunkTextSupplierOffer(buildLargeMystic(44), { targetProductRows: 22 });
    // 44 product rows across chunks; the 4 tier lines + header lines are context.
    expect(chunks.reduce((n, c) => n + c.productRowCount, 0)).toBe(44);
  });
});

describe("24.G: section headings are preserved across a chunk boundary", () => {
  it("carries the active section heading into a continuation chunk", () => {
    // 30 rows all under a single ROSES heading, split at 10 rows/chunk -> the
    // 2nd and 3rd chunks start mid-section and must still show "ROSES".
    const chunks = chunkTextSupplierOffer(buildLargeMystic(30), {
      targetProductRows: 10,
      singleCallRowThreshold: 5,
    });
    expect(chunks.length).toBe(3);
    for (const c of chunks) {
      expect(c.composedText).toContain("ROSES");
    }
  });
});

describe("24.H: the byte bound forces a split even below the row target", () => {
  it("very long rows split on bytes, not just row count", () => {
    const longRow = (i: number) => `2hb Variety${i} 40-60cm ${"x".repeat(500)}`;
    const rows = Array.from({ length: 20 }, (_, i) => longRow(i)).join("\n");
    const text = `Dear friends\nROSES\n${rows}\n${PRICE_TABLE}`;
    const chunks = chunkTextSupplierOffer(text, {
      targetProductRows: 100,
      maxChunkBytes: 2000,
      singleCallByteThreshold: 2000,
    });
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("24.I-J: robustness", () => {
  it("I: a trailing price table (no header) is still pulled out globally into every chunk", () => {
    const rows = Array.from({ length: 40 }, (_, i) => `2hb Variety${i} 40-60cm`).join("\n");
    const text = `${rows}\n${PRICE_TABLE}`;
    const chunks = chunkTextSupplierOffer(text, { targetProductRows: 20 });
    expect(chunks.length).toBe(2);
    for (const c of chunks) {
      expect(c.composedText).toContain("40 cm 0.16");
      expect(c.composedText).toContain(DELIMITER_SHARED_CONTEXT);
    }
  });

  it("J: an empty string yields a single trivial chunk", () => {
    const chunks = chunkTextSupplierOffer("");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].composedText).toBe("");
    expect(chunks[0].productRowCount).toBe(0);
  });
});
