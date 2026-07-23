import { describe, expect, it } from "vitest";
import {
  AnthropicEmptyImageError,
  AnthropicImageTooLargeError,
  AnthropicJsonParseError,
  AnthropicUnsupportedImageTypeError,
  MAX_IMAGE_BYTES,
  buildMessageContent,
  parseAndValidateModelOutput,
  validateImageSource,
} from "../provider";
import type { ImageImportSource, TextImportSource } from "../types";

function validLine(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

describe("parseAndValidateModelOutput - valid output", () => {
  it("maps a fully populated line, keeping variety and length as separate fields", () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine()]));
    expect(line.varietyRaw).toBe("Dallas");
    expect(line.lengthCm).toBe(60);
    expect(line.productGroupRaw).toBe("Rose");
    expect(line.boxType).toBe("QB");
    expect(line.stemsPerBox).toBe(100);
    expect(line.fobPricePerStem).toBe("0.38");
    expect(line.currency).toBe("USD");
    expect(line.weightPerBoxKg).toBe("8");
    expect(line.confidence).toBe("high");
    expect(line.needsReview).toBe(false);
  });

  it("treats 60, 60CM and 60 cm length notations identically, and never appends any of them to variety", () => {
    const variants = ["60", "60CM", "60 cm"];
    const results = variants.map((length) => {
      const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ length })]));
      return { varietyRaw: line.varietyRaw, lengthCm: line.lengthCm };
    });
    expect(results).toEqual([
      { varietyRaw: "Dallas", lengthCm: 60 },
      { varietyRaw: "Dallas", lengthCm: 60 },
      { varietyRaw: "Dallas", lengthCm: 60 },
    ]);
  });

  it("accepts markdown code fences around the JSON array", () => {
    const text = "```json\n" + JSON.stringify([validLine()]) + "\n```";
    const [line] = parseAndValidateModelOutput(text);
    expect(line.varietyRaw).toBe("Dallas");
    expect(line.lengthCm).toBe(60);
  });
});

describe("parseAndValidateModelOutput - variety/length separation (section: BELANGRIJKE CORRECTIE)", () => {
  it('never stores "Dallas 60cm" as the full variety when the source clearly means Dallas + 60cm', () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ variety: "Dallas", length: "60cm" })]));
    expect(line.varietyRaw).toBe("Dallas");
    expect(line.varietyRaw).not.toContain("60");
    expect(line.varietyRaw).not.toMatch(/cm/i);
    expect(line.lengthCm).toBe(60);
  });

  it("keeps a multi-word variety untouched and length separate", () => {
    const [line] = parseAndValidateModelOutput(
      JSON.stringify([validLine({ variety: "Freedom Red Naomi", length: "70" })]),
    );
    expect(line.varietyRaw).toBe("Freedom Red Naomi");
    expect(line.lengthCm).toBe(70);
  });

  it("leaves lengthCm null/undefined when the source has no length, without inventing one", () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ length: null })]));
    expect(line.varietyRaw).toBe("Dallas");
    expect(line.lengthCm).toBeUndefined();
  });

  it("produces a warning and leaves lengthCm unset when the length text is not interpretable, instead of guessing", () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ length: "unknown" })]));
    expect(line.lengthCm).toBeUndefined();
    expect(line.parserWarnings.some((w) => w.toLowerCase().includes("lengte"))).toBe(true);
  });

  it("parses a decimal length (e.g. 60,5cm) into a numeric lengthCm", () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ length: "60,5cm" })]));
    expect(line.lengthCm).toBe(60.5);
  });
});

describe("parseAndValidateModelOutput - null values", () => {
  it("turns nulls into undefined and defaults treatment to normal", () => {
    const [line] = parseAndValidateModelOutput(
      JSON.stringify([
        validLine({
          countryOfOrigin: null,
          color: null,
          grade: null,
          treatment: null,
          extraLeadTimeHrs: null,
        }),
      ]),
    );
    expect(line.countryOfOrigin).toBeUndefined();
    expect(line.colorRaw).toBeUndefined();
    expect(line.gradeRaw).toBeUndefined();
    expect(line.treatmentRaw).toBe("normal");
    expect(line.extraLeadTimeHrs).toBeUndefined();
  });

  it("never guesses a currency: null currency stays unset and forces review with a warning", () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ currency: null, needsReview: false })]));
    expect(line.currency).toBeUndefined();
    expect(line.needsReview).toBe(true);
    expect(line.parserWarnings.some((w) => w.toLowerCase().includes("valuta"))).toBe(true);
  });
});

