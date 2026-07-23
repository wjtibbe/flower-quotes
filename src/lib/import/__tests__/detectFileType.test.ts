import { describe, expect, it } from "vitest";
import { detectFileType, resolveImageMediaType } from "../extract/detectFileType";

describe("detectFileType", () => {
  it("detects supported image extensions as IMAGE", () => {
    expect(detectFileType("offer.png")).toBe("IMAGE");
    expect(detectFileType("offer.jpg")).toBe("IMAGE");
    expect(detectFileType("offer.jpeg")).toBe("IMAGE");
    expect(detectFileType("offer.webp")).toBe("IMAGE");
    expect(detectFileType("offer.gif")).toBe("IMAGE");
  });

  it("detects any image/* MIME type as IMAGE even with an unrecognized extension", () => {
    expect(detectFileType("photo", "image/heic")).toBe("IMAGE");
  });

  it("falls back to MANUAL for an unrecognized file", () => {
    expect(detectFileType("notes.bmp")).toBe("MANUAL");
  });
});

describe("resolveImageMediaType", () => {
  it("resolves supported extensions to their exact Anthropic media type", () => {
    expect(resolveImageMediaType("offer.png")).toBe("image/png");
    expect(resolveImageMediaType("offer.jpg")).toBe("image/jpeg");
    expect(resolveImageMediaType("offer.jpeg")).toBe("image/jpeg");
    expect(resolveImageMediaType("offer.webp")).toBe("image/webp");
    expect(resolveImageMediaType("offer.gif")).toBe("image/gif");
  });

  it("prefers a supplied MIME type over the file extension when both are present", () => {
    expect(resolveImageMediaType("offer.jpg", "image/png")).toBe("image/png");
  });

  it("is case-insensitive on the file extension", () => {
    expect(resolveImageMediaType("OFFER.PNG")).toBe("image/png");
  });

  it("returns null for an unsupported format like BMP or TIFF, never guessing a fallback", () => {
    expect(resolveImageMediaType("offer.bmp")).toBeNull();
    expect(resolveImageMediaType("offer.tiff")).toBeNull();
  });

  it("returns null for HEIC (not added this step, per the explicit scope)", () => {
    expect(resolveImageMediaType("offer.heic")).toBeNull();
  });

  it("returns null when there is no extension and no usable MIME type", () => {
    expect(resolveImageMediaType("offer")).toBeNull();
  });

  it("returns null for an unsupported MIME type even if the extension would otherwise be unclear", () => {
    expect(resolveImageMediaType("unknownfile", "application/octet-stream")).toBeNull();
  });
});
