"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function createRoute(formData: FormData): Promise<void> {
  const originId = String(formData.get("originId") ?? "");
  const destinationId = String(formData.get("destinationId") ?? "");
  if (!originId || !destinationId) throw new Error("Vertrekpunt en bestemming zijn verplicht");

  await prisma.route.upsert({
    where: { originId_destinationId: { originId, destinationId } },
    update: {},
    create: { originId, destinationId },
  });
  revalidatePath("/routes");
}

/**
 * Sets the freight rate for a route. There is exactly one rate per route -
 * no history, no start/end dates. Editing overwrites the existing rate in
 * place; if the route has no rate yet, one is created.
 */
export async function setFreightRate(routeId: string, formData: FormData): Promise<void> {
  const ratePerKg = String(formData.get("ratePerKg") ?? "");
  const currency = String(formData.get("currency") ?? "USD");
  const notes = (formData.get("notes") as string) || null;
  if (!ratePerKg) throw new Error("Tarief per kg is verplicht");

  const existing = await prisma.freightRate.findFirst({
    where: { routeId, active: true },
    orderBy: { effectiveFrom: "desc" },
  });

  if (existing) {
    await prisma.freightRate.update({
      where: { id: existing.id },
      data: { ratePerKg, currency, notes, effectiveTo: null },
    });
  } else {
    await prisma.freightRate.create({ data: { routeId, ratePerKg, currency, notes } });
  }
  revalidatePath("/routes");
}
