import Decimal from "decimal.js";
import { toMoney } from "./decimal";
import { PricingError } from "./errors";
import type { AdditionalCostInput, CurrencyCode, ExchangeRateSnapshot, FreightRateUnit, Incoterm } from "./types";

/**
 * Freight cost per stem.
 *   vracht per doos = gewicht per doos (kg) x vrachttarief per kg
 *   vracht per steel = vracht per doos / stelen per doos
 */
export function freightPerStem(
  weightPerBoxKg: Decimal.Value,
  freightRatePerKg: Decimal.Value,
  stemsPerBox: number,
): Decimal {
  assertPositiveStems(stemsPerBox);
  const weight = toMoney(weightPerBoxKg);
  const rate = toMoney(freightRatePerKg);
  assertNonNegative(weight, "NEGATIVE_WEIGHT", "weightPerBoxKg");
  assertNonNegative(rate, "NEGATIVE_PRICE", "freightRatePerKg");

  const perBox = weight.times(rate);
  return perBox.dividedBy(stemsPerBox);
}

/**
 * Freight cost per stem for any rate unit:
 *   PER_KG:   gewicht per doos x tarief / stelen per doos
 *   PER_BOX:  tarief / stelen per doos
 *   PER_STEM: tarief
 */
export function freightPerStemForUnit(params: {
  rate: Decimal.Value;
  unit: FreightRateUnit;
  stemsPerBox: number;
  weightPerBoxKg?: Decimal.Value;
}): Decimal {
  const { rate, unit, stemsPerBox, weightPerBoxKg } = params;
  if (unit === "PER_KG") {
    if (weightPerBoxKg === undefined) {
      throw new PricingError("MISSING_WEIGHT", "Box weight is required for a per-kg freight rate");
    }
    return freightPerStem(weightPerBoxKg, rate, stemsPerBox);
  }

  assertPositiveStems(stemsPerBox);
  const amount = toMoney(rate);
  assertNonNegative(amount, "NEGATIVE_PRICE", "freightRate");
  return unit === "PER_BOX" ? amount.dividedBy(stemsPerBox) : amount;
}

/**
 * Handling cost per stem: handling is entered per box, converted per stem.
 *   handling per steel = handling per doos / stelen per doos
 */
export function handlingPerStem(handlingPerBox: Decimal.Value, stemsPerBox: number): Decimal {
  assertPositiveStems(stemsPerBox);
  const perBox = toMoney(handlingPerBox);
  assertNonNegative(perBox, "NEGATIVE_PRICE", "handlingPerBox");
  return perBox.dividedBy(stemsPerBox);
}

/** FOB cost price per stem is simply the farm's FOB price per stem. */
export function fobCostPricePerStem(fobPricePerStem: Decimal.Value): Decimal {
  const fob = toMoney(fobPricePerStem);
  assertNonNegative(fob, "NEGATIVE_PRICE", "fobPricePerStem");
  return fob;
}

/** C&F (CFR) cost price per stem = FOB + freight per stem. */
export function cfrCostPricePerStem(
  fobPricePerStem: Decimal.Value,
  freightPerStemValue: Decimal.Value,
): Decimal {
  return fobCostPricePerStem(fobPricePerStem).plus(toMoney(freightPerStemValue));
}

/**
 * Convert one additional cost to a per-stem amount, honouring its unit:
 *   PER_STEM: amount as-is
 *   PER_KG:   amount x gewicht per doos / stelen per doos
 *   PER_BOX:  amount / stelen per doos
 *   FLAT:     fixed amount per doos, allocated across the box's stems
 *             (i.e. amount / stelen per doos)
 */
export function additionalCostPerStem(
  cost: AdditionalCostInput,
  stemsPerBox: number,
  weightPerBoxKg?: Decimal.Value,
): Decimal {
  const amount = toMoney(cost.amount);
  assertNonNegative(amount, "NEGATIVE_PRICE", `${cost.name} amount`);

  if (cost.unit === "PER_STEM") return amount;

  if (cost.unit === "PER_KG") {
    if (weightPerBoxKg === undefined) {
      throw new PricingError("MISSING_WEIGHT", `Box weight is required for the per-kg cost "${cost.name}"`);
    }
    return freightPerStem(weightPerBoxKg, amount, stemsPerBox);
  }

  // PER_BOX and FLAT both allocate a per-box amount across the box's stems.
  assertPositiveStems(stemsPerBox);
  return amount.dividedBy(stemsPerBox);
}

