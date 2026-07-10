"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function createProduct(formData: FormData): Promise<void> {
  const productGroup = String(formData.get("productGroup") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!productGroup || !name) throw new Error("Productgroep en naam zijn verplicht");
  await prisma.product.create({ data: { productGroup, name } });
  revalidatePath("/products");
}

export async function toggleProductActive(id: string, active: boolean): Promise<void> {
  await prisma.product.update({ where: { id }, data: { active: !active } });
  revalidatePath("/products");
}

export async function addProductAlias(productId: string, formData: FormData): Promise<void> {
  const alias = String(formData.get("alias") ?? "").trim();
  if (!alias) return;
  await prisma.productAlias.upsert({
    where: { productId_alias: { productId, alias } },
    update: {},
    create: { productId, alias },
  });
  revalidatePath("/products");
}

export async function removeProductAlias(id: string): Promise<void> {
  await prisma.productAlias.delete({ where: { id } });
  revalidatePath("/products");
}

export async function addProductVariant(productId: string, formData: FormData): Promise<void> {
  const variety = (formData.get("variety") as string) || null;
  const color = (formData.get("color") as string) || null;
  const grade = (formData.get("grade") as string) || null;
  const treatment = (formData.get("treatment") as string) || null;
  await prisma.productVariant.create({ data: { productId, variety, color, grade, treatment } });
  revalidatePath("/products");
}

export async function toggleVariantActive(id: string, active: boolean): Promise<void> {
  await prisma.productVariant.update({ where: { id }, data: { active: !active } });
  revalidatePath("/products");
}
