/**
 * What the "Betrouwbaarheid" (LOW/MEDIUM/HIGH) badge on the Farm Offer
 * detail page used to show: `FarmOfferLine.confidence`, the AI parser's OWN
 * confidence in its extraction at import time (e.g. "LOW" because the
 * source line was ambiguous or partially unreadable). That value is frozen
 * at import time and never updated - so a line that has since been matched
 * to a PackagingWeightProfile, had its packaging canonically enriched, and
 * had its parent offer finalized (REVIEWED) still displayed "LOW", which
 * reads as "this data is still unreliable" even though the app's own
 * matching/finalization workflow has since confirmed it. This module
 * replaces that display with the line's CURRENT resolution state instead.
 *
 * No new DB field: this is derived entirely from `FarmOfferLine.matchStatus`
 * (already persisted) and the parent `FarmOffer.status`, plus one optional,
 * caller-supplied signal (`hasSupplierMapping`) for distinguishing a
 * `USER_LINKED` line resolved via a saved `SupplierLineMapping` from one the
 * user picked by hand - itself derived from the existing `SupplierLineMapping`
 * table, not a new column. The original AI `confidence` is left completely
 * untouched in the database and stays available wherever the raw extraction/
 * audit data is already shown (e.g. `extractedSnapshot` on the review
 * screen) - it just no longer dominates the reviewed-offer overview.
 */

export type LineStatusLabel = "Confirmed" | "Auto matched" | "Supplier mapping" | "Manually matched" | "Not linked";

export interface ResolveLineStatusLabelInput {
  /** `FarmOffer.status` - "REVIEWED" once finalization has confirmed every line. */
  offerStatus: string | null | undefined;
  /** `FarmOfferLine.matchStatus`. */
  matchStatus: string | null | undefined;
  /**
   * Whether this line's CURRENT assortment link matches a saved
   * `SupplierLineMapping` for this supplier - only meaningful when
   * `matchStatus` is `USER_LINKED`; ignored otherwise. Computed by the
   * caller (a DB lookup) so this function stays pure/DB-free.
   */
  hasSupplierMapping?: boolean;
}

/**
 * Resolves the label the reviewed-detail page should show instead of the
 * stale AI extraction confidence (section 1). Once the parent offer is
 * REVIEWED, finalization has already validated every line, so a single
 * "Confirmed" state is accurate and sufficient (no need to re-derive the
 * match method) - per spec, this is an acceptable simplification, not a loss
 * of information (the match method is still derivable from `matchStatus`
 * for a DRAFT offer, where "Confirmed" would be misleading since nothing has
 * been finalized yet).
 */
export function resolveLineStatusLabel({
  offerStatus,
  matchStatus,
  hasSupplierMapping,
}: ResolveLineStatusLabelInput): LineStatusLabel {
  if (offerStatus === "REVIEWED") return "Confirmed";
  switch (matchStatus) {
    case "AUTO_MATCHED":
    case "DERIVED":
      return "Auto matched";
    case "USER_LINKED":
      return hasSupplierMapping ? "Supplier mapping" : "Manually matched";
    default:
      return "Not linked";
  }
}

/** Tailwind badge class per label - mirrors the existing `badge-*` palette (globals.css), no new classes needed. */
export function lineStatusBadgeClass(label: LineStatusLabel): string {
  switch (label) {
    case "Confirmed":
      return "badge-auto-matched"; // green - same tone already used for a confirmed/positive state
    case "Auto matched":
      return "badge-auto-matched";
    case "Supplier mapping":
      return "badge-user-linked";
    case "Manually matched":
      return "badge-user-linked";
    case "Not linked":
      return "badge-unmatched";
  }
}
