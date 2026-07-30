import type { CostCategory, CostRateUnit } from "@prisma/client";

/**
 * Small shared pieces for the centrally managed "Aanvullende kostensoorten"
 * vocabulary (AdditionalCostType) - kept in one place so Settings, Routes &
 * Freight, and any future display of a route additional cost all agree on
 * how a name is normalized for uniqueness and how it's displayed.
 */

/** Dutch labels for CostCategory - the single place this terminology lives (used by both Settings and Routes & Freight). */
export const COST_CATEGORY_LABELS: Record<CostCategory, string> = {
  CLEARING: "Clearing",
  INSPECTION: "Inspection",
  IMPORT: "Import",
  HANDLING: "Handling",
  LOCAL_DELIVERY: "Lokale bezorging",
  DOCUMENTATION: "Documentatie",
  OTHER: "Overige",
};

/** Dutch labels for CostRateUnit - shared by Settings' "Standaardeenheid" field and Routes & Freight's per-cost unit selector. */
export const COST_RATE_UNIT_LABELS: Record<CostRateUnit, string> = {
  PER_KG: "per kg",
  PER_BOX: "per doos",
  PER_STEM: "per steel",
  FLAT: "vast bedrag",
};

/** Case/whitespace-insensitive key used for uniqueness - must match the migration's `lower(trim(name))`. */
export function normalizeCostTypeName(name: string): string {
  return name.trim().toLowerCase();
}

/** The types the Routes & Freight "Kostensoort" add-dropdown offers - inactive types are configured but retired. */
export function filterActiveCostTypes<T extends { isActive: boolean }>(types: T[]): T[] {
  return types.filter((t) => t.isActive);
}

/**
 * The name to show for one route additional cost. Prefers the LIVE
 * canonical type's current name (so a rename in Settings is reflected
 * everywhere the active route configuration is shown), falling back to the
 * row's own snapshot `name` for historical/unlinked rows - in particular a
 * `QuoteLine.additionalCostsSnapshot` entry, which is a frozen JSON blob
 * with no live relation, so a later rename/deactivation of the type can
 * never change how an already-created quote reads.
 */
export function displayAdditionalCostName(cost: {
  name?: string | null;
  additionalCostType?: { name: string } | null;
}): string {
  return cost.additionalCostType?.name ?? cost.name ?? "Onbekend";
}

/** Raw (string) form input for adding/editing one route additional cost. */
export interface RouteCostFormInput {
  additionalCostTypeId: string | null;
  amount: string | null;
  currency: string | null;
  rateUnit: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/**
 * Validates a route additional cost's add/edit form input. Pure and
 * database-independent (the caller is responsible for confirming the
 * `additionalCostTypeId` actually resolves to a real, active-or-not type) -
 * shared by both `addRouteCost` and `updateRouteCost` so the two forms can
 * never drift into inconsistent rules. Returns a Dutch error message, or
 * null when the input is valid.
 */
export function validateRouteCostInput(input: RouteCostFormInput): string | null {
  if (!input.additionalCostTypeId) return "Kostensoort is verplicht";
  if (!input.amount || !Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) {
    return "Bedrag moet positief zijn";
  }
  if (!input.currency) return "Valuta is verplicht";
  if (!input.rateUnit) return "Eenheid is verplicht";
  if (input.effectiveFrom && input.effectiveTo && new Date(input.effectiveTo) < new Date(input.effectiveFrom)) {
    return "Geldig tot kan niet vóór geldig vanaf liggen";
  }
  return null;
}
