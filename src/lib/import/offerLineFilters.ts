/**
 * Temporary, global business rule: "we only offer QB for now" - HB (Half
 * Box) is normalized to QB for a NEW import's persisted/matched box type.
 * The line itself is NEVER dropped; only its CURRENT `boxType` is
 * normalized (see `mapParsedOfferLineToCreateInput` in offerLineMapping.ts,
 * the only place this is applied). The ORIGINAL supplier value is always
 * preserved verbatim in `rawText` and `extractedSnapshot` for audit.
 */

/** Case-insensitive, trimmed check for the box type this temporary rule normalizes. */
export function isIgnoredBoxType(boxType: string | null | undefined): boolean {
  if (!boxType) return false;
  return boxType.trim().toUpperCase() === "HB";
}

/**
 * The box type as it should be PERSISTED (and therefore matched against):
 * HB normalizes to "QB". QB, any other box type, and null/unknown all pass
 * through unchanged.
 */
export function normalizeBoxTypeForImport(boxType: string | null | undefined): string | null | undefined {
  if (isIgnoredBoxType(boxType)) return "QB";
  return boxType;
}
