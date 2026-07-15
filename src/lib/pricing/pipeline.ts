import { toMoney, roundTo } from "./decimal";
import {
  applyMargin,
  convertCurrency,
  costPricePerStemForIncoterm,
  freightPerStemForUnit,
  handlingPerStem as calcHandlingPerStem,
} from "./calculations";
import { isBlocked, validatePriceLineInput } from "./validation";
import { PricingError } from "./errors";
import type { PriceLineBreakdown, PriceLineInput } from "./types";

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

  const handling =
    input.incoterm === "DDP"
      ? calcHandlingPerStem(input.ddp!.handlingPerBox!, input.stemsPerBox)
      : toMoney(0);

  const clearingAndInspection =
    input.incoterm === "DDP" ? toMoney(input.ddp!.clearingAndInspectionPerStem!) : toMoney(0);

  const totalCostPriceSource = costPricePerStemForIncoterm({
    incoterm: input.incoterm,
    fobPricePerStem: input.fobPricePerStem,
    freightPerStemValue: freight,
    clearingAndInspectionPerStem: clearingAndInspection,
    handlingPerStemValue: handling,
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
