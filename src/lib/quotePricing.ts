import "server-only";
import { prisma } from "@/lib/db";
import {
  calculatePriceLine,
  validatePriceLineInput,
  type AdditionalCostInput,
  type CostCategory,
  type CostRateUnit,
  type CurrencyCode,
  type ExchangeRateSnapshot,
  type Incoterm,
  type PriceLineBreakdown,
  type ValidationIssue,
} from "@/lib/pricing";
import type { FarmOfferLine, Customer, FreightRateUnit } from "@prisma/client";

export interface ResolvedPricingContext {
  originId: string | null;
  destinationId: string | null;
  routeId: string | null;
  routeSupportsIncoterm: boolean; // false if the route exists but doesn't offer this incoterm
  freightRatePerKg: string | null; // rate amount (legacy name; unit below)
  freightRateUnit: FreightRateUnit | null;
  freightRateUpdatedAt: Date | null;
  additionalCosts: AdditionalCostInput[]; // route additional costs, valid now
  exchangeRate: ExchangeRateSnapshot | null;
}

/**
 * Resolves everything the pricing engine needs for one (farm offer line,
 * customer) pair from the database: route, active freight rate, active DDP
 * cost rates, and an active exchange rate snapshot if currency conversion is
 * required. Returns whatever it could find - missing pieces simply come back
 * null and surface as validation blockers, never as thrown errors, so the
 * review UI can show exactly what's missing.
 *
 * `destinationIdOverride` lets a specific quote use a different destination
 * than the customer's stored default (spec: the user may change the
 * destination for this particular quote); it falls back to
 * `customer.destinationId` when omitted.
 */
export async function resolvePricingContext(
  line: FarmOfferLine,
  customer: Customer,
  incoterm: Incoterm,
  destinationIdOverride?: string | null,
): Promise<ResolvedPricingContext> {
  // Compatibility fallback: parsed lines usually have no explicit originId -
  // fall back to the supplier's configured origin, so uploaded offers can be
  // priced C&F/DDP without manually setting an origin per line.
  let originId = line.originId;
  if (!originId) {
    const offer = await prisma.farmOffer.findUnique({
      where: { id: line.farmOfferId },
      select: { farm: { select: { originId: true } } },
    });
    originId = offer?.farm?.originId ?? null;
  }
  const destinationId = destinationIdOverride !== undefined ? destinationIdOverride : customer.destinationId;

  let routeId: string | null = null;
  let routeSupportsIncoterm = true;
  let freightRatePerKg: string | null = null;
  let freightRateUnit: FreightRateUnit | null = null;
  let freightRateUpdatedAt: Date | null = null;
  let additionalCosts: AdditionalCostInput[] = [];

  if (originId && destinationId) {
    // A route may exist per transport type; flower freight is priced on the
    // air route when there is one, otherwise the first active alternative.
    const routes = await prisma.route.findMany({
      where: { originId, destinationId, active: true },
      orderBy: { createdAt: "asc" },
    });
    const route = routes.find((r) => r.transportType === "AIR") ?? routes[0];
    if (route) {
      routeId = route.id;
      if (incoterm === "CFR" && !route.supportsCfr) routeSupportsIncoterm = false;
      if (incoterm === "DDP" && !route.supportsDdp) routeSupportsIncoterm = false;

      if (incoterm === "CFR" || incoterm === "DDP") {
        // The applicable rate: active, already effective, not yet expired;
        // the most recently effective one wins. A future-dated rate is not
        // used until its effectiveFrom passes.
        const now = new Date();
        const rate = await prisma.freightRate.findFirst({
          where: {
            routeId: route.id,
            active: true,
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          },
          orderBy: { effectiveFrom: "desc" },
        });
        if (rate) {
          freightRatePerKg = rate.ratePerKg.toString();
          freightRateUnit = rate.rateUnit;
          freightRateUpdatedAt = rate.updatedAt;
        }
      }

      if (incoterm === "DDP") {
        additionalCosts = await resolveAdditionalCosts(route.id);
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

  return {
    originId,
    destinationId,
    routeId,
    routeSupportsIncoterm,
    freightRatePerKg,
    freightRateUnit,
    freightRateUpdatedAt,
    additionalCosts,
    exchangeRate,
  };
}

/**
 * Resolves the route's additional costs that are valid right now. Cost lines
 * are grouped by (category, name); within each group the currently-valid,
 * newest-effectiveFrom active row wins - so multiple costs coexist, a
 * future-dated row supersedes automatically, and deactivating a row drops it.
 * A legacy row without category/rateUnit (only costType) is skipped by the
 * new UI path but still resolvable via its backfilled fields.
 */
async function resolveAdditionalCosts(routeId: string): Promise<AdditionalCostInput[]> {
  const now = new Date();
  const rows = await prisma.ddpCostRate.findMany({
    where: {
      routeId,
      active: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });

  const chosen = new Map<string, AdditionalCostInput>();
  for (const r of rows) {
    if (!r.category || !r.rateUnit) continue; // needs the generalized fields
    const key = `${r.category}::${(r.name ?? "").toLowerCase()}`;
    if (chosen.has(key)) continue; // newest effectiveFrom already taken
    chosen.set(key, {
      name: r.name ?? r.category,
      category: r.category as CostCategory,
      amount: r.amount.toString(),
      unit: r.rateUnit as CostRateUnit,
    });
  }
  return [...chosen.values()];
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
  destinationIdOverride?: string | null,
): Promise<LinePricingResult> {
  const context = await resolvePricingContext(line, customer, incoterm, destinationIdOverride);

  if (!context.routeSupportsIncoterm) {
    return {
      issues: [
        {
          code: "INCOTERM_NOT_SUPPORTED_ON_ROUTE",
          message: `${incoterm} wordt niet aangeboden op deze route`,
        },
      ],
      breakdown: null,
      context,
    };
  }

  const input = {
    incoterm,
    fobPricePerStem: line.fobPricePerStem?.toString() ?? undefined,
    sourceCurrency: line.currency,
    targetCurrency,
    stemsPerBox: line.stemsPerBox ?? undefined,
    marginPercent,
    weightPerBoxKg: line.weightPerBoxKg?.toString() ?? undefined,
    freightRatePerKg: context.freightRatePerKg ?? undefined,
    freightRateUnit: context.freightRateUnit ?? undefined,
    additionalCosts: context.additionalCosts,
    exchangeRate: context.exchangeRate ?? undefined,
  } as Parameters<typeof calculatePriceLine>[0];

  const issues = validatePriceLineInput(input);
  if (issues.length > 0) {
    return { issues, breakdown: null, context };
  }

  return { issues: [], breakdown: calculatePriceLine(input), context };
}
