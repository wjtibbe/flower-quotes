"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function saveFarm(formData: FormData): Promise<void> {
  const id = formData.get("id") as string | null;
  const data = {
    name: String(formData.get("name") ?? "").trim(),
    country: String(formData.get("country") ?? "").trim(),
    originId: (formData.get("originId") as string) || null,
    notes: (formData.get("notes") as string) || null,
  };
  if (!data.name || !data.country) throw new Error("Naam en land zijn verplicht");

  if (id) {
    await prisma.farm.update({ where: { id }, data });
  } else {
    await prisma.farm.create({ data });
  }
  revalidatePath("/farms");
}

export async function toggleFarmActive(id: string, active: boolean): Promise<void> {
  await prisma.farm.update({ where: { id }, data: { active: !active } });
  revalidatePath("/farms");
}

export async function addFarmAlias(farmId: string, formData: FormData): Promise<void> {
  const alias = String(formData.get("alias") ?? "").trim();
  if (!alias) return;
  await prisma.farmAlias.upsert({
    where: { farmId_alias: { farmId, alias } },
    update: {},
    create: { farmId, alias },
  });
  revalidatePath("/farms");
}

export async function removeFarmAlias(id: string): Promise<void> {
  await prisma.farmAlias.delete({ where: { id } });
  revalidatePath("/farms");
}
