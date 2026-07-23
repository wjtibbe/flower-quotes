import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks the dynamically-imported "@anthropic-ai/sdk" module (AnthropicParserProvider
// does `await import("@anthropic-ai/sdk")` itself) so these tests exercise the real
// provider logic - validation, prompt/payload building, retry/timeout, error mapping,
// logging - without ever making a real network call. `vi.hoisted` is required because
// `vi.mock` factories run before the top-level imports below.
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
  AnthropicTimeoutError,
  AnthropicUnsupportedImageTypeError,
  AnthropicEmptyImageError,
  AnthropicJsonParseError,
  MAX_IMAGE_BYTES,
} from "../provider";
import type { ImageImportSource, TextImportSource } from "../types";

const ORIGINAL_API_KEY = process.env.ANTHROPIC_API_KEY;

function textOkResponse(lines: unknown[]) {
  return { content: [{ type: "text", text: JSON.stringify(lines) }] };
}

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

describe("AnthropicParserProvider - errors (section D)", () => {
  it("throws AnthropicNotConfiguredError for an image when ANTHROPIC_API_KEY is missing, without calling the SDK", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const provider = new AnthropicParserProvider();
    const source: ImageImportSource = { kind: "image", bytes: Buffer.from([1, 2, 3]), mediaType: "image/png" };
    await expect(provider.parseOfferSource(source)).rejects.toThrow(AnthropicNotConfiguredError);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an unsupported image media type before ever calling the SDK", async () => {
    const provider = new AnthropicParserProvider();
    const source = {
      kind: "image",
      bytes: Buffer.from([1, 2, 3]),
      mediaType: "image/bmp",
    } as unknown as ImageImportSource;
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
    const source: ImageImportSource = {
      kind: "image",
      bytes: Buffer.alloc(MAX_IMAGE_BYTES + 1),
      mediaType: "image/jpeg",
    };
    await expect(provider.parseOfferSource(source)).rejects.toThrow(/groter dan de maximale/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

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
    // Two zero-length advances first let the pending dynamic `import("@anthropic-ai/sdk")`
    // microtask resolve so the real setTimeout call inside withTimeout() is actually
    // registered before we fast-forward through it - otherwise runAllTimersAsync can
    // observe an empty timer queue and return immediately, leaving `p` hanging forever.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.runAllTimersAsync();
    await assertion;
  }, 15_000);

  it("throws AnthropicJsonParseError when the model response is not valid JSON", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "Sorry, I could not read this." }] });
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicJsonParseError);
  });

  it("throws AnthropicNoLinesDetectedError for a syntactically valid but empty response, instead of a silent technical success", async () => {
    mockCreate.mockResolvedValue(textOkResponse([]));
    const provider = new AnthropicParserProvider();
    await expect(provider.parseOfferSource(textSource)).rejects.toThrow(AnthropicNoLinesDetectedError);
  });
});

describe("AnthropicParserProvider - successful requests (regression + payload/logging)", () => {
  it("resolves a text source to parsed lines and sends only a text content block", async () => {
    mockCreate.mockResolvedValue(textOkResponse([validLine]));
    const provider = new AnthropicParserProvider();
    const lines = await provider.parseOfferSource(textSource, { supplierName: "Test Farm" });

    expect(lines).toHaveLength(1);
    expect(lines[0].varietyRaw).toBe("Dallas");
    expect(lines[0].lengthCm).toBe(60);

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toHaveLength(1);
    expect(call.messages[0].content[0].type).toBe("text");
    expect(call.messages[0].content[0].text).toContain("Test Farm");
  });

  it("resolves an image source to parsed lines, sending an image block plus instruction text", async () => {
    mockCreate.mockResolvedValue(textOkResponse([validLine]));
    const provider = new AnthropicParserProvider();
    const bytes = Buffer.from("fake-png-bytes-for-test");
    const source: ImageImportSource = { kind: "image", bytes, mediaType: "image/png", fileName: "offer.png" };

    const lines = await provider.parseOfferSource(source, { supplierName: "Colombia Farm" });

    expect(lines).toHaveLength(1);
    const call = mockCreate.mock.calls[0][0];
    const content = call.messages[0].content;
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image");
    expect(content[0].source.media_type).toBe("image/png");
    expect(content[0].source.data).toBe(bytes.toString("base64"));
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("Colombia Farm");
  });

  it("never logs base64 image data, image bytes, or extracted document text - only safe metadata", async () => {
    mockCreate.mockResolvedValue(textOkResponse([validLine]));
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
  });
});
