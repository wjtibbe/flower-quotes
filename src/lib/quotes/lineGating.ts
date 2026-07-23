/**
 * Pure gating rules for "may this FarmOfferLine be turned into a QuoteLine".
 * A line is only quotable once a human has explicitly reviewed the offer
 * AND the line has a confirmed assortment link - never while still DRAFT,
 * UNMATCHED or AMBIGUOUS. This is the single source of truth for that rule:
 * both the wizard's candidate query (`quotes/new/page.tsx`) and the
 * server-side revalidation in `createQuotes` (`quotes/actions.ts`) build on
 * the same `QUOTABLE_MATCH_STATUSES` list and `isFarmOfferLineQuotable`
 * check, so a manipulated client can never request a line the wizard itself
 * would never have shown.
 */

/** The only FarmOfferStatus a line's parent offer may be in to be quotable. */
export const QUOTABLE_OFFER_STATUS = "REVIEWED" as const;

/**
 * The only LineMatchStatus values that represent a confirmed assortment
 * link. AMBIGUOUS (multiple candidates, none chosen) and UNMATCHED (no
 * candidate at all) are deliberately excluded - both mean there is no
 * single, human-confirmed PackagingWeightProfile to price against yet.
 */
export const QUOTABLE_MATCH_STATUSES = ["AUTO_MATCHED", "DERIVED", "USER_LINKED"] as const;

export type QuotableMatchStatus = (typeof QUOTABLE_MATCH_STATUSES)[number];

export interface QuotableLineCheckInput {
  offerStatus: string | null | undefined;
  matchStatus: string | null | undefined;
  packagingWeightProfileId: string | null | undefined;
}

export type QuoteGatingBlockerCode = "OFFER_NOT_REVIEWED" | "LINE_NOT_MATCHED" | "PROFILE_MISSING";

export type QuotableLineCheckResult =
  | { ok: true }
  | { ok: false; code: QuoteGatingBlockerCode; message: string };

/**
 * Checks whether one FarmOfferLine (with its parent offer's status already
 * looked up) may be selected into a quote. Pure and database-independent -
 * the caller is responsible for supplying fresh values, never a stale
 * client-supplied copy (see `createQuotes`, which always re-reads the line
 * from the database before calling this).
 */
export function isFarmOfferLineQuotable(input: QuotableLineCheckInput): QuotableLineCheckResult {
  if (input.offerStatus !== QUOTABLE_OFFER_STATUS) {
    return { ok: false, code: "OFFER_NOT_REVIEWED", message: "Offer has not been reviewed." };
  }
  if (
    !input.matchStatus ||
    !(QUOTABLE_MATCH_STATUSES as readonly string[]).includes(input.matchStatus)
  ) {
    return { ok: false, code: "LINE_NOT_MATCHED", message: "Offer line has no confirmed assortment match." };
  }
  if (!input.packagingWeightProfileId) {
    return { ok: false, code: "PROFILE_MISSING", message: "Offer line has no confirmed assortment match." };
  }
  return { ok: true };
}
