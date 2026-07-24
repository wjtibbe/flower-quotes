import { describe, expect, it } from "vitest";
import {
  extractLinesFromStructuredOutput,
  OFFER_OUTPUT_JSON_SCHEMA,
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

/** The native structured-output shape: a text block containing `{ lines: [...] }`. */
function structuredResponse(payload: unknown, stopReason = "end_turn") {
  return { stop_reason: stopReason, content: [{ type: "text", text: JSON.stringify(payload) }] };
}

describe("extractLinesFromStructuredOutput - pure structured-output parsing", () => {
  it("A: happy path - a text block with { lines: [...] } yields mapped ParsedOfferLine[]", () => {
    const r = extractLinesFromStructuredOutput(structuredResponse({ lines: [validLine] }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toHaveLength(1);
      expect(r.lines[0].varietyRaw).toBe("Dallas");
      expect(r.lines[0].lengthCm).toBe(60);
    }
  });

  it("finds the JSON text block even when a thinking block precedes it", () => {
    const r = extractLinesFromStructuredOutput({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", text: "let me read the list" },
        { type: "text", text: JSON.stringify({ lines: [validLine, { ...validLine, variety: "Freedom" }] }) },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toHaveLength(2);
  });

  it("no readable text block at all -> no_structured_output (with safe metadata)", () => {
    const r = extractLinesFromStructuredOutput({ stop_reason: "end_turn", content: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no_structured_output");
      if (r.reason === "no_structured_output") {
        expect(r.stopReason).toBe("end_turn");
        expect(r.blockTypes).toEqual([]);
      }
    }
  });

  it("an empty/whitespace text block is treated as no_structured_output", () => {
    const r = extractLinesFromStructuredOutput({ stop_reason: "end_turn", content: [{ type: "text", text: "   " }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_structured_output");
  });

  it("B: a text block that is not valid JSON -> invalid_output (never guessed)", () => {
    const r = extractLinesFromStructuredOutput({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Sorry, here is the list: not valid json [" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_output");
  });

  it("C: valid JSON but without a `lines` array -> invalid_output", () => {
    const r = extractLinesFromStructuredOutput(structuredResponse({ notLines: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("invalid_output");
      if (r.reason === "invalid_output") expect(r.detail).toMatch(/lines/);
    }
  });

  it("valid JSON where the top-level value is an array (not the { lines } object) -> invalid_output", () => {
    const r = extractLinesFromStructuredOutput(structuredResponse([validLine]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_output");
  });

  it("D: a well-formed `lines` array with a per-line schema violation degrades that line, never fails the batch", () => {
    // With native structured output this is virtually impossible, but the
    // long-standing "never drop a line" guarantee must still hold defensively.
    const r = extractLinesFromStructuredOutput(
      structuredResponse({ lines: [validLine, { ...validLine, boxType: "XL" }] }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lines).toHaveLength(2);
      expect(r.lines[0].confidence).toBe("high");
      expect(r.lines[1].confidence).toBe("low"); // degraded
      expect(r.lines[1].needsReview).toBe(true);
    }
  });

  it("caps an implausibly large lines array instead of processing all of them", () => {
    const many = Array.from({ length: 1005 }, () => validLine);
    const r = extractLinesFromStructuredOutput(structuredResponse({ lines: many }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.lines).toHaveLength(1000);
  });
});

describe("JSON schema <-> Zod schema drift guard", () => {
  it("the output schema line keys exactly match ModelLineSchema (single source of truth)", () => {
    const zodKeys = Object.keys(ModelLineSchema.shape).sort();
    expect([...OFFER_LINE_JSON_SCHEMA_KEYS].sort()).toEqual(zodKeys);
  });

  it("the native output schema is an object requiring a `lines` array", () => {
    expect(OFFER_OUTPUT_JSON_SCHEMA.type).toBe("object");
    expect(OFFER_OUTPUT_JSON_SCHEMA.required).toContain("lines");
    expect((OFFER_OUTPUT_JSON_SCHEMA.properties.lines as { type: string }).type).toBe("array");
  });

  it("nullable enums (boxType, currency) use the anyOf form the structured-output validator requires", () => {
    const props = (OFFER_OUTPUT_JSON_SCHEMA.properties.lines as { items: { properties: Record<string, unknown> } })
      .items.properties;
    for (const key of ["boxType", "currency"]) {
      const spec = props[key] as { anyOf?: unknown[] };
      expect(Array.isArray(spec.anyOf)).toBe(true);
      // Must NOT use the `type: [..., "null"], enum: [...]` form the API rejects.
      expect((spec as { enum?: unknown }).enum).toBeUndefined();
    }
  });
});
