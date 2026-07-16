import Decimal from "decimal.js";

/**
 * Quote totals are nothing more than the sum of the individual QuoteLines -
 * each line already carries its own supplier, route, costs and exchange-rate
 * snapshot, so no cross-line calculation ever happens here.
 */
export interface QuoteTotalsInput {
  stemsPerBox: number;
  quantityBoxes: number;
  calculatedSellPricePerStem: Decimal.Value | { toString(): string };
  manualSellPricePerStem?: Decimal.Value | { toString(): string } | null;
}

export interface QuoteTotals {
  totalBoxes: number;
  totalStems: number;
  totalValue: Decimal; // in quote currency, using the final (manual or calculated) price per line
}

export function quoteTotals(lines: QuoteTotalsInput[]): QuoteTotals {
  let totalBoxes = 0;
  let totalStems = 0;
  let totalValue = new Decimal(0);

  for (const line of lines) {
    const stems = line.stemsPerBox * line.quantityBoxes;
    totalBoxes += line.quantityBoxes;
    totalStems += stems;
    const price = new Decimal((line.manualSellPricePerStem ?? line.calculatedSellPricePerStem).toString());
    totalValue = totalValue.plus(price.times(stems));
  }

  return { totalBoxes, totalStems, totalValue };
}
