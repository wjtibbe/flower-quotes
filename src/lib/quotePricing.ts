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
import { BASE_CURRENCY, displayRate } from "@/lib/exchangeRate";
import type { FarmOfferLine, Customer, FreightRateUnit } from "@prisma/client";
import { defaultDepartureLocationForCountry } from "@/lib/quotes/defaultDeparture";

export interface ResolvedPricingContext {
  originId: string | null;
  originLabel: string | null; // e.g. "Bogotá" - for diagnostics/messages only, never business logic
  destinationId: string | null;
  destinationLabel: string | null; // e.g. "Amsterdam"
  // Set only when NO departure location could be resolved at all - no
  // per-line override, no Farm.originId, and the Farm's country doesn't map
  // to a currently supported default departure (Ecuador/Colombia) - already
  // a complete, human-readable reason, so callers don't need to re-derive it
  // from the farm's name/country themselves.
  originUnresolvedReason: string | null;
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
  let originUnresolvedReason: string | null = null;
  if (!originId) {
    const offer = await prisma.farmOffer.findUnique({
      where: { id: line.farmOfferId },
      select: { farm: { select: { name: true, originId: true, country: true } } },
    });
    originId = offer?.farm?.originId ?? null;

    if (!originId) {
      // No explicit origin on the Farm either - fall back to the interim
      // country -> default departure rule (Ecuador -> Quito, Colombia ->
      // Bogotá; see defaultDeparture.ts, the single central place this
      // mapping lives). Resolves an EXISTING Origin row only - never
      // creates one - so a route search still filters by a real Origin id,
      // not a guess.
      const farmName = offer?.farm?.name ?? null;
      const farmCountry = offer?.farm?.country ?? null;
      const defaultDeparture = defaultDepartureLocationForCountry(farmCountry);
      if (defaultDeparture) {
        const origin = await prisma.origin.findFirst({
          where: {
            city: { equals: defaultDeparture.city, mode: "insensitive" },
            country: { equals: defaultDeparture.country, mode: "insensitive" },
          },
          select: { id: true },
        });
        originId = origin?.id ?? null;
      }

      if (!originId) {
        originUnresolvedReason = farmCountry
          ? `Geen standaard vertreklocatie ingesteld voor leverancier ${farmName ?? "onbekend"} uit ${farmCountry}`
          : `Geen standaard vertreklocatie ingesteld voor leverancier ${farmName ?? "onbekend"}`;
      }
    }
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
        // One current tariff per route (business rule: no validity periods/
        // history) - routeId is @unique on FreightRate, so this is always
        // either the route's one tariff or nothing at all.
        const rate = await prisma.freightRate.findUnique({ where: { routeId: route.id } });
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
    // default would have been even when the user overrides it. Exactly one of
    // line.currency/customer.defaultCurrency is EUR here (both are drawn from
    // the 2-currency Currency enum and they differ), so this is the currency
    // the EUR-based rate is stored against.
    const nonEurCurrency = line.currency === BASE_CURRENCY ? customer.defaultCurrency : line.currency;
    const standard = await findEurRate(nonEurCurrency);
    if (standard) {
      exchangeRateDefault = displayRate([standard], line.currency, customer.defaultCurrency);
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
    originUnresolvedReason,
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
 * Resolves the route's current additional costs: one row per
 * additionalCostType (business rule: no validity periods/history -
 * `@@unique([routeId, additionalCostTypeId])` enforces this at the database
 * level, so every row returned here already IS the route's current value for
 * that type). A legacy row without category/rateUnit (only costType), or
 * without a linked additionalCostType at all, is skipped - never resolvable,
 * matching prior behavior.
 */
async function resolveAdditionalCosts(routeId: string): Promise<AdditionalCostInput[]> {
  const rows = await prisma.ddpCostRate.findMany({
    where: { routeId, additionalCostTypeId: { not: null } },
  });

  return rows
    .filter((r) => r.category && r.rateUnit)
    .map((r) => ({
      name: r.name ?? r.category!,
      category: r.category as CostCategory,
      amount: r.amount.toString(),
      unit: r.rateUnit as CostRateUnit,
    }));
}

/**
 * The current EUR-based rate for one non-EUR currency ("1 EUR = X currency").
 * EUR is the only allowed base for manually maintained rates (see
 * exchange-rates/actions.ts) - only baseCurrency = EUR rows are ever
 * queried, so a legacy reversed row can never become the source of truth
 * here even if it still exists. Same "currently valid" rule as
 * freight/additional costs: already effective, not yet expired, newest
 * effectiveFrom wins - so a future-dated rate isn't used early and a closed
 * one drops out. There is one rate per target currency (add replaces it).
 */
async function findEurRate(currency: CurrencyCode) {
  const now = new Date();
  return prisma.exchangeRate.findFirst({
    where: {
      baseCurrency: BASE_CURRENCY,
      quoteCurrency: currency,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
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
  if (context.originUnresolvedReason) {
    const routeIssues = issues.filter((i) => ROUTE_AWARE_CODES.has(i.code));
    if (routeIssues.length > 0) {
      const rest = issues.filter((i) => !ROUTE_AWARE_CODES.has(i.code));
      return [...rest, { code: "ORIGIN_NOT_CONFIGURED", message: context.originUnresolvedReason }];
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
