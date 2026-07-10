"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { DdpCostType } from "@prisma/client";

/**
 * Sets a DDP cost (clearing&inspection per stem, or handling per box) for a
 * route. One value per route per cost type - editing overwrites it in
 * place, same model as freight rates.
 */
export async function setDdpCostRate(formData: FormData): Promise<void> {
  const routeId = String(formData.get("routeId") ?? "");
  const costType = String(formData.get("costType") ?? "") as DdpCostType;
  const amount = String(formData.get("amount") ?? "");
  const currency = String(formData.get("currency") ?? "USD");
  const notes = (formData.get("notes") as string) || null;
  if (!routeId || !costType || !amount) throw new Error("Route, kostentype en bedrag zijn verplicht");

  const existing = await prisma.ddpCostRate.findFirst({ where: { routeId, costType, active: true } });

  if (existing) {
    await prisma.ddpCostRate.update({ where: { id: existing.id }, data: { amount, currency, notes } });
  } else {
    await prisma.ddpCostRate.create({ data: { routeId, costType, amount, currency, notes } });
  }
  revalidatePath("/ddp-costs");
}
