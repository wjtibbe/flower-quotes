"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import type { CostCategory, CostRateUnit } from "@prisma/client";
import { blockedDeleteMessage } from "@/lib/deletionMessage";
import { normalizeCostTypeName } from "@/lib/additionalCostTypes";

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
    redirect(`/settings/additional-cost-types?err=${encodeURIComponent("Naam, categorie en standaardeenheid zijn verplicht")}`);
  }

  const normalizedName = normalizeCostTypeName(name);
  const existing = await prisma.additionalCostType.findUnique({ where: { normalizedName } });
  if (existing) {
    redirect(`/settings/additional-cost-types?err=${encodeURIComponent(`Er bestaat al een kostensoort met de naam "${existing.name}".`)}`);
  }

  await prisma.additionalCostType.create({ data: { name, normalizedName, category, defaultUnit, description } });
  revalidatePath("/settings/additional-cost-types");
  revalidatePath("/routes");
  redirect("/settings/additional-cost-types?msg=costtype-created");
}

/** Edits an existing cost type in place - renaming it here is what makes the new name show up everywhere it's referenced. */
export async function updateAdditionalCostType(id: string, formData: FormData): Promise<void> {
  const name = normStr(formData.get("name"));
  const category = normStr(formData.get("category")) as CostCategory | null;
  const defaultUnit = normStr(formData.get("defaultUnit")) as CostRateUnit | null;
  const description = normStr(formData.get("description"));
  if (!name || !category || !defaultUnit) {
    redirect(`/settings/additional-cost-types?err=${encodeURIComponent("Naam, categorie en standaardeenheid zijn verplicht")}`);
  }

  const normalizedName = normalizeCostTypeName(name);
  const existing = await prisma.additionalCostType.findUnique({ where: { normalizedName } });
  if (existing && existing.id !== id) {
    redirect(`/settings/additional-cost-types?err=${encodeURIComponent(`Er bestaat al een kostensoort met de naam "${existing.name}".`)}`);
  }

  await prisma.additionalCostType.update({ where: { id }, data: { name, normalizedName, category, defaultUnit, description } });
  revalidatePath("/settings/additional-cost-types");
  revalidatePath("/routes");
  redirect("/settings/additional-cost-types?msg=costtype-updated");
}

/** Activates/deactivates a cost type - an inactive type stops appearing in the Routes & Freight add-dropdown but stays intact for any route cost that already references it. */
export async function toggleAdditionalCostTypeActive(id: string, current: boolean): Promise<void> {
  await prisma.additionalCostType.update({ where: { id }, data: { isActive: !current } });
  revalidatePath("/settings/additional-cost-types");
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
  if (blocked) redirect(`/settings/additional-cost-types?err=${encodeURIComponent(blocked + " Deactiveer de kostensoort in plaats daarvan.")}`);

  await prisma.additionalCostType.delete({ where: { id } });
  revalidatePath("/settings/additional-cost-types");
  redirect("/settings/additional-cost-types?msg=costtype-deleted");
}
