"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

function norm(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Creates a central assortment product: product (name) + variety + length.
 * Duplicate-safe: an existing Product with the same name (case-insensitive)
 * is reused, and if an identical variant (variety + length, no
 * color/grade/treatment) already exists the action redirects with a
 * "bestaat al" message instead of creating a duplicate.
 */
export async function createCentralProduct(formData: FormData): Promise<void> {
  const name = norm(formData.get("name"));
  const productGroup = norm(formData.get("productGroup")) ?? name;
  const variety = norm(formData.get("variety"));
  const stemLength = norm(formData.get("stemLength"));
  if (!name) throw new Error("Product is verplicht");

  let product = await prisma.product.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (!product) {
    product = await prisma.product.create({ data: { name, productGroup: productGroup! } });
  }

  const existing = await prisma.productVariant.findFirst({
    where: {
      productId: product.id,
      variety: variety ? { equals: variety, mode: "insensitive" } : null,
      stemLength: stemLength ? { equals: stemLength, mode: "insensitive" } : null,
      color: null,
      grade: null,
      treatment: null,
    },
  });
  if (existing) {
    redirect("/products?msg=exists");
  }

  await prisma.productVariant.create({ data: { productId: product.id, variety, stemLength } });
  revalidatePath("/products");
  redirect("/products?msg=created");
}

/** Links a supplier to an existing central product (creates a supplier-assortment row). */
export async function addSupplierLink(formData: FormData): Promise<void> {
  const farmId = norm(formData.get("farmId"));
  const productVariantId = norm(formData.get("productVariantId"));
  const boxType = norm(formData.get("boxType")) ?? "QB";
  const stemsPerBox = parseInt(String(formData.get("stemsPerBox") ?? ""), 10);
  const weightPerBoxKg = norm(formData.get("weightPerBoxKg"));
  if (!farmId || !productVariantId || !Number.isFinite(stemsPerBox) || stemsPerBox <= 0 || !weightPerBoxKg) {
    throw new Error("Leverancier, product, stelen per doos en doosgewicht zijn verplicht");
  }

  await prisma.packagingWeightProfile.create({
    data: {
      farmId,
      productVariantId,
      supplierCode: norm(formData.get("supplierCode")),
      boxType,
      stemsPerBox,
      weightPerBoxKg,
      notes: norm(formData.get("notes")),
    },
  });
  revalidatePath("/products");
  revalidatePath("/weight-profiles");
}

/** Updates an existing supplier link in place. */
export async function updateSupplierLink(id: string, formData: FormData): Promise<void> {
  const stemsPerBox = parseInt(String(formData.get("stemsPerBox") ?? ""), 10);
  const weightPerBoxKg = norm(formData.get("weightPerBoxKg"));
  if (!Number.isFinite(stemsPerBox) || stemsPerBox <= 0 || !weightPerBoxKg) {
    throw new Error("Stelen per doos en doosgewicht zijn verplicht");
  }

  await prisma.packagingWeightProfile.update({
    where: { id },
    data: {
      farmId: norm(formData.get("farmId")) ?? undefined,
      supplierCode: norm(formData.get("supplierCode")),
      boxType: norm(formData.get("boxType")) ?? "QB",
      stemsPerBox,
      weightPerBoxKg,
      notes: norm(formData.get("notes")),
    },
  });
  revalidatePath("/products");
  revalidatePath("/weight-profiles");
}

/**
 * Duplicates an existing supplier link for a different (or same) supplier:
 * copies box/weight/stems/code/notes, with the supplier chosen in the form.
 */
export async function duplicateSupplierLink(id: string, formData: FormData): Promise<void> {
  const farmId = norm(formData.get("farmId"));
  if (!farmId) throw new Error("Kies een leverancier voor de kopie");

  const source = await prisma.packagingWeightProfile.findUniqueOrThrow({ where: { id } });
  await prisma.packagingWeightProfile.create({
    data: {
      farmId,
      productVariantId: source.productVariantId,
      supplierCode: source.supplierCode,
      boxType: source.boxType,
      stemsPerBox: source.stemsPerBox,
      weightPerBoxKg: source.weightPerBoxKg,
      notes: source.notes,
    },
  });
  revalidatePath("/products");
  revalidatePath("/weight-profiles");
}

export async function toggleSupplierLinkActive(id: string, active: boolean): Promise<void> {
  await prisma.packagingWeightProfile.update({ where: { id }, data: { active: !active } });
  revalidatePath("/products");
  revalidatePath("/weight-profiles");
}

// --- existing central-product management actions (aliases, variants) ---

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

export async function toggleVariantActive(id: string, active: boolean): Promise<void> {
  await prisma.productVariant.update({ where: { id }, data: { active: !active } });
  revalidatePath("/products");
}
