import { describe, expect, it } from "vitest";
import {
  computeReviewFilterCounts,
  defaultReviewFilter,
  filterReviewLines,
  lineNeedsAttention,
  reviewFilterEmptyMessage,
} from "../reviewFilters";
import type { ReviewFilterLine } from "../reviewFilters";

function line(overrides: Partial<ReviewFilterLine> = {}): ReviewFilterLine {
  return {
    matchStatus: "AUTO_MATCHED",
    validationErrors: [],
    validationWarnings: [],
    ...overrides,
  };
}

const READY_LINE = line();
const BLOCKING_LINE = line({ validationErrors: ["Geen assortimentartikel gekoppeld."] });
const WARNING_LINE = line({ validationWarnings: ["Steellengte (cm) ontbreekt."] });
const UNMATCHED_LINE = line({ matchStatus: "UNMATCHED", validationErrors: ["Geen assortimentartikel gekoppeld."] });

describe("filterReviewLines", () => {
  const lines = [READY_LINE, BLOCKING_LINE, WARNING_LINE, UNMATCHED_LINE];

  it("ALL returns every line unchanged", () => {
    expect(filterReviewLines(lines, "ALL")).toEqual(lines);
  });

  it("READY returns only lines with no blocking errors, no warnings, and matched", () => {
    expect(filterReviewLines(lines, "READY")).toEqual([READY_LINE]);
  });

  it("BLOCKING returns only lines with one or more blocking errors", () => {
    expect(filterReviewLines(lines, "BLOCKING")).toEqual([BLOCKING_LINE, UNMATCHED_LINE]);
  });

  it("WARNINGS returns only lines with one or more unresolved warnings", () => {
    expect(filterReviewLines(lines, "WARNINGS")).toEqual([WARNING_LINE]);
  });

  it("UNMATCHED returns only lines whose matchStatus is UNMATCHED", () => {
    expect(filterReviewLines(lines, "UNMATCHED")).toEqual([UNMATCHED_LINE]);
  });

  it("NEEDS_ATTENTION returns the unique union of blocking, warnings and unmatched (a line counted once even if it satisfies more than one)", () => {
    const result = filterReviewLines(lines, "NEEDS_ATTENTION");
    expect(result).toEqual([BLOCKING_LINE, WARNING_LINE, UNMATCHED_LINE]);
    expect(result).toHaveLength(3);
  });
});

describe("lineNeedsAttention", () => {
  it("is true for a line satisfying multiple categories at once, counted only once by the caller", () => {
    expect(lineNeedsAttention(BLOCKING_LINE)).toBe(true);
    expect(lineNeedsAttention(UNMATCHED_LINE)).toBe(true);
  });

  it("is false for a fully ready line", () => {
    expect(lineNeedsAttention(READY_LINE)).toBe(false);
  });
});

describe("computeReviewFilterCounts", () => {
  it("computes correct counts, matching the worked example in the spec (74/52/0/22/22)", () => {
    const lines = [
      ...Array.from({ length: 52 }, () => line()),
      ...Array.from({ length: 22 }, () =>
        line({ matchStatus: "UNMATCHED", validationErrors: ["Geen assortimentartikel gekoppeld."] }),
      ),
    ];
    const counts = computeReviewFilterCounts(lines);
    expect(counts).toEqual({ all: 74, needsAttention: 22, ready: 52, blocking: 22, warnings: 0, unmatched: 22 });
  });

  it("counts a line satisfying multiple categories only once toward needsAttention", () => {
    const counts = computeReviewFilterCounts([BLOCKING_LINE, UNMATCHED_LINE, WARNING_LINE]);
    expect(counts.needsAttention).toBe(3);
    expect(counts.blocking).toBe(2);
    expect(counts.unmatched).toBe(1);
    expect(counts.warnings).toBe(1);
  });

  it("returns all-zero counts for an empty line list", () => {
    expect(computeReviewFilterCounts([])).toEqual({ all: 0, needsAttention: 0, ready: 0, blocking: 0, warnings: 0, unmatched: 0 });
  });
});

describe("defaultReviewFilter", () => {
  it("defaults to NEEDS_ATTENTION when there are lines needing attention", () => {
    const counts = computeReviewFilterCounts([READY_LINE, BLOCKING_LINE]);
    expect(defaultReviewFilter(counts)).toBe("NEEDS_ATTENTION");
  });

  it("defaults to ALL when everything is already resolved", () => {
    const counts = computeReviewFilterCounts([READY_LINE, READY_LINE]);
    expect(defaultReviewFilter(counts)).toBe("ALL");
  });

  it("defaults to ALL for an empty offer (nothing needs attention)", () => {
    expect(defaultReviewFilter(computeReviewFilterCounts([]))).toBe("ALL");
  });
});

describe("reviewFilterEmptyMessage", () => {
  it("returns a distinct, compact, positive message per filter", () => {
    expect(reviewFilterEmptyMessage("BLOCKING")).toBe("Geen regels met blocking errors.");
    expect(reviewFilterEmptyMessage("UNMATCHED")).toBe("Geen unmatched regels.");
    expect(reviewFilterEmptyMessage("NEEDS_ATTENTION")).toBe("Alle regels zijn opgelost.");
    expect(reviewFilterEmptyMessage("WARNINGS")).toBe("Geen regels met waarschuwingen.");
    expect(reviewFilterEmptyMessage("READY")).toBe("Geen regels zonder openstaande problemen.");
  });
});

describe("workflow: a fixed line disappears from Needs attention once it becomes Ready", () => {
  it("filters out a line that transitions from blocking to ready between renders", () => {
    const before = [BLOCKING_LINE, READY_LINE];
    expect(filterReviewLines(before, "NEEDS_ATTENTION")).toEqual([BLOCKING_LINE]);

    // Same line, id-equivalent, now fixed (no more errors/warnings, matched).
    const fixedLine = line();
    const after = [fixedLine, READY_LINE];
    expect(filterReviewLines(after, "NEEDS_ATTENTION")).toEqual([]);
    // The filter selection itself ("NEEDS_ATTENTION") is a concern of the
    // calling component's state, not this pure helper - this test only
    // verifies the line-level result actually changes once resolved.
  });
});
