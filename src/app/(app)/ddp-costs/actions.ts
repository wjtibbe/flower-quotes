"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { DdpCostType } from "@prisma/client";

export async function addDdpCostRate(formData: FormData): Promise<void> {
  const routeId = String(formData.get("routeId") ?? "");
  const costType = String(formData.get("costType") ?? "") as DdpCostType;
  const amount = String(formData.get("amount") ?? "");
  const currency = String(formData.get("currency") ?? "USD");
  const notes = (formData.get("notes") as string) || null;
  if (!routeId || !costType || !amount) throw new Error("Route, kostentype en bedrag zijn verplicht");

  await prisma.$transaction([
    prisma.ddpCostRate.updateMany({ where: { routeId, costType, active: true }, data: { active: false } }),
    prisma.ddpCostRate.create({ data: { routeId, costType, amount, currency, notes } }),
  ]);
  revalidatePath("/ddp-costs");
}
