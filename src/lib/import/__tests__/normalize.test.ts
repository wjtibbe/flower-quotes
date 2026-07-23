import { describe, expect, it } from "vitest";
import { parseLengthCm } from "../normalize";

describe("parseLengthCm", () => {
  it("treats 60, 60CM and 60 cm as the same numeric length", () => {
    expect(parseLengthCm("60")).toBe(60);
    expect(parseLengthCm("60CM")).toBe(60);
    expect(parseLengthCm("60 cm")).toBe(60);
    expect(parseLengthCm("60cm")).toBe(60);
  });

  it("returns a plain number, never a string with a unit suffix", () => {
    const result = parseLengthCm("60cm");
    expect(typeof result).toBe("number");
  });

  it("keeps a decimal length and accepts a comma decimal separator", () => {
    expect(parseLengthCm("60.5cm")).toBe(60.5);
    expect(parseLengthCm("60,5 cm")).toBe(60.5);
  });

  it("trims surrounding whitespace", () => {
    expect(parseLengthCm("  70 cm  ")).toBe(70);
  });

  it("returns null when there is no recognizable number", () => {
    expect(parseLengthCm("cm")).toBeNull();
    expect(parseLengthCm("")).toBeNull();
    expect(parseLengthCm("long")).toBeNull();
  });
});
