import Decimal from "decimal.js";
import { toMoney, roundTo } from "./decimal";
import {
  additionalCostPerStem as calcAdditionalCostPerStem,
  applyMargin,
  convertCurrency,
  costPricePerStemForIncoterm,
  freightPerStemForUnit,
} from "./calculations";
import { isBlocked, validatePriceLineInput } from "./validation";
import { PricingError } from "./errors";
import type { AdditionalCostResult, CostCategory, PriceLineBreakdown, PriceLineInput } from "./types";

const CLEARING_INSPECTION: CostCategory[] = ["CLEARING", "INSPECTION"];

/**
 * Full pricing pipeline for a single quote line, matching section 11 of the
 * spec end to end: cost build-up per incoterm -> currency conversion ->
 * margin -> rounding for display. Every intermediate amount is returned in
 * `PriceLineBreakdown` so the final price stays fully explainable.
 *
 * Throws `PricingError` if `input` fails validation - callers doing anything
 * user-facing should call `validatePriceLineInput` first and show blockers
 * instead of relying on this throwing.
 */
export function calculatePriceLine(input: PriceLineInput): PriceLineBreakdown {
  const issues = validatePriceLineInput(input);
  if (isBlocked(issues)) {
    throw new PricingError(issues[0].code, issues[0].message);
  }

  const displayDecimals = input.displayDecimals ?? 2;

  const freight =
    input.incoterm === "FOB"
      ? toMoney(0)
      : freightPerStemForUnit({
          rate: input.freightRatePerKg!,
          unit: input.freightRateUnit ?? "PER_KG",
          stemsPerBox: input.stemsPerBox,
          weightPerBoxKg: input.weightPerBoxKg ?? undefined,
        });

  // Additional costs (clearing/inspection/handling/import/...) are only
  // applied for DDP, matching the previous behaviour. Each is converted to a
  // per-stem amount and kept individually for a transparent breakdown.
  const additionalCosts: AdditionalCostResult[] =
    input.incoterm === "DDP"
      ? (input.additionalCosts ?? []).map((cost) => {
          const perStem = calcAdditionalCostPerStem(cost, input.stemsPerBox, input.weightPerBoxKg ?? undefined);
          return {
            name: cost.name,
            category: cost.category,
            amount: toMoney(cost.amount).toString(),
            unit: cost.unit,
            perStem: perStem.toString(),
          };
        })
      : [];

  const sumBy = (predicate: (c: AdditionalCostResult) => boolean) =>
    additionalCosts.filter(predicate).reduce((acc, c) => acc.plus(c.perStem), new Decimal(0));

  const clearingAndInspection = sumBy((c) => CLEARING_INSPECTION.includes(c.category));
  const handling = sumBy((c) => c.category === "HANDLING");
  const other = sumBy((c) => !CLEARING_INSPECTION.includes(c.category) && c.category !== "HANDLING");
  const additionalCostTotal = clearingAndInspection.plus(handling).plus(other);

  const totalCostPriceSource = costPricePerStemForIncoterm({
    incoterm: input.incoterm,
    fobPricePerStem: input.fobPricePerStem,
    freightPerStemValue: freight,
    totalAdditionalCostPerStem: additionalCostTotal,
  });

  const exchangeRateUsed =
    input.sourceCurrency === input.targetCurrency ? null : toMoney(input.exchangeRate!.rate);

  const costPriceTarget = convertCurrency(
    totalCostPriceSource,
    input.sourceCurrency,
    input.targetCurrency,
    input.exchangeRate ?? null,
  );

  const marginPercent = toMoney(input.marginPercent);
  const calculatedSellPrice = applyMargin(costPriceTarget, marginPercent);
  const calculatedSellPriceRounded = roundTo(calculatedSellPrice, displayDecimals);

  const manualSellPrice =
    input.manualSellPricePerStem !== undefined && input.manualSellPricePerStem !== null
      ? toMoney(input.manualSellPricePerStem)
      : null;
  const isManualOverride = manualSellPrice !== null;

  return {
    incoterm: input.incoterm,
    fobPricePerStem: toMoney(input.fobPricePerStem),
    freightPerStem: freight,
    clearingAndInspectionPerStem: clearingAndInspection,
    handlingPerStem: handling,
    otherAdditionalCostPerStem: other,
    additionalCostPerStem: additionalCostTotal,
    additionalCosts,
    totalCostPricePerStemSource: totalCostPriceSource,
    sourceCurrency: input.sourceCurrency,
    targetCurrency: input.targetCurrency,
    exchangeRateUsed,
    costPricePerStemTarget: costPriceTarget,
    marginPercent,
    calculatedSellPricePerStem: calculatedSellPrice,
    calculatedSellPricePerStemRounded: calculatedSellPriceRounded,
    manualSellPricePerStem: manualSellPrice,
    isManualOverride,
    finalSellPricePerStemRounded: isManualOverride
      ? roundTo(manualSellPrice!, displayDecimals)
      : calculatedSellPriceRounded,
  };
}
