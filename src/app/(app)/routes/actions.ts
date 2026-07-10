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

export async function addFreightRate(routeId: string, formData: FormData): Promise<void> {
  const ratePerKg = String(formData.get("ratePerKg") ?? "");
  const currency = String(formData.get("currency") ?? "USD");
  const effectiveTo = formData.get("effectiveTo") ? new Date(String(formData.get("effectiveTo"))) : null;
  const notes = (formData.get("notes") as string) || null;
  if (!ratePerKg) throw new Error("Tarief per kg is verplicht");

  // Deactivate the previous active rate for this route so history stays intact
  // while only one rate is "current" at a time.
  await prisma.$transaction([
    prisma.freightRate.updateMany({ where: { routeId, active: true }, data: { active: false } }),
    prisma.freightRate.create({ data: { routeId, ratePerKg, currency, effectiveTo, notes } }),
  ]);
  revalidatePath("/routes");
}
