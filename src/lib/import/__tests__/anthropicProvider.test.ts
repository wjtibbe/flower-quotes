import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the dynamically-imported "@anthropic-ai/sdk" module (AnthropicParserProvider
// does `await import("@anthropic-ai/sdk")` itself) so these tests exercise the real
// provider logic - forced tool-use, validation, prompt/payload building, retry/timeout,
// error mapping, logging - without ever making a real network call. `vi.hoisted` is
// required because `vi.mock` factories run before the top-level imports below.
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
  AnthropicNoLinesDetectedError,
  AnthropicNotConfiguredError,
  AnthropicParserProvider,
  AnthropicRequestError,
  AnthropicResponseFormatError,
  AnthropicTimeoutError,
  AnthropicToolInputInvalidError,
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

/** The primary happy-path shape: a forced `submit_offer_extraction` tool call. */
function toolUseResponse(lines: unknown[], stopReason = "tool_use") {
  return {
    stop_reason: stopReason,
    content: [{ type: "tool_use", id: "toolu_1", name: "submit_offer_extraction", input: { lines } }],
  };
}

/** Legacy backward-compat shape: a plain text block containing a JSON array. */
function legacyTextResponse(lines: unknown[]) {
  return { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(lines) }] };
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

describe("AnthropicParserProvider - forced tool-use happy path (section 11.A/B/G)", () => {
  it("forces the submit_offer_extraction tool and resolves a text source to parsed lines", async () => {
    mockCreate.mockResolvedValue(toolUseResponse([validLine]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource, { supplierName: "Test Farm" });

    expect(lines).toHaveLength(1);
    expect(lines[0].varietyRaw).toBe("Dallas");
    expect(lines[0].lengthCm).toBe(60);

    const call = mockCreate.mock.calls[0][0];
    // The forced tool is declared and selected.
    expect(call.tools?.[0]?.name).toBe("submit_offer_extraction");
    expect(call.tool_choice).toEqual({ type: "tool", name: "submit_offer_extraction" });
    // Content is still just the instruction text (tools live at top level, not in content).
    expect(call.messages[0].content).toHaveLength(1);
    expect(call.messages[0].content[0].type).toBe("text");
    expect(call.messages[0].content[0].text).toContain("Test Farm");
  });

  it("B (production-bug regression): a response with a tool_use block but NO text block SUCCEEDS", async () => {
    // Exactly the shape that used to throw AnthropicResponseFormatError ("geen leesbare tekst").
    mockCreate.mockResolvedValue(toolUseResponse([validLine], "tool_use"));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource);
    expect(lines).toHaveLength(1);
    expect(lines[0].varietyRaw).toBe("Dallas");
  });

  it("G: an image source uses the same forced tool-use flow", async () => {
    mockCreate.mockResolvedValue(toolUseResponse([validLine]));
    const provider = new AnthropicParserProvider();
    const bytes = Buffer.from("fake-png-bytes-for-test");
    const source: ImageImportSource = { kind: "image", bytes, mediaType: "image/png", fileName: "offer.png" };

    const lines = await provider.parseOfferSource(source, { supplierName: "Colombia Farm" });

    expect(lines).toHaveLength(1);
    const call = mockCreate.mock.calls[0][0];
    expect(call.tool_choice).toEqual({ type: "tool", name: "submit_offer_extraction" });
    const content = call.messages[0].content;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image");
    expect(content[0].source.data).toBe(bytes.toString("base64"));
    expect(content[1].type).toBe("text");
  });

  it("throws AnthropicNoLinesDetectedError when the tool returns an empty lines array", async () => {
    mockCreate.mockResolvedValue(toolUseResponse([]));
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicNoLinesDetectedError);
  });
});

