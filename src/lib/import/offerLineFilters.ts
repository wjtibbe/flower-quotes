/**
 * Temporary, global business rule: "we only offer QB for now" - HB (Half
 * Box) is normalized to QB for a NEW import's persisted/matched box type,
 * and a missing/unstated box type defaults to QB too (deterministic Farm
 * Offer defaults: the application currently works only with QB, so there is
 * nothing to guess or ask a reviewer to confirm). The line itself is NEVER
 * dropped; only its CURRENT `boxType` is normalized (see
 * `mapParsedOfferLineToCreateInput` in offerLineMapping.ts, the only place
 * this is applied). The ORIGINAL supplier value is always preserved
 * verbatim in `rawText` and `extractedSnapshot` for audit.
 */

/** Case-insensitive, trimmed check for the box type this temporary rule normalizes. */
export function isIgnoredBoxType(boxType: string | null | undefined): boolean {
  if (!boxType) return false;
  return boxType.trim().toUpperCase() === "HB";
}

/**
 * The box type as it should be PERSISTED (and therefore matched against):
 * HB normalizes to "QB", a missing/blank box type also defaults to "QB",
 * and any other box type (QB included) passes through unchanged (trimmed).
 */
export function normalizeBoxTypeForImport(boxType: string | null | undefined): string {
  const trimmed = boxType?.trim();
  if (!trimmed || isIgnoredBoxType(trimmed)) return "QB";
  return trimmed;
}
