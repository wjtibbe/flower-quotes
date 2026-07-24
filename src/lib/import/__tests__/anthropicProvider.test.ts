import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the dynamically-imported "@anthropic-ai/sdk" module (AnthropicParserProvider
// does `await import("@anthropic-ai/sdk")` itself) so these tests exercise the real
// provider logic - native structured output, validation, prompt/payload building,
// retry/timeout, error mapping, logging - without ever making a real network call.
// `vi.hoisted` is required because `vi.mock` factories run before the top-level
// imports below.
const { mockCreate, MockAnthropicClient } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  class MockAnthropicClient {
    messages = { create: mockCreate };
    constructor(_opts: unknown) {}
  }
  return { mockCreate, MockAnthropicClient };
});

vi.mock("@anthropic-ai/sdk", () => ({
  default: MockAnthropicClient,
}));

import {
  AnthropicContentRefusedError,
  AnthropicNoLinesDetectedError,
  AnthropicNotConfiguredError,
  AnthropicParserProvider,
  AnthropicRequestError,
  AnthropicResponseFormatError,
  AnthropicStructuredOutputInvalidError,
  AnthropicTimeoutError,
  AnthropicOutputTruncatedError,
  AnthropicUnsupportedImageTypeError,
  AnthropicEmptyImageError,
  MAX_IMAGE_BYTES,
} from "../provider";
import type { ImageImportSource, TextImportSource } from "../types";

const ORIGINAL_API_KEY = process.env.ANTHROPIC_API_KEY;

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

/** The primary happy-path shape: native structured output - a text block of `{ lines }`. */
function structuredResponse(lines: unknown[], stopReason = "end_turn") {
  return { stop_reason: stopReason, content: [{ type: "text", text: JSON.stringify({ lines }) }] };
}

const textSource: TextImportSource = { kind: "text", text: "Dallas 60cm 0.38" };

beforeEach(() => {
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
});

