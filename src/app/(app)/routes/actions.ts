"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { CostRateUnit, FreightRateUnit, TransportType } from "@prisma/client";
import { validateRouteCostInput, validateFreightRateInput } from "@/lib/additionalCostTypes";

function norm(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/** Creates an origin location; case-insensitive duplicate check on city+country. */
export async function createOrigin(formData: FormData): Promise<void> {
  const city = norm(formData.get("city"));
  const country = norm(formData.get("country"));
  if (!city || !country) {
    redirect(`/routes?err=${encodeURIComponent("Stad en land zijn verplicht")}`);
    return;
  }

  const existing = await prisma.origin.findFirst({
    where: { city: { equals: city, mode: "insensitive" }, country: { equals: country, mode: "insensitive" } },
  });
  if (existing) redirect("/routes?msg=origin-exists");

  await prisma.origin.create({
    data: { city, country, locationName: norm(formData.get("locationName")), code: norm(formData.get("code"))?.toUpperCase() },
  });
  revalidatePath("/routes");
  redirect("/routes?msg=origin-created");
}

/** Creates a destination location; case-insensitive duplicate check on city+country. */
export async function createDestination(formData: FormData): Promise<void> {
  const city = norm(formData.get("city"));
  const country = norm(formData.get("country"));
  if (!city || !country) {
    redirect(`/routes?err=${encodeURIComponent("Stad en land zijn verplicht")}`);
    return;
  }

  const existing = await prisma.destination.findFirst({
    where: { city: { equals: city, mode: "insensitive" }, country: { equals: country, mode: "insensitive" } },
  });
  if (existing) redirect("/routes?msg=destination-exists");

  await prisma.destination.create({
    data: { city, country, locationName: norm(formData.get("locationName")), code: norm(formData.get("code"))?.toUpperCase() },
  });
  revalidatePath("/routes");
  redirect("/routes?msg=destination-created");
}

/** Creates a route (origin + destination + transport type); duplicate-safe. */
export async function createRoute(formData: FormData): Promise<void> {
  const originId = norm(formData.get("originId"));
  const destinationId = norm(formData.get("destinationId"));
  const transportType = (norm(formData.get("transportType")) ?? "AIR") as TransportType;
  if (!originId || !destinationId) {
    redirect(`/routes?err=${encodeURIComponent("Vertrekpunt en bestemming zijn verplicht")}`);
    return;
  }

  const existing = await prisma.route.findFirst({ where: { originId, destinationId, transportType } });
  if (existing) redirect("/routes?msg=route-exists");

  await prisma.route.create({ data: { originId, destinationId, transportType } });
  revalidatePath("/routes");
  redirect("/routes?msg=route-created");
}

/**
 * Saves a route's CURRENT freight tariff (business rule: no validity
 * periods/history - a route has exactly one freight tariff, editable at any
 * time). Upserts on `routeId` (which is `@unique` on FreightRate), so the
 * first save creates the route's one row and every save after that updates
 * it in place - there is never a second row, and there is nothing to pick
 * between at pricing time.
 */
export async function saveFreightRate(routeId: string, formData: FormData): Promise<void> {
  const amount = norm(formData.get("ratePerKg"));
  const currency = norm(formData.get("currency")) ?? "USD";
  const rateUnit = (norm(formData.get("rateUnit")) ?? "PER_KG") as FreightRateUnit;

  const validationError = validateFreightRateInput({ amount, currency, rateUnit });
  if (validationError) {
    redirect(`/routes?err=${encodeURIComponent(validationError)}`);
    return;
  }
  const validAmount = amount!;

  await prisma.freightRate.upsert({
    where: { routeId },
    update: { ratePerKg: validAmount, currency, rateUnit },
    create: { routeId, ratePerKg: validAmount, currency, rateUnit },
  });
  revalidatePath("/routes");
}

/**
 * Hard-deletes a route along with its freight tariff and additional costs
 * (they belong to the route). Safe: quotes snapshot origin/destination and
 * the rate/cost values, so history is unaffected.
 */
export async function deleteRoute(routeId: string): Promise<void> {
  await prisma.$transaction([
    prisma.freightRate.deleteMany({ where: { routeId } }),
    prisma.ddpCostRate.deleteMany({ where: { routeId } }),
    prisma.route.delete({ where: { id: routeId } }),
  ]);
  revalidatePath("/routes");
}

/** Toggles whether a route offers C&F, so quotes/pricing know not to offer it otherwise. */
export async function toggleRouteSupportsCfr(routeId: string, current: boolean): Promise<void> {
  await prisma.route.update({ where: { id: routeId }, data: { supportsCfr: !current } });
  revalidatePath("/routes");
}

/** Toggles whether a route offers DDP, so quotes/pricing know not to offer it otherwise. */
export async function toggleRouteSupportsDdp(routeId: string, current: boolean): Promise<void> {
  await prisma.route.update({ where: { id: routeId }, data: { supportsDdp: !current } });
  revalidatePath("/routes");
}

// --- Route additional costs (DDP clearing/inspection/handling/import/...) ---

/**
 * Adds a route's CURRENT additional cost for one configured
 * AdditionalCostType ("Kostensoort") - business rule: at most one row per
 * (route, cost type), editable at any time, no validity periods. The user
 * picks the type instead of typing a free-text name - the canonical
 * reference going forward; `name`/`category` are still stored on the row
 * too, but only as a snapshot taken from the type at creation time, so
 * display reads correctly even if the type is later renamed (see
 * displayAdditionalCostName). A route that already has a row for this type
 * is rejected with a clear message rather than silently creating a second
 * row or overwriting the existing one - the reviewer should use "Bewerken"
 * on the existing row instead (`updateRouteCost` below).
 */
export async function addRouteCost(routeId: string, formData: FormData): Promise<void> {
  const additionalCostTypeId = norm(formData.get("additionalCostTypeId"));
  const rateUnit = norm(formData.get("rateUnit")) as CostRateUnit | null;
  const amount = norm(formData.get("amount"));
  const currency = norm(formData.get("currency")) ?? "USD";

  const validationError = validateRouteCostInput({ additionalCostTypeId, amount, currency, rateUnit });
  if (validationError) {
    redirect(`/routes?err=${encodeURIComponent(validationError)}`);
    return;
  }
  // validateRouteCostInput already rejected a missing additionalCostTypeId/amount above.
  const validAdditionalCostTypeId = additionalCostTypeId!;
  const validAmount = amount!;

  const costType = await prisma.additionalCostType.findUnique({ where: { id: validAdditionalCostTypeId } });
  if (!costType) {
    redirect(`/routes?err=${encodeURIComponent("Onbekende kostensoort geselecteerd")}`);
    return;
  }

  const existing = await prisma.ddpCostRate.findUnique({
    where: { routeId_additionalCostTypeId: { routeId, additionalCostTypeId: validAdditionalCostTypeId } },
  });
  if (existing) {
    redirect(
      `/routes?err=${encodeURIComponent(`${costType.name} is al toegevoegd aan deze route - bewerk het bestaande bedrag in plaats daarvan.`)}`,
    );
    return;
  }

  await prisma.ddpCostRate.create({
    data: {
      routeId,
      additionalCostTypeId: validAdditionalCostTypeId,
      name: costType.name,
      category: costType.category,
      rateUnit,
      amount: validAmount,
      currency,
    },
  });
  revalidatePath("/routes");
}

/**
 * Edits an existing route additional cost in place: cost type, amount,
 * currency and unit. Same validation rules as `addRouteCost` (shared via
 * `validateRouteCostInput`) so add and edit can never drift. `name`/
 * `category` are re-snapshotted from the (possibly newly chosen) type,
 * matching what a fresh `addRouteCost` would store. Changing the cost type
 * to one this route already has a (different) row for is rejected the same
 * way `addRouteCost` rejects a fresh duplicate - never silently overwrites
 * the other row or creates a second one for that type.
 */
export async function updateRouteCost(id: string, formData: FormData): Promise<void> {
  const additionalCostTypeId = norm(formData.get("additionalCostTypeId"));
  const rateUnit = norm(formData.get("rateUnit")) as CostRateUnit | null;
  const amount = norm(formData.get("amount"));
  const currency = norm(formData.get("currency")) ?? "USD";

  const validationError = validateRouteCostInput({ additionalCostTypeId, amount, currency, rateUnit });
  if (validationError) {
    redirect(`/routes?err=${encodeURIComponent(validationError)}`);
    return;
  }
  // validateRouteCostInput already rejected a missing additionalCostTypeId/amount above.
  const validAdditionalCostTypeId = additionalCostTypeId!;
  const validAmount = amount!;

  const existingRow = await prisma.ddpCostRate.findUnique({ where: { id } });
  if (!existingRow) {
    redirect(`/routes?err=${encodeURIComponent("Deze aanvullende kost bestaat niet meer.")}`);
    return;
  }

  const costType = await prisma.additionalCostType.findUnique({ where: { id: validAdditionalCostTypeId } });
  if (!costType) {
    redirect(`/routes?err=${encodeURIComponent("Onbekende kostensoort geselecteerd")}`);
    return;
  }

  if (validAdditionalCostTypeId !== existingRow.additionalCostTypeId) {
    const conflict = await prisma.ddpCostRate.findUnique({
      where: { routeId_additionalCostTypeId: { routeId: existingRow.routeId, additionalCostTypeId: validAdditionalCostTypeId } },
    });
    if (conflict) {
      redirect(
        `/routes?err=${encodeURIComponent(`${costType.name} is al toegevoegd aan deze route - er kan niet nog een regel voor dezelfde kostensoort bestaan.`)}`,
      );
      return;
    }
  }

  await prisma.ddpCostRate.update({
    where: { id },
    data: {
      additionalCostTypeId: validAdditionalCostTypeId,
      name: costType.name,
      category: costType.category,
      rateUnit,
      amount: validAmount,
      currency,
    },
  });
  revalidatePath("/routes");
  redirect("/routes?msg=cost-updated");
}

/** Hard-deletes a cost line. Safe: quotes snapshot their own cost values. */
export async function deleteRouteCost(id: string): Promise<void> {
  await prisma.ddpCostRate.delete({ where: { id } });
  revalidatePath("/routes");
}
