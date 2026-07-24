import { describe, expect, it } from "vitest";
import {
  extractLinesFromToolUse,
  OFFER_EXTRACTION_TOOL,
  OFFER_LINE_JSON_SCHEMA_KEYS,
  ModelLineSchema,
} from "../provider";

const validLine = {
  rawText: "Dallas 60cm 0.38",
  farmName: null,
  countryOfOrigin: null,
  productGroup: "Rose",
  variety: "Dallas",
  length: "60cm",
  color: null,
  grade: null,
  treatment: null,
  boxType: "QB",
  boxesAvailable: 10,
  stemsPerBox: 100,
  fobPricePerStem: "0.38",
  currency: "USD",
  weightPerBoxKg: "8",
  extraLeadTimeHrs: null,
  confidence: "high",
  needsReview: false,
  parserWarnings: [],
};

function toolBlock(input: unknown, name = "submit_offer_extraction") {
  return { type: "tool_use", name, input };
}

describe("extractLinesFromToolUse - pure structured-output parsing", () => {
  it("A: happy path - tool_use with valid input yields mapped ParsedOfferLine[]", () => {
    const r = extractLinesFromToolUse({ stop_reason: "tool_use", content: [toolBlock({ lines: [validLine] })] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toHaveLength(1);
      expect(r.lines[0].varietyRaw).toBe("Dallas");
      expect(r.lines[0].lengthCm).toBe(60);
    }
  });

  it("B: a tool_use block with NO text block present still succeeds (the exact Production bug)", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [toolBlock({ lines: [validLine, { ...validLine, variety: "Freedom" }] })],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toHaveLength(2);
  });

  it("also finds the tool_use block when the model additionally emitted a leading text block", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [{ type: "text", text: "Here is the extraction:" }, toolBlock({ lines: [validLine] })],
    });
    expect(r.ok).toBe(true);
  });

  it("C: a tool call with the wrong name is a no_tool_use failure (with safe metadata)", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [toolBlock({ lines: [validLine] }, "some_other_tool")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no_tool_use");
      if (r.reason === "no_tool_use") {
        expect(r.stopReason).toBe("tool_use");
        expect(r.blockTypes).toEqual(["tool_use"]);
      }
    }
  });

  it("no content blocks at all -> no_tool_use", () => {
    const r = extractLinesFromToolUse({ stop_reason: "end_turn", content: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_tool_use");
  });

  it("D: tool input failing the strict Zod schema -> invalid_tool_input with a detail", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [toolBlock({ lines: [{ ...validLine, boxType: "XL" }] })], // invalid enum
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("invalid_tool_input");
      if (r.reason === "invalid_tool_input") expect(r.detail).toMatch(/boxType/);
    }
  });

  it("D: an extra unknown field on a line is rejected by .strict()", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [toolBlock({ lines: [{ ...validLine, smuggled: "x" }] })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_tool_input");
  });

  it("D: tool input missing the `lines` array is invalid", () => {
    const r = extractLinesFromToolUse({ stop_reason: "tool_use", content: [toolBlock({ notLines: [] })] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_tool_input");
  });
});

describe("extractLinesFromToolUse - stringified lines recovery (Production bug: 'lines: Expected array, received string')", () => {
  it("A: a normal array `lines` needs no recovery - unaffected happy path", () => {
    const r = extractLinesFromToolUse({ stop_reason: "tool_use", content: [toolBlock({ lines: [validLine] })] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toHaveLength(1);
      expect(r.recovered).toBeUndefined();
    }
  });

  it("B: lines as a JSON-stringified valid array is recovered and succeeds", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [toolBlock({ lines: JSON.stringify([validLine, { ...validLine, variety: "Freedom" }]) })],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recovered).toBe(true);
      expect(r.lines).toHaveLength(2);
      expect(r.lines[0].varietyRaw).toBe("Dallas");
      expect(r.lines[1].varietyRaw).toBe("Freedom");
    }
  });

  it("C: lines as a string containing invalid JSON is not recovered - falls through to invalid_tool_input", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [toolBlock({ lines: "not valid json [" })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_tool_input");
  });

  it("D: lines as a string that parses to an OBJECT (not an array) is rejected, never guessed", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [toolBlock({ lines: JSON.stringify({ notAnArray: true }) })],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_tool_input");
  });

  it("E: a recovered array whose line objects still violate ModelLineSchema fails validation (not silently accepted)", () => {
    const r = extractLinesFromToolUse({
      stop_reason: "tool_use",
      content: [toolBlock({ lines: JSON.stringify([{ ...validLine, boxType: "XL" }]) })], // invalid enum
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("invalid_tool_input");
      if (r.reason === "invalid_tool_input") expect(r.detail).toMatch(/boxType/);
    }
  });

  it("does not attempt recovery when `input` itself is not a plain object (e.g. an array)", () => {
    const r = extractLinesFromToolUse({ stop_reason: "tool_use", content: [toolBlock([validLine])] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_tool_input");
  });

  it("does not attempt recovery when `lines` is missing entirely (still the plain invalid path)", () => {
    const r = extractLinesFromToolUse({ stop_reason: "tool_use", content: [toolBlock({ notLines: [] })] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_tool_input");
  });
});

describe("tool schema <-> Zod schema drift guard", () => {
  it("the tool input_schema line keys exactly match ModelLineSchema (single source of truth)", () => {
    const zodKeys = Object.keys(ModelLineSchema.shape).sort();
    expect([...OFFER_LINE_JSON_SCHEMA_KEYS].sort()).toEqual(zodKeys);
  });

  it("the forced tool is named submit_offer_extraction and requires a lines array", () => {
    expect(OFFER_EXTRACTION_TOOL.name).toBe("submit_offer_extraction");
    const schema = OFFER_EXTRACTION_TOOL.input_schema as Record<string, unknown>;
    expect((schema.required as string[]) ?? []).toContain("lines");
  });
});
