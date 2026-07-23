import { describe, expect, it, vi } from "vitest";
import { withRetry, withTimeout } from "../asyncUtils";

describe("withRetry", () => {
  it("returns the result on the first successful attempt without retrying", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { retries: 2 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after a retryable failure and eventually succeeds", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("recovered");
    const onRetry = vi.fn();

    const result = await withRetry(fn, { retries: 2, onRetry });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("throws the last error once all retries are exhausted", async () => {
    const err = new Error("always fails");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { retries: 2 })).rejects.toThrow("always fails");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial attempt + 2 retries
  });

  it("does not retry when the error is not retryable", async () => {
    const err = new Error("client error");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { retries: 2, isRetryable: () => false })).rejects.toThrow("client error");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("waits delayMs(attempt) between retries", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce("ok");
    const delayMs = vi.fn().mockReturnValue(5);

    await withRetry(fn, { retries: 1, delayMs });

    expect(delayMs).toHaveBeenCalledWith(1);
  });
});

describe("withTimeout", () => {
  it("resolves with the value when the promise settles before the timeout", async () => {
    const result = await withTimeout(Promise.resolve("done"), 500, () => new Error("timed out"));
    expect(result).toBe("done");
  });

  it("rejects with the timeout error when the promise never settles in time", async () => {
    const neverSettles = new Promise<string>(() => {});
    await expect(withTimeout(neverSettles, 20, () => new Error("timed out"))).rejects.toThrow("timed out");
  });

  it("propagates the original rejection when it happens before the timeout", async () => {
    const rejectsFast = Promise.reject(new Error("original failure"));
    await expect(withTimeout(rejectsFast, 500, () => new Error("timed out"))).rejects.toThrow("original failure");
  });
});
