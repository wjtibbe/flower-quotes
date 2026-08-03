"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { UserRole, type CostCategory, type CostRateUnit } from "@prisma/client";
import bcrypt from "bcryptjs";
import { blockedDeleteMessage } from "@/lib/deletionMessage";
import { normalizeCostTypeName } from "@/lib/additionalCostTypes";

export async function addUser(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "SALES") as UserRole;

  if (!name || !email || password.length < 8) {
    redirect(`/settings?err=${encodeURIComponent("Naam, e-mail en een wachtwoord van minimaal 8 tekens zijn verplicht")}`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.user.create({ data: { name, email, passwordHash, role } });
  } catch {
    // Unique constraint on email is the only realistic failure here.
    redirect(`/settings?err=${encodeURIComponent(`Er bestaat al een gebruiker met e-mailadres "${email}".`)}`);
  }
  revalidatePath("/settings");
}

/**
 * Hard-deletes a user. Blocked (with a clear message) when the user still owns
 * created offers/quotes, updated exchange rates or uploaded files, so audit
 * history stays intact. Also refuses to delete the last remaining user.
 */
export async function deleteUser(id: string): Promise<void> {
  const total = await prisma.user.count();
  if (total <= 1) redirect(`/settings?err=${encodeURIComponent("De laatste gebruiker kan niet worden verwijderd.")}`);

  // Only required foreign keys actually block a delete (exchange-rate
  // updatedById is nullable and set-null on delete, so it never blocks).
  const [offers, quotes, uploads] = await Promise.all([
    prisma.farmOffer.count({ where: { createdById: id } }),
    prisma.quote.count({ where: { createdById: id } }),
    prisma.sourceUpload.count({ where: { uploadedById: id } }),
  ]);
  const blocked = blockedDeleteMessage("Deze gebruiker", [
    { count: offers, label: "leveranciersaanbieding(en)" },
    { count: quotes, label: "offerte(s)" },
    { count: uploads, label: "upload(s)" },
  ]);
  if (blocked) redirect(`/settings?err=${encodeURIComponent(blocked)}`);

  await prisma.user.delete({ where: { id } });
  revalidatePath("/settings");
  redirect("/settings?msg=deleted");
}

// --- Additional cost types ("Aanvullende kostensoorten") ---
// The centrally managed vocabulary Routes & Freight (and, via the frozen
// quote-line snapshot, quote pricing/detail/exports) select from instead of
// free-text - see src/lib/additionalCostTypes.ts for the shared name
// normalization these actions rely on for case-insensitive uniqueness.

function normStr(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/** Adds a new cost type. Rejects a name that only differs in case/whitespace from an existing one. */
export async function addAdditionalCostType(formData: FormData): Promise<void> {
  const name = normStr(formData.get("name"));
  const category = normStr(formData.get("category")) as CostCategory | null;
  const defaultUnit = normStr(formData.get("defaultUnit")) as CostRateUnit | null;
  const description = normStr(formData.get("description"));
  if (!name || !category || !defaultUnit) {
    redirect(`/settings?err=${encodeURIComponent("Naam, categorie en standaardeenheid zijn verplicht")}`);
  }

  const normalizedName = normalizeCostTypeName(name);
  const existing = await prisma.additionalCostType.findUnique({ where: { normalizedName } });
  if (existing) {
    redirect(`/settings?err=${encodeURIComponent(`Er bestaat al een kostensoort met de naam "${existing.name}".`)}`);
  }

  await prisma.additionalCostType.create({ data: { name, normalizedName, category, defaultUnit, description } });
  revalidatePath("/settings");
  revalidatePath("/routes");
  redirect("/settings?msg=costtype-created");
}

/** Edits an existing cost type in place - renaming it here is what makes the new name show up everywhere it's referenced. */
export async function updateAdditionalCostType(id: string, formData: FormData): Promise<void> {
  const name = normStr(formData.get("name"));
  const category = normStr(formData.get("category")) as CostCategory | null;
  const defaultUnit = normStr(formData.get("defaultUnit")) as CostRateUnit | null;
  const description = normStr(formData.get("description"));
  if (!name || !category || !defaultUnit) {
    redirect(`/settings?err=${encodeURIComponent("Naam, categorie en standaardeenheid zijn verplicht")}`);
  }

  const normalizedName = normalizeCostTypeName(name);
  const existing = await prisma.additionalCostType.findUnique({ where: { normalizedName } });
  if (existing && existing.id !== id) {
    redirect(`/settings?err=${encodeURIComponent(`Er bestaat al een kostensoort met de naam "${existing.name}".`)}`);
  }

  await prisma.additionalCostType.update({ where: { id }, data: { name, normalizedName, category, defaultUnit, description } });
  revalidatePath("/settings");
  revalidatePath("/routes");
  redirect("/settings?msg=costtype-updated");
}

/** Activates/deactivates a cost type - an inactive type stops appearing in the Routes & Freight add-dropdown but stays intact for any route cost that already references it. */
export async function toggleAdditionalCostTypeActive(id: string, current: boolean): Promise<void> {
  await prisma.additionalCostType.update({ where: { id }, data: { isActive: !current } });
  revalidatePath("/settings");
  revalidatePath("/routes");
}

/**
 * Hard-deletes a cost type only when no route additional cost references it
 * (past or present - the FK is SET NULL on delete, which would silently
 * orphan historical route costs, so this is blocked instead). Deactivation
 * is the only option once a type is in use.
 */
export async function deleteAdditionalCostType(id: string): Promise<void> {
  const usageCount = await prisma.ddpCostRate.count({ where: { additionalCostTypeId: id } });
  const blocked = blockedDeleteMessage("Deze kostensoort", [{ count: usageCount, label: "aanvullende kost(en) op routes" }]);
  if (blocked) redirect(`/settings?err=${encodeURIComponent(blocked + " Deactiveer de kostensoort in plaats daarvan.")}`);

  await prisma.additionalCostType.delete({ where: { id } });
  revalidatePath("/settings");
  redirect("/settings?msg=costtype-deleted");
}
