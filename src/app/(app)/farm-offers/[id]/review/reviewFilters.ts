/**
 * Pure, React/DB-free helpers for the Farm Offer review screen's line
 * filters. Operates purely over the already-loaded `OfferLineViewModel[]`
 * (see `ReviewOfferClient.tsx`) - no additional queries, no re-matching, no
 * persistence. Filtering only ever changes which review cards are visible.
 */

export type ReviewFilter = "ALL" | "NEEDS_ATTENTION" | "READY" | "BLOCKING" | "WARNINGS" | "UNMATCHED";

/** Display order used for the summary/filter row. */
export const REVIEW_FILTERS: ReviewFilter[] = [
  "ALL",
  "NEEDS_ATTENTION",
  "READY",
  "BLOCKING",
  "WARNINGS",
  "UNMATCHED",
];

export const REVIEW_FILTER_LABELS: Record<ReviewFilter, string> = {
  ALL: "All",
  NEEDS_ATTENTION: "Needs attention",
  READY: "Ready",
  BLOCKING: "Blocking",
  WARNINGS: "Warnings",
  UNMATCHED: "Unmatched",
};

/** The minimal shape this module needs from a review line - a structural subset of `OfferLineViewModel`. */
export interface ReviewFilterLine {
  matchStatus: string;
  validationErrors: string[];
  validationWarnings: string[];
}

export interface ReviewFilterCounts {
  all: number;
  needsAttention: number;
  ready: number;
  blocking: number;
  warnings: number;
  unmatched: number;
}

function isBlockingLine(line: ReviewFilterLine): boolean {
  return line.validationErrors.length > 0;
}

function hasUnresolvedWarnings(line: ReviewFilterLine): boolean {
  return line.validationWarnings.length > 0;
}

function isUnmatchedLine(line: ReviewFilterLine): boolean {
  return line.matchStatus === "UNMATCHED";
}

/** "Needs attention": union of blocking, warnings, unmatched - a line counts once even when it satisfies more than one category. */
export function lineNeedsAttention(line: ReviewFilterLine): boolean {
  return isBlockingLine(line) || hasUnresolvedWarnings(line) || isUnmatchedLine(line);
}

/** "Ready": exactly the complement of needsAttention - no blocking errors, no unresolved warnings, and matched. */
export function isReadyLine(line: ReviewFilterLine): boolean {
  return !lineNeedsAttention(line);
}

/** Counts for the summary row / filter chips, all derived from the same per-line predicates the filters themselves use - never a second, divergent calculation. */
export function computeReviewFilterCounts(lines: ReviewFilterLine[]): ReviewFilterCounts {
  let needsAttention = 0;
  let blocking = 0;
  let warnings = 0;
  let unmatched = 0;
  for (const line of lines) {
    if (isBlockingLine(line)) blocking++;
    if (hasUnresolvedWarnings(line)) warnings++;
    if (isUnmatchedLine(line)) unmatched++;
    if (lineNeedsAttention(line)) needsAttention++;
  }
  return { all: lines.length, needsAttention, ready: lines.length - needsAttention, blocking, warnings, unmatched };
}

/** Opens on the lines that need work when there are any, otherwise shows everything - the main goal is surfacing problems immediately, not hiding a clean offer behind an extra click. */
export function defaultReviewFilter(counts: ReviewFilterCounts): ReviewFilter {
  return counts.needsAttention > 0 ? "NEEDS_ATTENTION" : "ALL";
}

export function filterReviewLines<T extends ReviewFilterLine>(lines: T[], filter: ReviewFilter): T[] {
  switch (filter) {
    case "ALL":
      return lines;
    case "NEEDS_ATTENTION":
      return lines.filter(lineNeedsAttention);
    case "READY":
      return lines.filter(isReadyLine);
    case "BLOCKING":
      return lines.filter(isBlockingLine);
    case "WARNINGS":
      return lines.filter(hasUnresolvedWarnings);
    case "UNMATCHED":
      return lines.filter(isUnmatchedLine);
    default:
      return lines;
  }
}

/** Compact, positive copy for an empty filtered result (never a blank section). */
export function reviewFilterEmptyMessage(filter: ReviewFilter): string {
  switch (filter) {
    case "NEEDS_ATTENTION":
      return "Alle regels zijn opgelost.";
    case "READY":
      return "Geen regels zonder openstaande problemen.";
    case "BLOCKING":
      return "Geen regels met blocking errors.";
    case "WARNINGS":
      return "Geen regels met waarschuwingen.";
    case "UNMATCHED":
      return "Geen unmatched regels.";
    case "ALL":
    default:
      return "Geen regels gevonden.";
  }
}