describe("parseAndValidateModelOutput - decimal parsing", () => {
  it("normalizes a comma decimal separator that slipped through", () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ fobPricePerStem: "0,38" })]));
    expect(line.fobPricePerStem).toBe("0.38");
  });

  it("drops an unparsable price and adds a warning instead of guessing", () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ fobPricePerStem: "n/a" })]));
    expect(line.fobPricePerStem).toBeUndefined();
    expect(line.needsReview).toBe(true);
    expect(line.parserWarnings.some((w) => w.includes("n/a"))).toBe(true);
  });

  it("normalizes box weight the same way", () => {
    const [line] = parseAndValidateModelOutput(JSON.stringify([validLine({ weightPerBoxKg: "8,5" })]));
    expect(line.weightPerBoxKg).toBe("8.5");
  });
});

describe("parseAndValidateModelOutput - malformed per-line output", () => {
  it("recovers a line with a wrong-typed field instead of dropping it or failing the whole batch", () => {
    const goodLine = validLine();
    const badLine = validLine({ stemsPerBox: "one hundred" }); // wrong type: should be number|null
    const [first, second] = parseAndValidateModelOutput(JSON.stringify([goodLine, badLine]));

    expect(first.varietyRaw).toBe("Dallas");
    expect(first.lengthCm).toBe(60);
    expect(first.needsReview).toBe(false);

    expect(second).toBeDefined();
    expect(second.confidence).toBe("low");
    expect(second.needsReview).toBe(true);
    expect(second.parserWarnings[0]).toMatch(/deels automatisch hersteld/i);
  });

  it("recovers a line with an invalid enum value (boxType) via best-effort extraction", () => {
    const badLine = validLine({ boxType: "GIANT_BOX" });
    const [line] = parseAndValidateModelOutput(JSON.stringify([badLine]));
    expect(line).toBeDefined();
    expect(line.needsReview).toBe(true);
    expect(line.rawText).toBe("Dallas 60cm 0.38"); // rawText itself was still valid, so it survives
  });

  it("rejects unknown extra keys per line (still recovers, does not silently accept them)", () => {
    const badLine = { ...validLine(), unexpectedField: "surprise" };
    const [line] = parseAndValidateModelOutput(JSON.stringify([badLine]));
    expect(line.needsReview).toBe(true);
    expect(line.confidence).toBe("low");
  });
});

describe("parseAndValidateModelOutput - malformed top-level output", () => {
  it("throws a specific error when the response contains no JSON array at all", () => {
    expect(() => parseAndValidateModelOutput("Sorry, I could not read this file.")).toThrow(AnthropicJsonParseError);
  });

  it("throws a specific error when the JSON array itself is syntactically invalid", () => {
    expect(() => parseAndValidateModelOutput("[{ this is not valid json ]")).toThrow(AnthropicJsonParseError);
  });

  it("throws a specific error when the top-level JSON value is not an array", () => {
    expect(() => parseAndValidateModelOutput('{"not": "an array"}')).toThrow(AnthropicJsonParseError);
  });
});

