import "server-only";
import { prisma } from "@/lib/db";
import {
  calculatePriceLine,
  validatePriceLineInput,
  type CurrencyCode,
  type ExchangeRateSnapshot,
  type Incoterm,
  type PriceLineBreakdown,
  type ValidationIssue,
} from "@/lib/pricing";
import type { FarmOfferLine, Customer, DdpCostType } from "@prisma/client";

export interface ResolvedPricingContext {
  originId: string | null;
  destinationId: string | null;
  routeId: string | null;
  freightRatePerKg: string | null;
  freightRateUpdatedAt: Date | null;
  ddp: { clearingPerStem: string | null; inspectionPerStem: string | null; handlingPerBox: string | null };
  exchangeRate: ExchangeRateSnapshot | null;
}

/**
 * Resolves everything the pricing engine needs for one (farm offer line,
 * customer) pair from the database: route, active freight rate, active DDP
 * cost rates, and an active exchange rate snapshot if currency conversion is
 * required. Returns whatever it could find - missing pieces simply come back
 * null and surface as validation blockers, never as thrown errors, so the
 * review UI can show exactly what's missing.
 */
export async function resolvePricingContext(
  line: FarmOfferLine,
  customer: Customer,
  incoterm: Incoterm,
): Promise<ResolvedPricingContext> {
  const originId = line.originId;
  const destinationId = customer.destinationId;

  let routeId: string | null = null;
  let freightRatePerKg: string | null = null;
  let freightRateUpdatedAt: Date | null = null;
  const ddp: ResolvedPricingContext["ddp"] = {
    clearingPerStem: null,
    inspectionPerStem: null,
    handlingPerBox: null,
  };

  if (originId && destinationId) {
    const route = await prisma.route.findUnique({ where: { originId_destinationId: { originId, destinationId } } });
    if (route) {
      routeId = route.id;

      if (incoterm === "CFR" || incoterm === "DDP") {
        const rate = await prisma.freightRate.findFirst({
          where: { routeId: route.id, active: true },
          orderBy: { effectiveFrom: "desc" },
        });
        if (rate) {
          freightRatePerKg = rate.ratePerKg.toString();
          freightRateUpdatedAt = rate.updatedAt;
        }
      }

      if (incoterm === "DDP") {
        const rates = await prisma.ddpCostRate.findMany({ where: { routeId: route.id, active: true } });
        for (const r of rates) {
          if (r.costType === ("CLEARING_PER_STEM" as DdpCostType)) ddp.clearingPerStem = r.amount.toString();
          if (r.costType === ("INSPECTION_PER_STEM" as DdpCostType)) ddp.inspectionPerStem = r.amount.toString();
          if (r.costType === ("HANDLING_PER_BOX" as DdpCostType)) ddp.handlingPerBox = r.amount.toString();
        }
      }
    }
  }

  let exchangeRate: ExchangeRateSnapshot | null = null;
  if (line.currency !== customer.defaultCurrency) {
    const rate = await findExchangeRate(line.currency, customer.defaultCurrency);
    if (rate) {
      exchangeRate = { baseCurrency: rate.baseCurrency, quoteCurrency: rate.quoteCurrency, rate: rate.rate.toString() };
    }
  }

  return { originId, destinationId, routeId, freightRatePerKg, freightRateUpdatedAt, ddp, exchangeRate };
}

async function findExchangeRate(from: CurrencyCode, to: CurrencyCode) {
  return prisma.exchangeRate.findFirst({
    where: {
      active: true,
      OR: [
        { baseCurrency: from, quoteCurrency: to },
        { baseCurrency: to, quoteCurrency: from },
      ],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

export interface LinePricingResult {
  issues: ValidationIssue[];
  breakdown: PriceLineBreakdown | null;
  context: ResolvedPricingContext;
}

export async function priceLineForCustomer(
  line: FarmOfferLine,
  customer: Customer,
  incoterm: Incoterm,
  targetCurrency: CurrencyCode,
  marginPercent: string,
): Promise<LinePricingResult> {
  const context = await resolvePricingContext(line, customer, incoterm);

  const input = {
    incoterm,
    fobPricePerStem: line.fobPricePerStem?.toString() ?? undefined,
    sourceCurrency: line.currency,
    targetCurrency,
    stemsPerBox: line.stemsPerBox ?? undefined,
    marginPercent,
    weightPerBoxKg: line.weightPerBoxKg?.toString() ?? undefined,
    freightRatePerKg: context.freightRatePerKg ?? undefined,
    ddp: {
      clearingPerStem: context.ddp.clearingPerStem ?? undefined,
      inspectionPerStem: context.ddp.inspectionPerStem ?? undefined,
      handlingPerBox: context.ddp.handlingPerBox ?? undefined,
    },
    exchangeRate: context.exchangeRate ?? undefined,
  } as Parameters<typeof calculatePriceLine>[0];

  const issues = validatePriceLineInput(input);
  if (issues.length > 0) {
    return { issues, breakdown: null, context };
  }

  return { issues: [], breakdown: calculatePriceLine(input), context };
}
