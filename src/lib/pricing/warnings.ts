import Decimal from "decimal.js";
import type { PriceLineBreakdown, QuoteWarning } from "./types";
import type { ConfidenceLevel } from "@prisma/client";

const STALE_RATE_DAYS = 14;
const UNUSUAL_WEIGHT_MIN_KG = new Decimal(0.5);
const UNUSUAL_WEIGHT_MAX_KG = new Decimal(30);
const UNUSUAL_SELL_PRICE_MIN = new Decimal(0.05);
const UNUSUAL_SELL_PRICE_MAX = new Decimal(20);

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