describe("parseAndValidateModelOutput - safety cap", () => {
  it("truncates a response with an implausibly large number of lines instead of processing all of them", () => {
    const many = Array.from({ length: 1005 }, () => validLine());
    const result = parseAndValidateModelOutput(JSON.stringify(many));
    expect(result.length).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Section A: source structure (ImportSource discriminated union)
// ---------------------------------------------------------------------------

describe("ImportSource - source structure", () => {
  it("accepts a valid text source", () => {
    const source: TextImportSource = { kind: "text", text: "Dallas 60cm 0.38" };
    expect(source.kind).toBe("text");
    expect(source.text).toBe("Dallas 60cm 0.38");
  });

  it("accepts a valid image source with bytes, media type and filename", () => {
    const source: ImageImportSource = {
      kind: "image",
      bytes: Buffer.from([1, 2, 3, 4]),
      mediaType: "image/png",
      fileName: "aanbieding.png",
    };
    expect(source.kind).toBe("image");
    expect(source.bytes.length).toBe(4);
    expect(source.mediaType).toBe("image/png");
  });

  it("validateImageSource rejects an image source with empty bytes", () => {
    const source: ImageImportSource = { kind: "image", bytes: Buffer.alloc(0), mediaType: "image/png" };
    expect(() => validateImageSource(source)).toThrow(AnthropicEmptyImageError);
  });

  it("validateImageSource rejects an unsupported media type", () => {
    const source = {
      kind: "image",
      bytes: Buffer.from([1, 2, 3]),
      mediaType: "image/bmp",
    } as unknown as ImageImportSource;
    expect(() => validateImageSource(source)).toThrow(AnthropicUnsupportedImageTypeError);
  });

  it("validateImageSource rejects an image larger than MAX_IMAGE_BYTES", () => {
    const source: ImageImportSource = {
      kind: "image",
      bytes: Buffer.alloc(MAX_IMAGE_BYTES + 1),
      mediaType: "image/jpeg",
    };
    expect(() => validateImageSource(source)).toThrow(AnthropicImageTooLargeError);
  });

  it("validateImageSource accepts a small, supported, non-empty image", () => {
    const source: ImageImportSource = { kind: "image", bytes: Buffer.from([1, 2, 3]), mediaType: "image/webp" };
    expect(() => validateImageSource(source)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section B: Anthropic message payload (buildMessageContent)
// ---------------------------------------------------------------------------

describe("buildMessageContent - Anthropic payload shape", () => {
  it("a text source produces exactly one text content block, no image block", () => {
    const content = buildMessageContent({ kind: "text", text: "Dallas 60cm 0.38" });
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
  });

  it("an image source produces an image content block plus a trailing instruction text block", () => {
    const bytes = Buffer.from("fake-png-bytes");
    const content = buildMessageContent({ kind: "image", bytes, mediaType: "image/png", fileName: "offer.png" });
    expect(content).toHaveLength(2);
    expect(content[0].type).toBe("image");
    expect(content[1].type).toBe("text");
  });

  it("builds the base64 image data correctly from the original bytes", () => {
    const bytes = Buffer.from("fake-jpeg-bytes");
    const content = buildMessageContent({ kind: "image", bytes, mediaType: "image/jpeg" });
    const imageBlock = content[0] as { type: "image"; source: { type: "base64"; media_type: string; data: string } };
    expect(imageBlock.source.type).toBe("base64");
    expect(imageBlock.source.media_type).toBe("image/jpeg");
    expect(imageBlock.source.data).toBe(bytes.toString("base64"));
    expect(Buffer.from(imageBlock.source.data, "base64").equals(bytes)).toBe(true);
  });

  it("includes the supplier context in the accompanying instruction text for an image source", () => {
    const bytes = Buffer.from("fake-bytes");
    const content = buildMessageContent(
      { kind: "image", bytes, mediaType: "image/png" },
      { supplierName: "Flores de Colombia", supplierCountry: "Colombia", documentLabel: "Screenshot of foto" },
    );
    const textBlock = content[1] as { type: "text"; text: string };
    expect(textBlock.text).toContain("Flores de Colombia");
    expect(textBlock.text).toContain("Colombia");
    expect(textBlock.text).toContain("Screenshot of foto");
  });

  it("includes the supplier context in the instruction text for a text source", () => {
    const content = buildMessageContent(
      { kind: "text", text: "Dallas 60cm 0.38" },
      { supplierName: "Rosas del Ecuador" },
    );
    const textBlock = content[0] as { type: "text"; text: string };
    expect(textBlock.text).toContain("Rosas del Ecuador");
    expect(textBlock.text).toContain("Dallas 60cm 0.38");
  });

  it("never leaks the raw base64 image data into the instruction text block", () => {
    const bytes = Buffer.from("fake-bytes-that-must-not-leak");
    const content = buildMessageContent({ kind: "image", bytes, mediaType: "image/png" });
    const base64 = bytes.toString("base64");
    const textBlock = content[1] as { type: "text"; text: string };
    expect(textBlock.text).not.toContain(base64);
  });
});
