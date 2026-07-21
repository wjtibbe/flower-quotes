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
  exchangeRateIsManual: boolean; // true when a per-quote override rate was used
  exchangeRateDefault: string | null; // the standard rate that would have applied (for transparency)
}

/**
 * Resolves everything the pricing engine needs for one (farm offer line,
 * customer) pair from the database: route, freight rate, DDP cost
 * rates, and an exchange rate snapshot if currency conversion is
 * required. Returns whatever it could find - missing pieces simply come back
 * null and surface as validation blockers, never as thrown errors, so the
 * review UI can show exactly what's missing.
 *
 * `destinationIdOverride` lets a specific quote use a different destination
 * than the customer's stored default (spec: the user may change the
 * destination for this particular quote); it falls back to
 * `customer.destinationId` when omitted.
 *
 * `exchangeRateOverride` lets a specific quote override the standard exchange
 * rate (spec D): when provided and a conversion is actually needed, it is used
 * as "1 line.currency = override customer.defaultCurrency"; the standard rate
 * is still resolved and returned as `exchangeRateDefault` for transparency.
 */
export async function resolvePricingContext(
  line: FarmOfferLine,
  customer: Customer,
  incoterm: Incoterm,
  destinationIdOverride?: string | null,
  exchangeRateOverride?: string | null,
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
    // air route when there is one, otherwise the first alternative.
    const routes = await prisma.route.findMany({
      where: { originId, destinationId },
      orderBy: { createdAt: "asc" },
    });
    const route = routes.find((r) => r.transportType === "AIR") ?? routes[0];
    if (route) {
      routeId = route.id;
      if (incoterm === "CFR" && !route.supportsCfr) routeSupportsIncoterm = false;
      if (incoterm === "DDP" && !route.supportsDdp) routeSupportsIncoterm = false;

      if (incoterm === "CFR" || incoterm === "DDP") {
        // The applicable rate: already effective, not yet expired;
        // the most recently effective one wins. A future-dated rate is not
        // used until its effectiveFrom passes.
        const now = new Date();
        const rate = await prisma.freightRate.findFirst({
          where: {
            routeId: route.id,
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
  let exchangeRateIsManual = false;
  let exchangeRateDefault: string | null = null;
  if (line.currency !== customer.defaultCurrency) {
    // Always resolve the standard rate too, so we can show/store what the
    // default would have been even when the user overrides it.
    const standard = await findExchangeRate(line.currency, customer.defaultCurrency);
    if (standard) {
      exchangeRateDefault = normalizedRateForPair(standard, line.currency, customer.defaultCurrency);
    }

    const override = exchangeRateOverride?.trim();
    if (override && Number(override) > 0) {
      exchangeRate = { baseCurrency: line.currency, quoteCurrency: customer.defaultCurrency, rate: override };
      exchangeRateIsManual = true;
    } else if (standard) {
      exchangeRate = {
        baseCurrency: standard.baseCurrency,
        quoteCurrency: standard.quoteCurrency,
        rate: standard.rate.toString(),
      };
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
    exchangeRateIsManual,
    exchangeRateDefault,
  };
}

/**
 * Resolves the route's additional costs that are valid right now. Cost lines
 * are grouped by (category, name); within each group the currently-valid,
 * newest-effectiveFrom row wins - so multiple costs coexist, a future-dated
 * row supersedes automatically, and deleting a row drops it. A legacy row
 * without category/rateUnit (only costType) is skipped by the new UI path but
 * still resolvable via its backfilled fields.
 */
async function resolveAdditionalCosts(routeId: string): Promise<AdditionalCostInput[]> {
  const now = new Date();
  const rows = await prisma.ddpCostRate.findMany({
    where: {
      routeId,
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

/**
 * The exchange rate to use right now for the {from,to} pair, in either stored
 * direction. Same "currently valid" rule as freight/additional costs:
 * already effective, not yet expired, newest effectiveFrom wins - so a
 * future-dated rate isn't used early and a closed one drops out. There is
 * one rate per pair (add replaces it).
 */
async function findExchangeRate(from: CurrencyCode, to: CurrencyCode) {
  const now = new Date();
  return prisma.exchangeRate.findFirst({
    where: {
      effectiveFrom: { lte: now },
      OR: [
        { effectiveTo: null, baseCurrency: from, quoteCurrency: to },
        { effectiveTo: null, baseCurrency: to, quoteCurrency: from },
        { effectiveTo: { gte: now }, baseCurrency: from, quoteCurrency: to },
        { effectiveTo: { gte: now }, baseCurrency: to, quoteCurrency: from },
      ],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

/**
 * Expresses a stored rate as "1 from = X to", inverting when the row is stored
 * in the opposite direction, so the default rate we surface for a pair is
 * always comparable to a user-entered override for the same pair.
 */
function normalizedRateForPair(
  rate: { baseCurrency: CurrencyCode; quoteCurrency: CurrencyCode; rate: { toString(): string } },
  from: CurrencyCode,
  to: CurrencyCode,
): string {
  const value = Number(rate.rate.toString());
  if (rate.baseCurrency === from && rate.quoteCurrency === to) return value.toString();
  if (rate.baseCurrency === to && rate.quoteCurrency === from && value !== 0) return (1 / value).toString();
  return value.toString();
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
  exchangeRateOverride?: string | null,
): Promise<LinePricingResult> {
  const context = await resolvePricingContext(line, customer, incoterm, destinationIdOverride, exchangeRateOverride);

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
