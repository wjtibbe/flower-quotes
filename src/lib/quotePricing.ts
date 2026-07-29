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
  originLabel: string | null; // e.g. "Bogotá" - for diagnostics/messages only, never business logic
  destinationId: string | null;
  destinationLabel: string | null; // e.g. "Amsterdam"
  // The farm's own name, only when its origin could not be resolved at all
  // (originId stayed null) - lets a message point at the real fix ("this
  // supplier has no departure location configured") instead of the generic
  // "no tariff found" blockers, which would otherwise all fire together.
  farmNameIfOriginMissing: string | null;
  routeId: string | null;
  routeSupportsIncoterm: boolean; // false if the route exists but doesn't offer this incoterm
  freightRatePerKg: string | null; // rate amount (legacy name; unit below)
  freightRateUnit: FreightRateUnit | null;
  freightRateUpdatedAt: Date | null;
  additionalCosts: AdditionalCostInput[]; // route additional costs, valid now
  exchangeRate: ExchangeRateSnapshot | null;
  exchangeRateIsManual: boolean; // true when a per-quote override rate was used
  exchangeRateDefault: string | null; // the standard rate that would have applied (for transparency)
  // The single "now" used for every effective-date check below (freight
  // rate, additional costs) - exposed so an error message can state exactly
  // which date found nothing active.
  pricingDate: Date;
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
  // Single "now" for every effective-date check in this call, so the freight
  // rate and the additional costs are evaluated as of the exact same instant
  // (and that instant can be stated precisely in an error message).
  const now = new Date();

  // Compatibility fallback: parsed lines usually have no explicit originId -
  // fall back to the supplier's configured origin, so uploaded offers can be
  // priced C&F/DDP without manually setting an origin per line.
  let originId = line.originId;
  let farmNameIfOriginMissing: string | null = null;
  if (!originId) {
    const offer = await prisma.farmOffer.findUnique({
      where: { id: line.farmOfferId },
      select: { farm: { select: { name: true, originId: true } } },
    });
    originId = offer?.farm?.originId ?? null;
    // Still null after the fallback: the supplier itself has no departure
    // location configured - this is what actually needs fixing, and it's
    // what makes freight AND every DDP cost look "missing" at once (route
    // resolution below never even runs), so it's worth naming explicitly.
    if (!originId) farmNameIfOriginMissing = offer?.farm?.name ?? null;
  }
  const originLabel = originId
    ? (await prisma.origin.findUnique({ where: { id: originId }, select: { city: true } }))?.city ?? null
    : null;

  const destinationId = destinationIdOverride !== undefined ? destinationIdOverride : customer.destinationId;
  const destinationLabel = destinationId
    ? (await prisma.destination.findUnique({ where: { id: destinationId }, select: { city: true } }))?.city ?? null
    : null;

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
        additionalCosts = await resolveAdditionalCosts(route.id, now);
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
    originLabel,
    destinationId,
    destinationLabel,
    farmNameIfOriginMissing,
    routeId,
    routeSupportsIncoterm,
    freightRatePerKg,
    freightRateUnit,
    freightRateUpdatedAt,
    additionalCosts,
    exchangeRate,
    exchangeRateIsManual,
    exchangeRateDefault,
    pricingDate: now,
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
async function resolveAdditionalCosts(routeId: string, now: Date): Promise<AdditionalCostInput[]> {
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

/**
 * The packaging values pricing actually calculates with. Callers must
 * resolve these via `resolveCanonicalPackaging` (a matched
 * PackagingWeightProfile takes priority over the line's own legacy
 * `stemsPerBox`/`weightPerBoxKg`) rather than letting this function read the
 * legacy `FarmOfferLine` columns directly - see the quote-pipeline
 * consistency fix this parameter was introduced for.
 */
export interface ResolvedLinePackaging {
  stemsPerBox: number | null;
  weightPerBoxKg: string | null;
}

export async function priceLineForCustomer(
  line: FarmOfferLine,
  customer: Customer,
  incoterm: Incoterm,
  targetCurrency: CurrencyCode,
  marginPercent: string,
  packaging: ResolvedLinePackaging,
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
    stemsPerBox: packaging.stemsPerBox ?? undefined,
    marginPercent,
    weightPerBoxKg: packaging.weightPerBoxKg ?? undefined,
    freightRatePerKg: context.freightRatePerKg ?? undefined,
    freightRateUnit: context.freightRateUnit ?? undefined,
    additionalCosts: context.additionalCosts,
    exchangeRate: context.exchangeRate ?? undefined,
  } as Parameters<typeof calculatePriceLine>[0];

  const issues = validatePriceLineInput(input);
  if (issues.length > 0) {
    return { issues: enrichRouteIssues(issues, context), breakdown: null, context };
  }

  return { issues: [], breakdown: calculatePriceLine(input), context };
}

/** Codes whose generic message becomes actionable once route context is known. */
const ROUTE_AWARE_CODES = new Set<ValidationIssue["code"]>([
  "MISSING_FREIGHT_RATE",
  "MISSING_DDP_CLEARING_INSPECTION",
  "MISSING_DDP_HANDLING",
]);

/** dd-mm-yyyy, zero-padded - locale-independent so the format never drifts with the server's ICU data. */
function formatPricingDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/**
 * Rewrites the generic freight/DDP blockers into messages that name the
 * actual route and date, instead of a bare "Vrachttarief ontbreekt" that
 * gives no clue whether the problem is the wrong route, an expired tariff,
 * or nothing configured at all (never a database id - see section 5 of the
 * route-pricing fix this was added for).
 *
 * When the supplier has no origin configured at all, `resolvePricingContext`
 * never even attempts a route lookup, so freight AND both DDP costs would
 * otherwise all report "missing" together with no indication why - that
 * specific, common case is collapsed into ONE issue that names the real,
 * fixable problem instead.
 */
function enrichRouteIssues(issues: ValidationIssue[], context: ResolvedPricingContext): ValidationIssue[] {
  if (context.farmNameIfOriginMissing) {
    const routeIssues = issues.filter((i) => ROUTE_AWARE_CODES.has(i.code));
    if (routeIssues.length > 0) {
      const rest = issues.filter((i) => !ROUTE_AWARE_CODES.has(i.code));
      return [
        ...rest,
        {
          code: "ORIGIN_NOT_CONFIGURED",
          message: `Vertreklocatie is niet ingesteld voor leverancier "${context.farmNameIfOriginMissing}"`,
        },
      ];
    }
  }

  const origin = context.originLabel ?? "onbekende herkomst";
  const destination = context.destinationLabel ?? "onbekende bestemming";
  const route = `${origin} → ${destination}`;
  const date = formatPricingDate(context.pricingDate);

  // No trailing period - callers (createQuotes) join these into one sentence
  // and append their own final period, matching the existing blocker-message
  // convention in validation.ts.
  return issues.map((issue) => {
    if (issue.code === "MISSING_FREIGHT_RATE") {
      return { ...issue, message: `Geen actief vrachttarief gevonden voor ${route} op ${date}` };
    }
    if (issue.code === "MISSING_DDP_CLEARING_INSPECTION") {
      return { ...issue, message: `Geen Clearing/Inspection-kosten gevonden voor ${route}` };
    }
    if (issue.code === "MISSING_DDP_HANDLING") {
      return { ...issue, message: `Geen Handling-kosten gevonden voor ${route}` };
    }
    return issue;
  });
}