describe("AnthropicParserProvider - structured retry + errors (section 11.C/D, 9, 10)", () => {
  it("C: a tool call with the WRONG name is retried once, then surfaces AnthropicResponseFormatError", async () => {
    mockCreate.mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "t", name: "some_other_tool", input: { lines: [validLine] } }],
    });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicResponseFormatError);
    expect(mockCreate).toHaveBeenCalledTimes(2); // 1 initial + 1 structured retry
  });

  it("D: Zod-invalid tool input is retried once, then surfaces AnthropicToolInputInvalidError", async () => {
    const invalid = toolUseResponse([{ ...validLine, confidence: "definitely" }]); // bad enum
    mockCreate.mockResolvedValue(invalid);
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicToolInputInvalidError);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("D (recovery): a first invalid tool input then a valid one on retry SUCCEEDS", async () => {
    mockCreate
      .mockResolvedValueOnce(toolUseResponse([{ ...validLine, confidence: "definitely" }]))
      .mockResolvedValueOnce(toolUseResponse([validLine]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource);
    expect(lines).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

describe("AnthropicParserProvider - output truncation is first-class (section 27)", () => {
  it("stop_reason 'max_tokens' throws AnthropicOutputTruncatedError immediately, with NO retry", async () => {
    // A truncated response: the tool input is empty because the model was cut
    // off. This must NOT become "lines: Required" and must NOT be retried.
    mockCreate.mockResolvedValue({
      stop_reason: "max_tokens",
      content: [{ type: "tool_use", id: "t", name: "submit_offer_extraction", input: {} }],
    });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicOutputTruncatedError);
    // Truncation is terminal - retrying would just truncate again.
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("a truncated response never degrades into AnthropicToolInputInvalidError", async () => {
    mockCreate.mockResolvedValue({
      stop_reason: "max_tokens",
      content: [{ type: "tool_use", id: "t", name: "submit_offer_extraction", input: {} }],
    });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.not.toThrow(AnthropicToolInputInvalidError);
  });
});

describe("AnthropicParserProvider - length range preservation", () => {
  it("keeps a length RANGE as lengthRaw and does NOT collapse it into lengthCm", async () => {
    mockCreate.mockResolvedValue(toolUseResponse([{ ...validLine, length: "40-60cm", fobPricePerStem: null }]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource);
    expect(lines).toHaveLength(1);
    expect(lines[0].lengthRaw).toBe("40-60cm");
    expect(lines[0].lengthCm).toBeUndefined();
  });

  it("a single length still populates lengthCm (and lengthRaw mirrors it)", async () => {
    mockCreate.mockResolvedValue(toolUseResponse([{ ...validLine, length: "60cm" }]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource);
    expect(lines[0].lengthCm).toBe(60);
    expect(lines[0].lengthRaw).toBe("60cm");
  });
});

describe("AnthropicParserProvider - stringified tool lines recovery ('lines: Expected array, received string')", () => {
  it("recovers when tool_use.input.lines arrives as a JSON-stringified array, and logs the recovery with safe metadata only", async () => {
    mockCreate.mockResolvedValue({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "toolu_1", name: "submit_offer_extraction", input: { lines: JSON.stringify([validLine]) } },
      ],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider = new AnthropicParserProvider();

    const lines = await provider.parseOfferSource(textSource);

    expect(lines).toHaveLength(1);
    expect(lines[0].varietyRaw).toBe("Dallas");
    // No retry needed - recovered on the first attempt.
    expect(mockCreate).toHaveBeenCalledTimes(1);

    const loggedRecovery = warnSpy.mock.calls.some((c) => String(c[0]).includes("recovered stringified tool lines"));
    expect(loggedRecovery).toBe(true);

    // F: no supplier text/line content anywhere in the logs - metadata only.
    const allLoggedArgs = [...infoSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");
    expect(allLoggedArgs).not.toContain("Dallas");
    expect(allLoggedArgs).not.toContain("0.38");
    expect(allLoggedArgs).toContain("lineCount");
  });

  it("G: the normal array `lines` happy path is completely unaffected (no recovery, no extra log)", async () => {
    mockCreate.mockResolvedValue(toolUseResponse([validLine]));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new AnthropicParserProvider();

    const lines = await provider.parseOfferSource(textSource);

    expect(lines).toHaveLength(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const loggedRecovery = warnSpy.mock.calls.some((c) => String(c[0]).includes("recovered stringified tool lines"));
    expect(loggedRecovery).toBe(false);
  });

  it("a string that parses to invalid JSON is not recovered - retries once, then surfaces AnthropicToolInputInvalidError", async () => {
    mockCreate.mockResolvedValue({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "toolu_1", name: "submit_offer_extraction", input: { lines: "not json [" } }],
    });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicToolInputInvalidError);
    expect(mockCreate).toHaveBeenCalledTimes(2); // 1 initial + 1 structured retry
  });
});

describe("AnthropicParserProvider - legacy text fallback (section 11.E, 4)", () => {
  it("E: a valid legacy free-text JSON array (no tool call) still works via fallback", async () => {
    mockCreate.mockResolvedValue(legacyTextResponse([validLine]));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider = new AnthropicParserProvider();

    const lines = await provider.parseOfferSource(textSource);
    expect(lines).toHaveLength(1);
    expect(lines[0].varietyRaw).toBe("Dallas");
    // Only one call - the fallback consumed the first response, no retry needed.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const loggedFallback = warnSpy.mock.calls.some((c) => String(c[0]).includes("legacy free-text JSON fallback used"));
    expect(loggedFallback).toBe(true);
  });
});

describe("AnthropicParserProvider - safe logging (section 11.F, 5)", () => {
  it("never logs base64 image data, image bytes, extracted document text, stop_reason aside, or block content", async () => {
    mockCreate.mockResolvedValue(toolUseResponse([validLine]));
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
