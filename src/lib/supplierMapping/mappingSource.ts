import { INTERNAL_RAWTEXT_PLACEHOLDERS } from "@/lib/import/types";

/**
 * Whether a `FarmOfferLine.rawText` is suitable as a `SupplierLineMapping`
 * source (guard for the supplier-mapping feature). A mapping only makes
 * sense when keyed on text the SUPPLIER actually wrote, so this rejects:
 *   - null/undefined
 *   - empty or whitespace-only text
 *   - any internal, non-supplier-authored placeholder (a degraded AI line or
 *     a manually-added review line - see `INTERNAL_RAWTEXT_PLACEHOLDERS`)
 *
 * Pure and database-independent; used both server-side
 * (`saveSupplierLineMapping`, authoritative) and for the review view-model's
 * "Save as supplier mapping" visibility, so the two can never disagree.
 */
export function isValidSupplierMappingSource(rawText: string | null | undefined): boolean {
  if (!rawText) return false;
  const trimmed = rawText.trim();
  if (trimmed.length === 0) return false;
  if (INTERNAL_RAWTEXT_PLACEHOLDERS.includes(trimmed)) return false;
  return true;
}
