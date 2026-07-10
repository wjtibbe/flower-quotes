"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

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

export async function toggleUserActive(id: string, active: boolean): Promise<void> {
  await prisma.user.update({ where: { id }, data: { active: !active } });
  revalidatePath("/settings");
}
