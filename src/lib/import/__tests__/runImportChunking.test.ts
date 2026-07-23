import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedOfferLine } from "../types";

// Replace the provider FACTORY with a controllable fake so the orchestration
// (chunking, sequential extraction, merge, range expansion, batch-failure
// policy) is tested without any network. The real error classes are kept
// (spread from the actual module) because runImport.ts imports
// AnthropicNoLinesDetectedError and the tests throw the real truncation error.
const { fakeParse } = vi.hoisted(() => ({ fakeParse: vi.fn() }));

vi.mock("../provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../provider")>();
  return {
    ...actual,
    getImportParserProvider: () => ({ name: "fake", parseOfferSource: fakeParse }),
  };
});

import { runTextImportSource, TextBatchExtractionError } from "../runImport";
import { AnthropicNoLinesDetectedError, AnthropicOutputTruncatedError } from "../provider";

function line(overrides: Partial<ParsedOfferLine> = {}): ParsedOfferLine {
  return {
    rawText: "Freedom 60cm 0.38",
    varietyRaw: "Freedom",
    lengthCm: 60,
    lengthRaw: "60cm",
    fobPricePerStem: "0.38",
    confidence: "high",
    fieldConfidence: {},
    needsReview: false,
    parserWarnings: [],
    ...overrides,
  };
}

const identity = (t: string) => t;
const ctx = {};

// A large single-section list of single-length priced rows (no price table),
// big enough to force chunking (> single-call row threshold of 30).
function buildLargeSimpleList(rows: number): string {
  const body = Array.from({ length: rows }, (_, i) => `Freedom${i} 60cm 0.3${i % 10}`).join("\n");
  return `Good morning\nROSES\n${body}\nBest regards`;
}

beforeEach(() => {
  fakeParse.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("26: single-call path (small input)", () => {
  it("small input is one provider call and returns its lines unchanged", async () => {
    fakeParse.mockResolvedValue([line({ rawText: "Dallas 50cm 0.30" })]);
    const result = await runTextImportSource("Dallas 50cm 0.30", "MANUAL", identity, ctx);
    expect(result.fatalError).toBeUndefined();
    expect(result.lines).toHaveLength(1);
    expect(fakeParse).toHaveBeenCalledTimes(1);
  });
});

describe("26: multi-batch orchestration", () => {
  it("splits a large list into several batches and merges results IN ORDER", async () => {
    let call = 0;
    fakeParse.mockImplementation(async () => {
      const idx = call++;
      return [line({ rawText: `batch-${idx}` })];
    });

    const result = await runTextImportSource(buildLargeSimpleList(50), "MANUAL", identity, ctx);

    expect(result.fatalError).toBeUndefined();
    expect(fakeParse.mock.calls.length).toBeGreaterThan(1);
    // ceil(50 / 22) = 3 batches, merged in source order.
    expect(fakeParse).toHaveBeenCalledTimes(3);
    expect(result.lines.map((l) => l.rawText)).toEqual(["batch-0", "batch-1", "batch-2"]);
  });

  it("a batch that finds no lines does NOT fail its siblings", async () => {
    let call = 0;
    fakeParse.mockImplementation(async () => {
      const idx = call++;
      if (idx === 1) throw new AnthropicNoLinesDetectedError();
      return [line({ rawText: `batch-${idx}` })];
    });

    const result = await runTextImportSource(buildLargeSimpleList(50), "MANUAL", identity, ctx);
    expect(result.fatalError).toBeUndefined();
    expect(result.lines.map((l) => l.rawText)).toEqual(["batch-0", "batch-2"]);
  });
});

describe("27: batch failure fails the whole import (no partial results)", () => {
  it("a hard batch failure throws TextBatchExtractionError naming the batch, and yields NO lines", async () => {
    let call = 0;
    fakeParse.mockImplementation(async () => {
      const idx = call++;
      if (idx === 1) throw new Error("boom");
      return [line({ rawText: `batch-${idx}` })];
    });

    const result = await runTextImportSource(buildLargeSimpleList(50), "MANUAL", identity, ctx);
    expect(result.lines).toEqual([]);
    expect(result.fatalError).toMatch(/deel 2 van 3/);
  });

  it("a truncated batch (max_tokens) surfaces the truncation message, never 'lines: Required'", async () => {
    let call = 0;
    fakeParse.mockImplementation(async () => {
      const idx = call++;
      if (idx === 0) throw new AnthropicOutputTruncatedError();
      return [line()];
    });

    const result = await runTextImportSource(buildLargeSimpleList(50), "MANUAL", identity, ctx);
    expect(result.lines).toEqual([]);
    expect(result.fatalError).toMatch(/afgekapt/);
    expect(result.fatalError).not.toMatch(/lines: Required/);
  });

  it("single-batch truncation passes the provider error through unchanged", async () => {
    fakeParse.mockRejectedValue(new AnthropicOutputTruncatedError());
    const result = await runTextImportSource("Dallas 50cm 0.30", "MANUAL", identity, ctx);
    expect(result.lines).toEqual([]);
    expect(result.fatalError).toMatch(/afgekapt/);
    expect(TextBatchExtractionError.name).toBe("TextBatchExtractionError"); // class is exported
  });
});

describe("25 + orchestration: deterministic range expansion is applied after merge", () => {
  it("a shared price table + ranged rows expand into per-length priced lines end to end", async () => {
    const source = `Dear friends
ROSES
2hb Alert 40-60cm
1qb be sweet 80cm

Prices per stem:
40 cm 0.16
50 cm 0.18
60 cm 0.22
70 cm 0.28
Best regards`;

    // Small enough to be a single batch; the model returns the ranged rows
    // verbatim (range in lengthRaw, price null) - expansion happens in the
    // orchestrator, not the model.
    fakeParse.mockResolvedValue([
      line({ rawText: "2hb Alert 40-60cm", varietyRaw: "Alert", boxType: "HB", lengthRaw: "40-60cm", lengthCm: undefined, fobPricePerStem: undefined }),
      line({ rawText: "1qb be sweet 80cm", varietyRaw: "be sweet", boxType: "QB", lengthRaw: "80cm", lengthCm: undefined, fobPricePerStem: undefined }),
    ]);

    const result = await runTextImportSource(source, "MANUAL", identity, ctx);
    expect(result.fatalError).toBeUndefined();

    // Alert 40-60 -> 3 lines (40/50/60); be sweet 80 -> 1 line (no tier for 80).
    expect(result.lines).toHaveLength(4);

    const alert = result.lines.filter((l) => l.varietyRaw === "Alert");
    expect(alert.map((l) => l.lengthCm)).toEqual([40, 50, 60]);
    expect(alert.map((l) => l.fobPricePerStem)).toEqual(["0.16", "0.18", "0.22"]);
    // Original supplier row preserved verbatim on every expanded line.
    for (const l of alert) expect(l.rawText).toBe("2hb Alert 40-60cm");

    const beSweet = result.lines.find((l) => l.varietyRaw === "be sweet");
    expect(beSweet?.lengthCm).toBe(80);
    expect(beSweet?.fobPricePerStem).toBeUndefined();
    expect(beSweet?.parserWarnings.some((w) => /80cm/.test(w))).toBe(true);
  });
});