afterEach(() => {
  process.env.ANTHROPIC_API_KEY = ORIGINAL_API_KEY;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AnthropicParserProvider - pre-call guards", () => {
  it("throws AnthropicNotConfiguredError for an image when ANTHROPIC_API_KEY is missing, without calling the SDK", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new AnthropicParserProvider();
    const source: ImageImportSource = { kind: "image", bytes: Buffer.from([1, 2, 3]), mediaType: "image/png" };
    await expect(provider.parseOfferSource(source)).rejects.toThrow(AnthropicNotConfiguredError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an unsupported image media type before ever calling the SDK", async () => {
    const provider = new AnthropicParserProvider();
    const source = { kind: "image", bytes: Buffer.from([1, 2, 3]), mediaType: "image/bmp" } as unknown as ImageImportSource;
    await expect(provider.parseOfferSource(source)).rejects.toThrow(AnthropicUnsupportedImageTypeError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an empty image before ever calling the SDK", async () => {
    const provider = new AnthropicParserProvider();
    const source: ImageImportSource = { kind: "image", bytes: Buffer.alloc(0), mediaType: "image/png" };
    await expect(provider.parseOfferSource(source)).rejects.toThrow(AnthropicEmptyImageError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an image larger than MAX_IMAGE_BYTES before ever calling the SDK", async () => {
    const provider = new AnthropicParserProvider();
    const source: ImageImportSource = { kind: "image", bytes: Buffer.alloc(MAX_IMAGE_BYTES + 1), mediaType: "image/jpeg" };
    await expect(provider.parseOfferSource(source)).rejects.toThrow(/groter dan de maximale/);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("AnthropicParserProvider - transport error taxonomy (unchanged)", () => {
  it("maps a rejected request (e.g. 400 from the API) to AnthropicRequestError without retrying a non-retryable status", async () => {
    const apiError = Object.assign(new Error("Bad request"), { status: 400 });
    mockCreate.mockRejectedValue(apiError);
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicRequestError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("times out a request that never resolves and surfaces AnthropicTimeoutError", async () => {
    vi.useFakeTimers();
    mockCreate.mockImplementation(() => new Promise(() => {})); // never resolves
    const provider = new AnthropicParserProvider();

    const resultPromise = provider.parseOfferSource(textSource);
    const assertion = expect(resultPromise).rejects.toThrow(AnthropicTimeoutError);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTimersAsync();
    await assertion;
  }, 15_000);
});

describe("AnthropicParserProvider - native structured-output happy path", () => {
  it("requests native structured output (no fake tool) and resolves a text source to parsed lines", async () => {
    mockCreate.mockResolvedValue(structuredResponse([validLine]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource, { supplierName: "Test Farm" });

    expect(lines).toHaveLength(1);
    expect(lines[0].varietyRaw).toBe("Dallas");
    expect(lines[0].lengthCm).toBe(60);

    const call = mockCreate.mock.calls[0][0];
    // Native structured output is requested via output_config.format...
    expect(call.output_config?.format?.type).toBe("json_schema");
    expect(call.output_config?.format?.schema?.required).toContain("lines");
    // ...and thinking is disabled to preserve the full output budget for JSON.
    expect(call.thinking).toEqual({ type: "disabled" });
    // The old forced-tool workaround is gone entirely.
    expect(call.tools).toBeUndefined();
    expect(call.tool_choice).toBeUndefined();
    // Content is just the instruction text.
    expect(call.messages[0].content).toHaveLength(1);
    expect(call.messages[0].content[0].type).toBe("text");
    expect(call.messages[0].content[0].text).toContain("Test Farm");
  });

  it("an image source uses the same native structured-output flow and still sends the image block", async () => {
    mockCreate.mockResolvedValue(structuredResponse([validLine]));
    const provider = new AnthropicParserProvider();
    const bytes = Buffer.from("fake-png-bytes-for-test");
    const source: ImageImportSource = { kind: "image", bytes, mediaType: "image/png", fileName: "offer.png" };

    const lines = await provider.parseOfferSource(source, { supplierName: "Colombia Farm" });

    expect(lines).toHaveLength(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.output_config?.format?.type).toBe("json_schema");
    expect(call.tool_choice).toBeUndefined();
    const content = call.messages[0].content;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image");
    expect(content[0].source.data).toBe(bytes.toString("base64"));
    expect(content[1].type).toBe("text");
  });

  it("throws AnthropicNoLinesDetectedError when the structured output is an empty lines array", async () => {
    mockCreate.mockResolvedValue(structuredResponse([]));
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicNoLinesDetectedError);
  });
});

describe("AnthropicParserProvider - structured retry + errors", () => {
  it("a response with no readable text block is retried once, then surfaces AnthropicResponseFormatError", async () => {
    mockCreate.mockResolvedValue({ stop_reason: "end_turn", content: [] });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicResponseFormatError);
    expect(mockCreate).toHaveBeenCalledTimes(2); // 1 initial + 1 structured retry
  });

  it("a text block that is not valid JSON is retried once, then surfaces AnthropicStructuredOutputInvalidError", async () => {
    mockCreate.mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "not json [" }] });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicStructuredOutputInvalidError);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("JSON without a `lines` array is retried once, then surfaces AnthropicStructuredOutputInvalidError", async () => {
    mockCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify({ notLines: true }) }],
    });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicStructuredOutputInvalidError);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("a first unreadable response then a valid one on retry SUCCEEDS", async () => {
    mockCreate
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [] })
      .mockResolvedValueOnce(structuredResponse([validLine]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource);
    expect(lines).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("a per-line schema violation degrades that line (no retry, no error) - never drops a line", async () => {
    // Native structured output guarantees the schema, but if a bad line ever
    // slips through it must degrade into review, not fail the whole import.
    mockCreate.mockResolvedValue(structuredResponse([validLine, { ...validLine, confidence: "definitely" }]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource);
    expect(lines).toHaveLength(2);
    expect(lines[1].needsReview).toBe(true);
    expect(lines[1].confidence).toBe("low");
    expect(mockCreate).toHaveBeenCalledTimes(1); // degraded on the first attempt, no retry
  });
});

describe("AnthropicParserProvider - output truncation is first-class (section 27)", () => {
  it("stop_reason 'max_tokens' throws AnthropicOutputTruncatedError immediately, with NO retry", async () => {
    // A truncated response: the structured object is incomplete because the
    // model was cut off. This must NOT be retried or degrade into an invalid-output error.
    mockCreate.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"lines":[' }] });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicOutputTruncatedError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("a truncated response never degrades into AnthropicStructuredOutputInvalidError", async () => {
    mockCreate.mockResolvedValue({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"lines":[' }] });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.not.toThrow(AnthropicStructuredOutputInvalidError);
  });
});

describe("AnthropicParserProvider - refusal is first-class", () => {
  it("stop_reason 'refusal' throws AnthropicContentRefusedError immediately, with NO retry", async () => {
    mockCreate.mockResolvedValue({ stop_reason: "refusal", content: [{ type: "text", text: "I can't help with that." }] });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicContentRefusedError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe("AnthropicParserProvider - length range preservation", () => {
  it("keeps a length RANGE as lengthRaw and does NOT collapse it into lengthCm", async () => {
    mockCreate.mockResolvedValue(structuredResponse([{ ...validLine, length: "40-60cm", fobPricePerStem: null }]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource);
    expect(lines).toHaveLength(1);
    expect(lines[0].lengthRaw).toBe("40-60cm");
    expect(lines[0].lengthCm).toBeUndefined();
  });

  it("a single length still populates lengthCm (and lengthRaw mirrors it)", async () => {
    mockCreate.mockResolvedValue(structuredResponse([{ ...validLine, length: "60cm" }]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource);
    expect(lines[0].lengthCm).toBe(60);
    expect(lines[0].lengthRaw).toBe("60cm");
  });
});

describe("AnthropicParserProvider - safe logging", () => {
  it("never logs base64 image data, image bytes, extracted document text, or block content", async () => {
    mockCreate.mockResolvedValue(structuredResponse([validLine]));
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const provider = new AnthropicParserProvider();
    const bytes = Buffer.from("super-secret-pixels-do-not-log-me");
    const base64 = bytes.toString("base64");
    const source: ImageImportSource = { kind: "image", bytes, mediaType: "image/png" };

    await provider.parseOfferSource(source);

    const allLoggedArgs = [...infoSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");

    expect(allLoggedArgs).not.toContain(base64);
    expect(allLoggedArgs).not.toContain("super-secret-pixels-do-not-log-me");
    expect(allLoggedArgs).not.toContain("Dallas"); // no product/price content either
    expect(allLoggedArgs).not.toContain("0.38");
    // ...but it DOES log the safe structured metadata (stop_reason + block types).
    expect(allLoggedArgs).toContain("stopReason");
    expect(allLoggedArgs).toContain("blockTypes");
  });
});
