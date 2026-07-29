import type { CurrencyCode } from "./pricing";

/**
 * EUR is the single allowed base currency for manually maintained exchange
 * rates (see exchange-rates/actions.ts): every stored row represents
 * "1 EUR = rate targetCurrency". A row stored in the opposite direction is
 * legacy data and must never be treated as a source of truth.
 */
export const BASE_CURRENCY: CurrencyCode = "EUR";

export interface StoredExchangeRate {
  baseCurrency: CurrencyCode;
  quoteCurrency: CurrencyCode;
  rate: { toString(): string };
}

/**
 * The current EUR-based row for one non-EUR currency, or null if none is
 * configured. Only rows with baseCurrency = EUR are ever considered, so a
 * legacy reversed row (e.g. "1 USD = X EUR") can never win over the
 * canonical EUR-based one, even if both happen to exist.
 */
export function findEurRate<T extends StoredExchangeRate>(rows: T[], currency: CurrencyCode): T | null {
  if (currency === BASE_CURRENCY) return null;
  return rows.find((r) => r.baseCurrency === BASE_CURRENCY && r.quoteCurrency === currency) ?? null;
}

/**
 * "1 from = X to" for display, derived from the EUR-based rate (dividing
 * when `from` is the non-EUR side). Returns null when `from` and `to` are
 * equal or no EUR-based rate is configured for the non-EUR currency.
 */
export function displayRate(rows: StoredExchangeRate[], from: CurrencyCode, to: CurrencyCode): string | null {
  if (from === to) return null;
  const nonEur = from === BASE_CURRENCY ? to : from;
  const eurRate = findEurRate(rows, nonEur);
  if (!eurRate) return null;
  const value = Number(eurRate.rate.toString());
  if (from === BASE_CURRENCY) return value.toString();
  return value !== 0 ? (1 / value).toFixed(6) : null;
}
