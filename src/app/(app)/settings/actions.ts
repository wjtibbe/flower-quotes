"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";
import { blockedDeleteMessage } from "@/lib/deletionMessage";

export async function addUser(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "SALES") as UserRole;

  if (!name || !email || password.length < 8) {
    throw new Error("Naam, e-mail en een wachtwoord van minimaal 8 tekens zijn verplicht");
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { name, email, passwordHash, role } });
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
