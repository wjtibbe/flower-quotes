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
    if (input.weightPerBoxKg === undefined || input.weightPerBoxKg === null) {
      issues.push({ code: "MISSING_WEIGHT", message: "Gewicht per doos ontbreekt" });
    } else if (new Decimal(input.weightPerBoxKg).isNegative()) {
      issues.push({ code: "NEGATIVE_WEIGHT", message: "Gewicht per doos is negatief" });
    }

    if (input.freightRatePerKg === undefined || input.freightRatePerKg === null) {
      issues.push({ code: "MISSING_FREIGHT_RATE", message: "Vrachttarief ontbreekt" });
    } else if (new Decimal(input.freightRatePerKg).isNegative()) {
      issues.push({ code: "NEGATIVE_PRICE", message: "Vrachttarief is negatief" });
    }
  }

  if (input.incoterm === "DDP") {
    if (
      input.ddp?.clearingAndInspectionPerStem === undefined ||
      input.ddp?.clearingAndInspectionPerStem === null
    ) {
      issues.push({
        code: "MISSING_DDP_CLEARING_INSPECTION",
        message: "Clearing & inspection per steel ontbreekt",
      });
    }
    if (input.ddp?.handlingPerBox === undefined || input.ddp?.handlingPerBox === null) {
      issues.push({ code: "MISSING_DDP_HANDLING", message: "Handling per doos ontbreekt" });
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
