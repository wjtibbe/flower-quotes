"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Currency, Incoterm } from "@prisma/client";

export async function saveCustomer(formData: FormData): Promise<void> {
  const id = formData.get("id") as string | null;

  const data = {
    companyName: String(formData.get("companyName") ?? "").trim(),
    contactName: (formData.get("contactName") as string) || null,
    whatsappNumber: (formData.get("whatsappNumber") as string) || null,
    email: (formData.get("email") as string) || null,
    destinationId: (formData.get("destinationId") as string) || null,
    defaultCurrency: formData.get("defaultCurrency") as Currency,
    defaultIncoterm: formData.get("defaultIncoterm") as Incoterm,
    defaultMarginPercent: String(formData.get("defaultMarginPercent") ?? "0"),
    notes: (formData.get("notes") as string) || null,
  };

  if (!data.companyName) throw new Error("Bedrijfsnaam is verplicht");

  if (id) {
    await prisma.customer.update({ where: { id }, data });
  } else {
    await prisma.customer.create({ data });
  }

  revalidatePath("/customers");
}

export async function toggleCustomerActive(id: string, active: boolean): Promise<void> {
  await prisma.customer.update({ where: { id }, data: { active: !active } });
  revalidatePath("/customers");
}
