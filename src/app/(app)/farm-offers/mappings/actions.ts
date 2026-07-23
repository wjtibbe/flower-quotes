"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isPackagingProfileValidForSupplier } from "@/lib/import/offerLineValidation";
import type { ActionResult } from "@/lib/actionResult";

async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Niet ingelogd");
  return session.user.id;
}

/**
 * Changes a mapping's target assortment article (section 16). First-version
 * scope, deliberately kept simple: only the target may change here -
 * `rawSource`/`normalizedSource` stay read-only (changing what text a
 * mapping matches is a bigger, separate decision this screen doesn't offer
 * yet). Always re-reads the mapping and the newly-chosen profile fresh and
 * re-checks supplier consistency - a client-supplied profile id is never
 * trusted just because it appeared in a dropdown.
 */
export async function updateSupplierLineMappingTarget(
  mappingId: string,
  packagingWeightProfileId: string,
): Promise<ActionResult> {
  await requireUserId();

  const mapping = await prisma.supplierLineMapping.findUnique({ where: { id: mappingId } });
  if (!mapping) return { ok: false, message: "Deze mapping bestaat niet meer. Ververs de pagina." };

  const profile = await prisma.packagingWeightProfile.findUnique({
    where: { id: packagingWeightProfileId },
    select: { id: true, farmId: true },
  });
  if (!profile) return { ok: false, message: "Dit assortimentartikel bestaat niet (meer)." };
  if (!isPackagingProfileValidForSupplier(mapping.farmId, profile.farmId)) {
    return {
      ok: false,
      message: "Dit assortimentartikel behoort tot een andere leverancier en kan niet aan deze mapping worden gekoppeld.",
    };
  }

  try {
    await prisma.supplierLineMapping.update({
      where: { id: mappingId },
      data: { packagingWeightProfileId },
    });
  } catch {
    return { ok: false, message: "Bijwerken is mislukt door een databasefout. Probeer het opnieuw." };
  }

  revalidatePath("/farm-offers/mappings");
  return { ok: true, message: "Mapping bijgewerkt." };
}

/**
 * Real, hard delete (section 17) - this app has no soft-delete/deactivate
 * concept anywhere else, and a mapping is no exception. Only affects FUTURE
 * imports: existing `FarmOfferLine`s and `Quote`s that were matched via this
 * mapping keep their own already-persisted `packagingWeightProfileId`/
 * `matchStatus` untouched (they never reference the mapping row itself).
 */
export async function deleteSupplierLineMapping(mappingId: string): Promise<ActionResult> {
  await requireUserId();

  const mapping = await prisma.supplierLineMapping.findUnique({ where: { id: mappingId }, select: { rawSource: true } });
  if (!mapping) return { ok: false, message: "Deze mapping bestaat niet meer. Ververs de pagina." };

  try {
    await prisma.supplierLineMapping.delete({ where: { id: mappingId } });
  } catch {
    return { ok: false, message: "Verwijderen is mislukt door een databasefout. Probeer het opnieuw." };
  }

  revalidatePath("/farm-offers/mappings");
  return { ok: true, message: "Mapping verwijderd." };
}
