import type Decimal from "decimal.js";

export type Incoterm = "FOB" | "CFR" | "DDP";
export type CurrencyCode = "USD" | "EUR";
// How a freight rate amount is expressed. PER_KG needs the box weight,
// PER_BOX divides by stems per box, PER_STEM is used as-is.
export type FreightRateUnit = "PER_KG" | "PER_BOX" | "PER_STEM";

export interface ExchangeRateSnapshot {
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: Decimal.Value; // 1 baseCurrency = `rate` quoteCurrency
}

export type CostCategory =
  | "CLEARING"
  | "INSPECTION"
  | "IMPORT"
  | "HANDLING"
  | "LOCAL_DELIVERY"
  | "DOCUMENTATION"
  | "OTHER";

// How an additional-cost amount is expressed. PER_KG needs the box weight;
// PER_BOX and FLAT divide by stems per box (FLAT = a fixed amount charged per
// box, allocated across the box's stems); PER_STEM is used as-is.
export type CostRateUnit = "PER_STEM" | "PER_KG" | "PER_BOX" | "FLAT";

// One additional route cost (clearing, inspection, handling, import, ...),
// resolved for the current validity date and passed to the engine.
export interface AdditionalCostInput {
  name: string;
  category: CostCategory;
  amount: Decimal.Value;
  unit: CostRateUnit;
}

// Per-stem result of one additional cost, kept in the breakdown/snapshot so
// every cost line stays individually explainable.
export interface AdditionalCostResult {
  name: string;
  category: CostCategory;
  amount: string; // original amount
  unit: CostRateUnit;
  perStem: string; // converted to cost per stem
}

export interface PriceLineInput {
  incoterm: Incoterm;
  fobPricePerStem: Decimal.Value;
  sourceCurrency: CurrencyCode;
  targetCurrency: CurrencyCode;
  stemsPerBox: number;
  marginPercent: Decimal.Value;

  // Required for CFR/DDP. `freightRatePerKg` is the legacy name for the rate
  // amount - its unit is `freightRateUnit` (default PER_KG). The box weight
  // is only required when the unit is PER_KG.
  weightPerBoxKg?: Decimal.Value;
  freightRatePerKg?: Decimal.Value;
  freightRateUnit?: FreightRateUnit;

  // Additional route costs (DDP: clearing/inspection/handling/import/...).
  // Only applied for the DDP incoterm, matching the previous behaviour.
  additionalCosts?: AdditionalCostInput[];

  // Required whenever sourceCurrency !== targetCurrency
  exchangeRate?: ExchangeRateSnapshot;

  // Optional manual override of the final sell price (still fully calculated
  // for comparison/audit purposes, see section 13).
  manualSellPricePerStem?: Decimal.Value;
  manualOverrideReason?: string;

  displayDecimals?: number; // default 2, see section 12
}

export interface PriceLineBreakdown {
  incoterm: Incoterm;
  fobPricePerStem: Decimal;
  freightPerStem: Decimal;
  // Category subtotals (per stem) kept for backwards-compatible display and
  // the legacy QuoteLine snapshot columns.
  clearingAndInspectionPerStem: Decimal; // CLEARING + INSPECTION categories
  handlingPerStem: Decimal; // HANDLING category
  otherAdditionalCostPerStem: Decimal; // IMPORT/LOCAL_DELIVERY/DOCUMENTATION/OTHER
  additionalCostPerStem: Decimal; // total of all additional costs, per stem
  additionalCosts: AdditionalCostResult[]; // full per-line breakdown
  totalCostPricePerStemSource: Decimal;
  sourceCurrency: CurrencyCode;
  targetCurrency: CurrencyCode;
  exchangeRateUsed: Decimal | null; // null when sourceCurrency === targetCurrency
  costPricePerStemTarget: Decimal;
  marginPercent: Decimal;
  calculatedSellPricePerStem: Decimal; // full precision
  calculatedSellPricePerStemRounded: Decimal; // display precision
  manualSellPricePerStem: Decimal | null;
  isManualOverride: boolean;
  finalSellPricePerStemRounded: Decimal; // manual override if set, else calculated
}

export type BlockerCode =
  | "MISSING_FOB_PRICE"
  | "MISSING_STEMS_PER_BOX"
  | "ZERO_STEMS_PER_BOX"
  | "MISSING_WEIGHT"
  | "MISSING_FREIGHT_RATE"
  | "MISSING_CUSTOMER_CURRENCY"
  | "MISSING_EXCHANGE_RATE"
  | "MISSING_DDP_CLEARING_INSPECTION"
  | "MISSING_DDP_HANDLING"
  | "INCOTERM_NOT_SUPPORTED_ON_ROUTE"
  | "MISSING_MARGIN"
  | "NEGATIVE_PRICE"
  | "NEGATIVE_WEIGHT"
  | "DIVISION_BY_ZERO";

export interface ValidationIssue {
  code: BlockerCode;
  message: string;
}

export type WarningCode =
  | "LOW_AI_CONFIDENCE"
  | "UNKNOWN_PRODUCT"
  | "NO_CENTRAL_PRODUCT_LINKED"
  | "STALE_RATE"
  | "MANUAL_PRICE_OVERRIDE"
  | "UNUSUAL_WEIGHT"
  | "UNUSUAL_SELL_PRICE";

export interface QuoteWarning {
  code: WarningCode;
  message: string;
}
