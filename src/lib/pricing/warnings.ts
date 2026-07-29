import Decimal from "decimal.js";
import type { AdditionalCostResult, PriceLineBreakdown, QuoteWarning } from "./types";
import type { ConfidenceLevel } from "@prisma/client";

const STALE_RATE_DAYS = 14;
const UNUSUAL_WEIGHT_MIN_KG = new Decimal(0.5);
const UNUSUAL_WEIGHT_MAX_KG = new Decimal(30);
const UNUSUAL_SELL_PRICE_MIN = new Decimal(0.05);
const UNUSUAL_SELL_PRICE_MAX = new Decimal(20);

/**
 * Flags a route's additional costs that share the same CostCategory - e.g. a
 * combined "Clearing & inspection" row configured alongside separate
 * "Clearing"/"Inspection" rows. `calculatePriceLine` sums every currently
 * active, distinct-named cost in a category (intentional: a route can
 * legitimately have several genuinely separate fees under one category), so
 * more than one active row in the same category is not necessarily wrong,
 * but it CAN mean the same clearing/inspection charge was entered twice.
 * Purely structural - it never inspects cost names to decide what a cost
 * "is" - so it can only flag the possibility for a human to check the
 * route's own cost configuration, never silently change the calculation.
 */
export function detectDuplicateCostCategories(costs: AdditionalCostResult[]): QuoteWarning[] {
  const namesByCategory = new Map<string, Set<string>>();
  for (const c of costs) {
    const names = namesByCategory.get(c.category) ?? new Set<string>();
    names.add(c.name);
    namesByCategory.set(c.category, names);
  }

  const warnings: QuoteWarning[] = [];
  for (const [category, names] of namesByCategory) {
    if (names.size > 1) {
      warnings.push({
        code: "DUPLICATE_COST_CATEGORY",
        message: `Meerdere actieve kostenregels in categorie ${category} (${[...names].join(", ")}) - controleer of dit niet dubbel telt.`,
      });
    }
  }
  return warnings;
}

export function collectLineWarnings(params: {
  confidence?: ConfidenceLevel | null;
  productVariantLinked: boolean;
  weightPerBoxKg?: Decimal.Value | null;
  freightRateUpdatedAt?: Date | null;
  breakdown: PriceLineBreakdown;
}): QuoteWarning[] {
  const warnings: QuoteWarning[] = [];

  if (params.confidence === "LOW") {
    warnings.push({ code: "LOW_AI_CONFIDENCE", message: "Herkenning van deze regel heeft een lage betrouwbaarheid" });
  }

  if (!params.productVariantLinked) {
    warnings.push({
      code: "NO_CENTRAL_PRODUCT_LINKED",
      message: "Deze regel is nog niet gekoppeld aan een centraal product",
    });
  }

  if (params.freightRateUpdatedAt) {
    const ageDays = (Date.now() - params.freightRateUpdatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > STALE_RATE_DAYS) {
      warnings.push({ code: "STALE_RATE", message: `Vrachttarief is ouder dan ${STALE_RATE_DAYS} dagen` });
    }
  }

  if (params.weightPerBoxKg !== undefined && params.weightPerBoxKg !== null) {
    const weight = new Decimal(params.weightPerBoxKg);
    if (weight.lessThan(UNUSUAL_WEIGHT_MIN_KG) || weight.greaterThan(UNUSUAL_WEIGHT_MAX_KG)) {
      warnings.push({ code: "UNUSUAL_WEIGHT", message: "Ongebruikelijk gewicht per doos" });
    }
  }

  if (params.breakdown.isManualOverride) {
    warnings.push({ code: "MANUAL_PRICE_OVERRIDE", message: "Verkoopprijs is handmatig aangepast" });
  }

  const finalPrice = params.breakdown.finalSellPricePerStemRounded;
  if (finalPrice.lessThan(UNUSUAL_SELL_PRICE_MIN) || finalPrice.greaterThan(UNUSUAL_SELL_PRICE_MAX)) {
    warnings.push({ code: "UNUSUAL_SELL_PRICE", message: "Ongebruikelijk hoge of lage verkoopprijs" });
  }

  return warnings;
}
