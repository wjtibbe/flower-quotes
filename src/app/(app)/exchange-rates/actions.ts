"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Currency } from "@prisma/client";
import { BASE_CURRENCY } from "@/lib/exchangeRate";

async function currentUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}

/**
 * EUR is the single base currency for manually maintained exchange rates
 * (see src/lib/exchangeRate.ts) - every stored row is "1 EUR = rate target".
 */
function validateTargetAndRate(quoteCurrency: string, rateRaw: string): void {
  if (!quoteCurrency || !rateRaw) throw new Error("Alle velden zijn verplicht");
  if (!(quoteCurrency in Currency)) throw new Error("Ongeldige valutacode");
  if (quoteCurrency === BASE_CURRENCY) throw new Error("Doelvaluta mag niet gelijk zijn aan de basisvaluta (EUR)");
  const rate = Number(rateRaw);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Koers moet groter dan nul zijn");
}

/**
 * Sets the current EUR -> target rate. Exactly one rate exists per target
 * currency: any existing row is deleted first, then the new one inserted.
 * Historical quote snapshots are untouched because quotes store their own
 * exchange-rate value and never read this table back. The base currency is
 * never read from the form - it is always EUR.
 */
export async function addExchangeRate(formData: FormData): Promise<void> {
  const quoteCurrency = String(formData.get("quoteCurrency") ?? "");
  const rate = String(formData.get("rate") ?? "").trim();
  const notes = (formData.get("notes") as string)?.trim() || null;
  validateTargetAndRate(quoteCurrency, rate);

  const updatedById = await currentUserId();
  await prisma.$transaction([
    prisma.exchangeRate.deleteMany({
      where: { baseCurrency: BASE_CURRENCY, quoteCurrency: quoteCurrency as Currency },
    }),
    prisma.exchangeRate.create({
      data: { baseCurrency: BASE_CURRENCY, quoteCurrency: quoteCurrency as Currency, rate, notes, updatedById },
    }),
  ]);
  revalidatePath("/exchange-rates");
  redirect("/exchange-rates?msg=rate-added");
}

/**
 * Edits an existing rate record in place (rate value / notes). Neither the
 * base currency (always EUR) nor the target currency is editable here -
 * change the target by adding it again. Historical quote snapshots are
 * untouched because they never read this table.
 */
export async function editExchangeRate(id: string, formData: FormData): Promise<void> {
  const existing = await prisma.exchangeRate.findUniqueOrThrow({ where: { id } });
  if (existing.baseCurrency !== BASE_CURRENCY) {
    // Defensive: unreachable once the EUR-base data migration has run.
    throw new Error("Deze koers is niet EUR-gebaseerd en kan niet via dit formulier worden bewerkt");
  }
  const rate = String(formData.get("rate") ?? "").trim();
  const notes = (formData.get("notes") as string)?.trim() || null;
  validateTargetAndRate(existing.quoteCurrency, rate);

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
