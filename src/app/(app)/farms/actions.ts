"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Currency } from "@prisma/client";
import { prisma } from "@/lib/db";
import { blockedDeleteMessage } from "@/lib/deletionMessage";
import { isFarmHeaderRow, parseFarmRow } from "@/lib/import/farmPaste";

export async function saveFarm(formData: FormData): Promise<void> {
  const id = formData.get("id") as string | null;
  const defaultCurrencyRaw = (formData.get("defaultCurrency") as string) || "USD";
  const data = {
    name: String(formData.get("name") ?? "").trim(),
    country: String(formData.get("country") ?? "").trim(),
    // Supplier default currency (section: "Supplier default currency") -
    // used as the second-tier currency source for Farm Offer import
    // enrichment, after an explicit source currency. Defaults to USD when
    // the form somehow omits it; only USD/EUR are valid selections.
    defaultCurrency: (Object.values(Currency) as string[]).includes(defaultCurrencyRaw)
      ? (defaultCurrencyRaw as Currency)
      : Currency.USD,
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

/**
 * Bulk-creates suppliers from a pasted list, one per line:
 *   Land <TAB> Naam   (or just Naam, using the shared default country).
 * A supplier whose name already exists (case-insensitive) is skipped rather
 * than duplicated - safe to re-paste - and duplicates within the paste itself
 * are collapsed. A header row and blank lines are ignored.
 */
export async function bulkAddFarms(formData: FormData): Promise<void> {
  const defaultCountry = String(formData.get("defaultCountry") ?? "").trim();
  const rowsRaw = String(formData.get("rows") ?? "");
  const lines = rowsRaw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Existing names (lower-cased) + names seen earlier in this paste, so we never
  // create a duplicate supplier.
  const existing = await prisma.farm.findMany({ select: { name: true } });
  const seen = new Set(existing.map((f) => f.name.trim().toLowerCase()));

  const toCreate: { name: string; country: string }[] = [];
  let duplicates = 0;
  let invalid = 0;

  for (const line of lines) {
    if (isFarmHeaderRow(line)) continue;
    const row = parseFarmRow(line, defaultCountry);
    if (!row) {
      invalid++;
      continue;
    }
    const key = row.name.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    toCreate.push({ name: row.name, country: row.country });
  }

  if (toCreate.length > 0) {
    await prisma.farm.createMany({ data: toCreate });
  }

  revalidatePath("/farms");
  redirect(`/farms?msg=bulkfarms&created=${toCreate.length}&dup=${duplicates}&invalid=${invalid}`);
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
