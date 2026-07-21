"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { blockedDeleteMessage } from "@/lib/deletionMessage";

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

/**
 * Hard-deletes a supplier. Blocked (with a clear message) when the supplier is
 * still referenced by assortment rows, uploaded offers or historical quote
 * lines, so referential integrity - and quote history - is never broken. The
 * supplier's own aliases are deleted along with it.
 */
export async function deleteFarm(id: string): Promise<void> {
  const [assortment, offers, quoteLines] = await Promise.all([
    prisma.packagingWeightProfile.count({ where: { farmId: id } }),
    prisma.farmOffer.count({ where: { farmId: id } }),
    prisma.quoteLine.count({ where: { farmId: id } }),
  ]);
  const blocked = blockedDeleteMessage("Deze leverancier", [
    { count: assortment, label: "assortimentregel(s)" },
    { count: offers, label: "leveranciersaanbieding(en)" },
    { count: quoteLines, label: "offerteregel(s)" },
  ]);
  if (blocked) redirect(`/farms?err=${encodeURIComponent(blocked)}`);

  await prisma.$transaction([
    prisma.farmAlias.deleteMany({ where: { farmId: id } }),
    prisma.farm.delete({ where: { id } }),
  ]);
  revalidatePath("/farms");
  redirect("/farms?msg=deleted");
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
