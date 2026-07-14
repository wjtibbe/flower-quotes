import "server-only";
import { prisma } from "@/lib/db";
import { similarity } from "./normalize";

export interface FarmSuggestion {
  farmId: string;
  farmName: string;
  score: number;
}

export interface ProductVariantSuggestion {
  productVariantId: string;
  productId: string;
  label: string; // e.g. "Hydrangea - White - Select"
  score: number;
}

const SUGGESTION_THRESHOLD = 0.55;
const MAX_SUGGESTIONS = 3;

/**
 * Suggests an existing Farm for a raw farm name/alias, matching against both
 * the farm's canonical name and its known aliases (section 5/6: "de app mag
 * een waarschijnlijke match voorstellen, maar de gebruiker moet de
 * uiteindelijke koppeling kunnen controleren" - this never auto-links).
 */
export async function suggestFarm(rawName: string): Promise<FarmSuggestion[]> {
  if (!rawName?.trim()) return [];

  const farms = await prisma.farm.findMany({
    where: { active: true },
    include: { aliases: true },
  });

  const scored = farms.map((farm) => {
    const nameScore = similarity(rawName, farm.name);
    const aliasScore = Math.max(0, ...farm.aliases.map((a) => similarity(rawName, a.alias)));
    return { farmId: farm.id, farmName: farm.name, score: Math.max(nameScore, aliasScore) };
  });

  return scored
    .filter((s) => s.score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Suggests an existing central ProductVariant for a raw
 * productGroup/variety/color/grade combination, matching against product
 * names and their aliases.
 */
export async function suggestProductVariant(params: {
  productGroupRaw?: string;
  varietyRaw?: string;
  colorRaw?: string;
  gradeRaw?: string;
}): Promise<ProductVariantSuggestion[]> {
  const query = [params.productGroupRaw, params.varietyRaw, params.colorRaw, params.gradeRaw]
    .filter(Boolean)
    .join(" ");
  if (!query.trim()) return [];

  const variants = await prisma.productVariant.findMany({
    where: { active: true },
    include: { product: { include: { aliases: true } } },
  });

  const scored = variants.map((variant) => {
    const label = [variant.product.name, variant.variety, variant.color, variant.grade, variant.stemLength]
      .filter(Boolean)
      .join(" - ");
    const directScore = similarity(query, label);
    const aliasScore = Math.max(
      0,
      ...variant.product.aliases.map((a) => similarity(params.productGroupRaw ?? query, a.alias)),
    );
    return {
      productVariantId: variant.id,
      productId: variant.productId,
      label,
      score: Math.max(directScore, aliasScore),
    };
  });

  return scored
    .filter((s) => s.score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);
}
