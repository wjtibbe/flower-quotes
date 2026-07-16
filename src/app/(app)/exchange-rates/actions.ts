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
 * Adds a new current rate for a pair. Any existing active rate for the exact
 * same pair is deactivated first (kept for history, never deleted), which
 * enforces "one active record per pair" and prevents duplicate active pairs.
 */
export async function addExchangeRate(formData: FormData): Promise<void> {
  const baseCurrency = String(formData.get("baseCurrency") ?? "");
  const quoteCurrency = String(formData.get("quoteCurrency") ?? "");
  const rate = String(formData.get("rate") ?? "").trim();
  const notes = (formData.get("notes") as string)?.trim() || null;
  validateRate(baseCurrency, quoteCurrency, rate);

  const updatedById = await currentUserId();
  await prisma.$transaction([
    prisma.exchangeRate.updateMany({
      where: { baseCurrency: baseCurrency as Currency, quoteCurrency: quoteCurrency as Currency, active: true },
      data: { active: false },
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
 * pair itself is not editable here - change it by adding a new pair - so no
 * duplicate active pair can be introduced by an edit. Historical quote
 * snapshots are untouched because they never read this table.
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

/** Activates/deactivates a rate. Deactivating keeps the row for history. */
export async function toggleExchangeRateActive(id: string, active: boolean): Promise<void> {
  const updatedById = await currentUserId();
  await prisma.exchangeRate.update({ where: { id }, data: { active: !active, updatedById } });
  revalidatePath("/exchange-rates");
}
