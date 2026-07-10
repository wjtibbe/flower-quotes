"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Currency } from "@prisma/client";

export async function addExchangeRate(formData: FormData): Promise<void> {
  const baseCurrency = String(formData.get("baseCurrency") ?? "") as Currency;
  const quoteCurrency = String(formData.get("quoteCurrency") ?? "") as Currency;
  const rate = String(formData.get("rate") ?? "");
  const notes = (formData.get("notes") as string) || null;
  if (!baseCurrency || !quoteCurrency || !rate) throw new Error("Alle velden zijn verplicht");
  if (baseCurrency === quoteCurrency) throw new Error("Basis- en doelvaluta moeten verschillend zijn");

  await prisma.$transaction([
    prisma.exchangeRate.updateMany({ where: { baseCurrency, quoteCurrency, active: true }, data: { active: false } }),
    prisma.exchangeRate.create({ data: { baseCurrency, quoteCurrency, rate, notes } }),
  ]);
  revalidatePath("/exchange-rates");
}
