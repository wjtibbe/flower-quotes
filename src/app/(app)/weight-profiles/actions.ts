"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function saveWeightProfile(formData: FormData): Promise<void> {
  const id = formData.get("id") as string | null;
  const data = {
    farmId: String(formData.get("farmId") ?? ""),
    productVariantId: String(formData.get("productVariantId") ?? ""),
    boxType: String(formData.get("boxType") ?? "QB").trim(),
    stemsPerBox: parseInt(String(formData.get("stemsPerBox") ?? "0"), 10),
    weightPerBoxKg: String(formData.get("weightPerBoxKg") ?? "0"),
    notes: (formData.get("notes") as string) || null,
  };
  if (!data.farmId || !data.productVariantId || !data.stemsPerBox) {
    throw new Error("Leverancier, product en stelen per doos zijn verplicht");
  }

  if (id) {
    await prisma.packagingWeightProfile.update({ where: { id }, data });
  } else {
    await prisma.packagingWeightProfile.create({ data });
  }
  revalidatePath("/weight-profiles");
}

export async function toggleWeightProfileActive(id: string, active: boolean): Promise<void> {
  await prisma.packagingWeightProfile.update({ where: { id }, data: { active: !active } });
  revalidatePath("/weight-profiles");
}
