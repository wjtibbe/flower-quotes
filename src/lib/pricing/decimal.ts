import Decimal from "decimal.js";

// A dedicated Decimal constructor for money/quantity math, configured for
// high internal precision. Never use `number`/floating point for currency
// values anywhere in the pricing engine - see section 23 of the product spec.
export const Money = Decimal.clone({
  precision: 34, // plenty of headroom for chained multiplications/divisions
  rounding: Decimal.ROUND_HALF_UP, // "normale wiskundige afronding"
});

export type MoneyValue = Decimal.Value; // number | string | Decimal - accepted inputs

export function toMoney(value: MoneyValue): Decimal {
  return new Money(value);
}

// Round to the given number of decimal places using standard "round half up"
// arithmetic rounding. Used only at display/storage boundaries - never
// mid-calculation (see section 11.7 "Gebruik geen tussentijdse afronding").
export function roundTo(value: Decimal, decimals: number): Decimal {
  return value.toDecimalPlaces(decimals, Money.ROUND_HALF_UP);
}
