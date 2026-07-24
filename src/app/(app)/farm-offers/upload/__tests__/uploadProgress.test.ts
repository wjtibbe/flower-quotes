import { describe, expect, it } from "vitest";
import { UPLOAD_STATUS_MESSAGES, formatElapsedTime, rotatingStatusIndex } from "../uploadProgress";

describe("formatElapsedTime", () => {
  it("formats zero as 00:00", () => {
    expect(formatElapsedTime(0)).toBe("00:00");
  });

  it("formats a single-digit second count with a leading zero", () => {
    expect(formatElapsedTime(3)).toBe("00:03");
  });

  it("formats a two-digit second count under a minute", () => {
    expect(formatElapsedTime(23)).toBe("00:23");
  });

  it("formats exactly one minute", () => {
    expect(formatElapsedTime(60)).toBe("01:00");
  });

  it("formats minutes and seconds together", () => {
    expect(formatElapsedTime(125)).toBe("02:05");
  });

  it("truncates a fractional second count", () => {
    expect(formatElapsedTime(23.9)).toBe("00:23");
  });

  it("clamps a negative value to 00:00 instead of showing a negative timer", () => {
    expect(formatElapsedTime(-5)).toBe("00:00");
  });

  it("clamps a non-finite value to 00:00", () => {
    expect(formatElapsedTime(NaN)).toBe("00:00");
    expect(formatElapsedTime(Infinity)).toBe("00:00");
  });
});

describe("rotatingStatusIndex", () => {
  it("starts at the first message at elapsed=0", () => {
    expect(rotatingStatusIndex(0, 5, 3)).toBe(0);
  });

  it("stays on the first message for the whole first interval", () => {
    expect(rotatingStatusIndex(2, 5, 3)).toBe(0);
  });

  it("advances to the second message once the interval elapses", () => {
    expect(rotatingStatusIndex(3, 5, 3)).toBe(1);
    expect(rotatingStatusIndex(5, 5, 3)).toBe(1);
  });

  it("wraps back to the first message after cycling through every message", () => {
    // 5 messages, 3s each -> cycle length 15s.
    expect(rotatingStatusIndex(15, 5, 3)).toBe(0);
    expect(rotatingStatusIndex(16, 5, 3)).toBe(0);
  });

  it("uses the exported default interval when none is passed", () => {
    expect(rotatingStatusIndex(0, UPLOAD_STATUS_MESSAGES.length)).toBe(0);
  });

  it("returns 0 for an empty message list instead of dividing by zero", () => {
    expect(rotatingStatusIndex(30, 0, 3)).toBe(0);
  });

  it("falls back to the default interval for a non-positive interval", () => {
    expect(rotatingStatusIndex(3, 5, 0)).toBe(rotatingStatusIndex(3, 5));
    expect(rotatingStatusIndex(3, 5, -1)).toBe(rotatingStatusIndex(3, 5));
  });

  it("clamps a negative elapsed value to 0", () => {
    expect(rotatingStatusIndex(-10, 5, 3)).toBe(0);
  });

  it("every index it can return is a valid index into UPLOAD_STATUS_MESSAGES", () => {
    for (let elapsed = 0; elapsed < 60; elapsed++) {
      const index = rotatingStatusIndex(elapsed, UPLOAD_STATUS_MESSAGES.length);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(UPLOAD_STATUS_MESSAGES.length);
      expect(UPLOAD_STATUS_MESSAGES[index]).toBeTypeOf("string");
    }
  });
});