/**
 * DDP cost price per stem = FOB + freight + all additional costs
 * (all already expressed per stem).
 */
export function ddpCostPricePerStem(
  fobPricePerStem: Decimal.Value,
  freightPerStemValue: Decimal.Value,
  totalAdditionalCostPerStem: Decimal.Value,
): Decimal {
  const additional = toMoney(totalAdditionalCostPerStem);
  assertNonNegative(additional, "NEGATIVE_PRICE", "additionalCostPerStem");
  return cfrCostPricePerStem(fobPricePerStem, freightPerStemValue).plus(additional);
}

/** Dispatch cost-price calculation based on incoterm (all inputs per stem). */
export function costPricePerStemForIncoterm(params: {
  incoterm: Incoterm;
  fobPricePerStem: Decimal.Value;
  freightPerStemValue?: Decimal.Value;
  totalAdditionalCostPerStem?: Decimal.Value;
}): Decimal {
  const { incoterm, fobPricePerStem } = params;

  if (incoterm === "FOB") {
    return fobCostPricePerStem(fobPricePerStem);
  }

  if (params.freightPerStemValue === undefined) {
    throw new PricingError("MISSING_FREIGHT_RATE", "Freight per stem is required for C&F/DDP");
  }

  if (incoterm === "CFR") {
    return cfrCostPricePerStem(fobPricePerStem, params.freightPerStemValue);
  }

  // DDP
  return ddpCostPricePerStem(
    fobPricePerStem,
    params.freightPerStemValue,
    params.totalAdditionalCostPerStem ?? 0,
  );
}

/**
 * Convert an amount between two currencies using an exchange-rate snapshot.
 * The snapshot always encodes "1 baseCurrency = rate quoteCurrency". This
 * function accepts conversion in either direction relative to that snapshot.
 */
export function convertCurrency(
  amount: Decimal.Value,
  from: CurrencyCode,
  to: CurrencyCode,
  exchangeRate: ExchangeRateSnapshot | null,
): Decimal {
  const value = toMoney(amount);
  if (from === to) return value;

  if (!exchangeRate) {
    throw new PricingError(
      "MISSING_EXCHANGE_RATE",
      `No exchange rate provided to convert ${from} -> ${to}`,
    );
  }

  const rate = toMoney(exchangeRate.rate);
  if (exchangeRate.baseCurrency === from && exchangeRate.quoteCurrency === to) {
    return value.times(rate);
  }
  if (exchangeRate.baseCurrency === to && exchangeRate.quoteCurrency === from) {
    if (rate.isZero()) {
      throw new PricingError("DIVISION_BY_ZERO", "Exchange rate is zero, cannot invert");
    }
    return value.dividedBy(rate);
  }

  throw new PricingError(
    "MISSING_EXCHANGE_RATE",
    `Exchange rate snapshot (${exchangeRate.baseCurrency}->${exchangeRate.quoteCurrency}) does not match requested conversion ${from}->${to}`,
  );
}

/**
 * Apply a margin (markup) percentage on top of a cost price.
 *   verkoopprijs = kostprijs x (1 + margepercentage / 100)
 */
export function applyMargin(costPrice: Decimal.Value, marginPercent: Decimal.Value): Decimal {
  const cost = toMoney(costPrice);
  const margin = toMoney(marginPercent);
  assertNonNegative(cost, "NEGATIVE_PRICE", "costPrice");
  return cost.times(toMoney(1).plus(margin.dividedBy(100)));
}

function assertPositiveStems(stemsPerBox: number): void {
  if (stemsPerBox === 0) {
    throw new PricingError("DIVISION_BY_ZERO", "stemsPerBox is zero, cannot divide");
  }
  if (stemsPerBox < 0) {
    throw new PricingError("NEGATIVE_PRICE", "stemsPerBox cannot be negative");
  }
}

function assertNonNegative(value: Decimal, code: string, field: string): void {
  if (value.isNegative()) {
    throw new PricingError(code, `${field} cannot be negative`);
  }
}
