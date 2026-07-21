"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Currency } from "@prisma/client";

async function currentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

function validateRate(baseCurrency: string, quoteCurrency: string, rateRaw: string): void {
  if (!baseCurrency || !quoteCurrency || !rateRaw) throw new Error("Alle velden zijn verplicht");
  if (!(baseCurrency in Currency) || !(quoteCurrency in Currency)) throw new Error("Ongeldige valutacode");
  if (baseCurrency === quoteCurrency) throw new Error("Basis- en doelvaluta moeten verschillend zijn");
  const rate = Number(rateRaw);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Koers moet groter dan nul zijn");
}

/**
 * Sets the current rate for a pair. Exactly one rate exists per pair: any
 * existing row for the same pair is deleted first, then the new one inserted.
 * Historical quote snapshots are untouched because quotes store their own
 * exchange-rate value and never read this table back.
 */
export async function addExchangeRate(formData: FormData): Promise<void> {
  const baseCurrency = String(formData.get("baseCurrency") ?? "");
  const quoteCurrency = String(formData.get("quoteCurrency") ?? "");
  const rate = String(formData.get("rate") ?? "").trim();
  const notes = (formData.get("notes") as string)?.trim() || null;
  validateRate(baseCurrency, quoteCurrency, rate);

  const updatedById = await currentUserId();
  await prisma.$transaction([
    prisma.exchangeRate.deleteMany({
      where: { baseCurrency: baseCurrency as Currency, quoteCurrency: quoteCurrency as Currency },
    }),
    prisma.exchangeRate.create({
      data: { baseCurrency: baseCurrency as Currency, quoteCurrency: quoteCurrency as Currency, rate, notes, updatedById },
    }),
  ]);
  revalidatePath("/exchange-rates");
  redirect("/exchange-rates?msg=rate-added");
}

/**
 * Edits an existing rate record in place (rate value / notes). The currency
 * pair itself is not editable here - change it by adding it again. Historical
 * quote snapshots are untouched because they never read this table.
 */
export async function editExchangeRate(id: string, formData: FormData): Promise<void> {
  const existing = await prisma.exchangeRate.findUniqueOrThrow({ where: { id } });
  const rate = String(formData.get("rate") ?? "").trim();
  const notes = (formData.get("notes") as string)?.trim() || null;
  validateRate(existing.baseCurrency, existing.quoteCurrency, rate);

  const updatedById = await currentUserId();
  await prisma.exchangeRate.update({ where: { id }, data: { rate, notes, updatedById } });
  revalidatePath("/exchange-rates");
  redirect("/exchange-rates?msg=rate-updated");
}

/** Hard-deletes a rate. Safe: quotes snapshot their own rate, never this row. */
export async function deleteExchangeRate(id: string): Promise<void> {
  await prisma.exchangeRate.delete({ where: { id } });
  revalidatePath("/exchange-rates");
  redirect("/exchange-rates?msg=rate-deleted");
}
