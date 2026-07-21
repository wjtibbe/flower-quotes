"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { CostCategory, CostRateUnit, FreightRateUnit, TransportType } from "@prisma/client";

function norm(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/** Creates an origin location; case-insensitive duplicate check on city+country. */
export async function createOrigin(formData: FormData): Promise<void> {
  const city = norm(formData.get("city"));
  const country = norm(formData.get("country"));
  if (!city || !country) throw new Error("Stad en land zijn verplicht");

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
  if (!city || !country) throw new Error("Stad en land zijn verplicht");

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
  if (!originId || !destinationId) throw new Error("Vertrekpunt en bestemming zijn verplicht");

  const existing = await prisma.route.findFirst({ where: { originId, destinationId, transportType } });
  if (existing) redirect("/routes?msg=route-exists");

  await prisma.route.create({ data: { originId, destinationId, transportType } });
  revalidatePath("/routes");
  redirect("/routes?msg=route-created");
}

/**
 * Adds a freight rate to a route. Multiple rates per route are allowed -
 * pricing picks the active rate whose validity window contains "now", newest
 * effectiveFrom first, so adding a rate with a later start date supersedes
 * the previous one automatically without touching history.
 */
export async function addFreightRate(routeId: string, formData: FormData): Promise<void> {
  const amount = norm(formData.get("ratePerKg"));
  const currency = norm(formData.get("currency")) ?? "USD";
  const rateUnit = (norm(formData.get("rateUnit")) ?? "PER_KG") as FreightRateUnit;
  const effectiveFromRaw = norm(formData.get("effectiveFrom"));
  const effectiveToRaw = norm(formData.get("effectiveTo"));
  if (!amount) throw new Error("Tarief is verplicht");

  await prisma.freightRate.create({
    data: {
      routeId,
      ratePerKg: amount, // legacy column name; holds the amount in `rateUnit`
      currency,
      rateUnit,
      effectiveFrom: effectiveFromRaw ? new Date(effectiveFromRaw) : new Date(),
      effectiveTo: effectiveToRaw ? new Date(effectiveToRaw) : null,
      notes: norm(formData.get("notes")),
    },
  });
  revalidatePath("/routes");
}

/** Hard-deletes a freight rate. Safe: quotes snapshot their own rate. */
export async function deleteFreightRate(id: string): Promise<void> {
  await prisma.freightRate.delete({ where: { id } });
  revalidatePath("/routes");
}

/**
 * Hard-deletes a route along with its freight rates and additional costs
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
 * Adds an additional cost line to a route. Multiple costs per route are
 * allowed; the pricing engine picks, per (category, name), the currently
 * valid newest one - so a later-dated row supersedes automatically without
 * touching history.
 */
export async function addRouteCost(routeId: string, formData: FormData): Promise<void> {
  const name = norm(formData.get("name"));
  const category = norm(formData.get("category")) as CostCategory | null;
  const rateUnit = norm(formData.get("rateUnit")) as CostRateUnit | null;
  const amount = norm(formData.get("amount"));
  const currency = norm(formData.get("currency")) ?? "USD";
  const effectiveFromRaw = norm(formData.get("effectiveFrom"));
  const effectiveToRaw = norm(formData.get("effectiveTo"));
  if (!name || !category || !rateUnit || !amount) {
    throw new Error("Naam, categorie, rekeneenheid en bedrag zijn verplicht");
  }

  await prisma.ddpCostRate.create({
    data: {
      routeId,
      name,
      category,
      rateUnit,
      amount,
      currency,
      effectiveFrom: effectiveFromRaw ? new Date(effectiveFromRaw) : new Date(),
      effectiveTo: effectiveToRaw ? new Date(effectiveToRaw) : null,
      notes: norm(formData.get("notes")),
    },
  });
  revalidatePath("/routes");
}

/** Hard-deletes a cost line. Safe: quotes snapshot their own cost values. */
export async function deleteRouteCost(id: string): Promise<void> {
  await prisma.ddpCostRate.delete({ where: { id } });
  revalidatePath("/routes");
}
