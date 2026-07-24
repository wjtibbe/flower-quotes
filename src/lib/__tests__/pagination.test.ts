import { describe, expect, it } from "vitest";
import { ALLOWED_PAGE_SIZES, DEFAULT_PAGE_SIZE, parsePageParam, parsePageSizeParam, resolvePagination } from "../pagination";

describe("parsePageParam", () => {
  it("defaults to 1 when missing", () => {
    expect(parsePageParam(undefined)).toBe(1);
  });

  it("parses a valid positive integer", () => {
    expect(parsePageParam("3")).toBe(3);
  });

  it("defaults to 1 for zero/negative/non-integer/non-numeric input", () => {
    expect(parsePageParam("0")).toBe(1);
    expect(parsePageParam("-2")).toBe(1);
    expect(parsePageParam("2.5")).toBe(1);
    expect(parsePageParam("abc")).toBe(1);
  });
});

describe("parsePageSizeParam", () => {
  it("19: default page size is 50", () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
    expect(parsePageSizeParam(undefined)).toBe(50);
  });

  it("accepts every allowed page size", () => {
    for (const size of ALLOWED_PAGE_SIZES) {
      expect(parsePageSizeParam(String(size))).toBe(size);
    }
  });

  it("falls back to the default for an unsupported page size", () => {
    expect(parsePageSizeParam("13")).toBe(DEFAULT_PAGE_SIZE);
    expect(parsePageSizeParam("abc")).toBe(DEFAULT_PAGE_SIZE);
  });
});

describe("resolvePagination", () => {
  it("20: page 1 returns at most pageSize rows (skip=0, take=pageSize)", () => {
    const result = resolvePagination(1, 50, 327);
    expect(result.skip).toBe(0);
    expect(result.take).toBe(50);
  });

  it("21: page 2 skips the first pageSize rows", () => {
    const result = resolvePagination(2, 50, 327);
    expect(result.skip).toBe(50);
    expect(result.take).toBe(50);
  });

  it("22: totalCount is carried through unchanged", () => {
    expect(resolvePagination(1, 50, 327).totalCount).toBe(327);
  });

  it("23: computes the correct total page count (327 rows / 50 -> 7 pages)", () => {
    expect(resolvePagination(1, 50, 327).totalPages).toBe(7);
  });

  it("24: the last page's skip lands exactly on the remainder", () => {
    const result = resolvePagination(7, 50, 327);
    expect(result.page).toBe(7);
    expect(result.skip).toBe(300);
    expect(result.take).toBe(50); // caller still gets the 27 remaining rows from the DB slice
  });

  it("28: an out-of-range requested page (filter narrowed the results) safely resets to page 1", () => {
    const result = resolvePagination(8, 50, 12);
    expect(result.page).toBe(1);
    expect(result.skip).toBe(0);
    expect(result.totalPages).toBe(1);
  });

  it("never returns fewer than 1 total page, even for zero results", () => {
    expect(resolvePagination(1, 50, 0).totalPages).toBe(1);
    expect(resolvePagination(5, 50, 0).page).toBe(1);
  });

  it("keeps a still-valid requested page unchanged", () => {
    expect(resolvePagination(3, 25, 100).page).toBe(3);
  });
});
