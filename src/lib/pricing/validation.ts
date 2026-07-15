import Decimal from "decimal.js";
import type { PriceLineInput, ValidationIssue } from "./types";

/**
 * Hard blockers per section 19 of the spec. These must all be empty before a
 * quote line can move from "concept" to a final, generated quote.
 */
export function validatePriceLineInput(input: PriceLineInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (input.fobPricePerStem === undefined || input.fobPricePerStem === null) {
    issues.push({ code: "MISSING_FOB_PRICE", message: "FOB-prijs per steel ontbreekt" });
  } else if (new Decimal(input.fobPricePerStem).isNegative()) {
    issues.push({ code: "NEGATIVE_PRICE", message: "FOB-prijs per steel is negatief" });
  }

  if (input.stemsPerBox === undefined || input.stemsPerBox === null) {
    issues.push({ code: "MISSING_STEMS_PER_BOX", message: "Aantal stelen per doos ontbreekt" });
  } else if (input.stemsPerBox === 0) {
    issues.push({ code: "ZERO_STEMS_PER_BOX", message: "Aantal stelen per doos is nul" });
  } else if (input.stemsPerBox < 0) {
    issues.push({ code: "NEGATIVE_PRICE", message: "Aantal stelen per doos is negatief" });
  }

  if (input.incoterm === "CFR" || input.incoterm === "DDP") {
    // Box weight is only needed to convert a per-kg rate to freight per stem;
    // per-box and per-stem rates don't use it.
    const rateUnit = input.freightRateUnit ?? "PER_KG";
    if (rateUnit === "PER_KG" && (input.weightPerBoxKg === undefined || input.weightPerBoxKg === null)) {
      issues.push({ code: "MISSING_WEIGHT", message: "Gewicht per doos ontbreekt" });
    } else if (
      input.weightPerBoxKg !== undefined &&
      input.weightPerBoxKg !== null &&
      new Decimal(input.weightPerBoxKg).isNegative()
    ) {
      issues.push({ code: "NEGATIVE_WEIGHT", message: "Gewicht per doos is negatief" });
    }

    if (input.freightRatePerKg === undefined || input.freightRatePerKg === null) {
      issues.push({ code: "MISSING_FREIGHT_RATE", message: "Vrachttarief ontbreekt" });
    } else if (new Decimal(input.freightRatePerKg).isNegative()) {
      issues.push({ code: "NEGATIVE_PRICE", message: "Vrachttarief is negatief" });
    }
  }

  if (input.incoterm === "DDP") {
    const costs = input.additionalCosts ?? [];
    const hasCategory = (cats: string[]) => costs.some((c) => cats.includes(c.category));
    // Preserve the prior hard blockers: DDP needs at least a clearing/inspection
    // cost and a handling cost configured on the route.
    if (!hasCategory(["CLEARING", "INSPECTION"])) {
      issues.push({
        code: "MISSING_DDP_CLEARING_INSPECTION",
        message: "Clearing/inspection-kosten ontbreken op de route",
      });
    }
    if (!hasCategory(["HANDLING"])) {
      issues.push({ code: "MISSING_DDP_HANDLING", message: "Handling-kosten ontbreken op de route" });
    }
    for (const c of costs) {
      if (new Decimal(c.amount).isNegative()) {
        issues.push({ code: "NEGATIVE_PRICE", message: `Kosten "${c.name}" zijn negatief` });
      }
    }
  }

  if (!input.targetCurrency) {
    issues.push({ code: "MISSING_CUSTOMER_CURRENCY", message: "Klantvaluta ontbreekt" });
  }

  if (input.sourceCurrency !== input.targetCurrency && !input.exchangeRate) {
    issues.push({
      code: "MISSING_EXCHANGE_RATE",
      message: `Wisselkoers ${input.sourceCurrency} -> ${input.targetCurrency} ontbreekt`,
    });
  }

  if (input.marginPercent === undefined || input.marginPercent === null) {
    issues.push({ code: "MISSING_MARGIN", message: "Margepercentage ontbreekt" });
  }

  return issues;
}

export function isBlocked(issues: ValidationIssue[]): boolean {
  return issues.length > 0;
}
