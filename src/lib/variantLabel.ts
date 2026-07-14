/**
 * Builds the display label for a central product variant, e.g.
 * "Rose - Freedom - 60 cm" or "Hydrangea - White - Select".
 * Used everywhere a variant is shown so labels stay consistent.
 */
export function variantLabel(
  variant: {
    variety?: string | null;
    stemLength?: string | null;
    color?: string | null;
    grade?: string | null;
  },
  productName: string,
): string {
  return [productName, variant.variety, variant.color, variant.grade, variant.stemLength]
    .filter(Boolean)
    .join(" - ");
}
