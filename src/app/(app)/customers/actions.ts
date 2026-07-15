"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Currency, Incoterm } from "@prisma/client";

function norm(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

/**
 * Creates or updates a customer's core fields. On create, an initial
 * destination is required ("Bestemming verplicht bij nieuwe klanten") and
 * becomes the default CustomerDestination link. On edit, the destination is
 * not part of this form - it's managed via the destination actions below -
 * so editing an existing customer that has no destination yet is never
 * blocked by this requirement.
 */
export async function saveCustomer(formData: FormData): Promise<void> {
  const id = norm(formData.get("id"));
  const companyName = norm(formData.get("companyName"));
  if (!companyName) throw new Error("Bedrijfsnaam is verplicht");

  const data = {
    companyName,
    contactName: norm(formData.get("contactName")),
    whatsappNumber: norm(formData.get("whatsappNumber")),
    email: norm(formData.get("email")),
    invoiceAddress: norm(formData.get("invoiceAddress")),
    country: norm(formData.get("country")),
    defaultCurrency: formData.get("defaultCurrency") as Currency,
    defaultIncoterm: formData.get("defaultIncoterm") as Incoterm,
    defaultMarginPercent: String(formData.get("defaultMarginPercent") ?? "0"),
    notes: norm(formData.get("notes")),
  };

  if (id) {
    await prisma.customer.update({ where: { id }, data });
  } else {
    const destinationId = norm(formData.get("destinationId"));
    if (!destinationId) throw new Error("Standaard leverbestemming is verplicht voor een nieuwe klant");

    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({ data: { ...data, destinationId } });
      await tx.customerDestination.create({
        data: { customerId: customer.id, destinationId, isDefault: true, active: true },
      });
    });
  }

  revalidatePath("/customers");
}

export async function toggleCustomerActive(id: string, active: boolean): Promise<void> {
  await prisma.customer.update({ where: { id }, data: { active: !active } });
  revalidatePath("/customers");
}

/**
 * Adds a delivery destination link to a customer, reusing the shared
 * Destination locations from Routes & vracht. Reactivates a previously
 * deactivated link instead of creating a duplicate (unique constraint on
 * customerId+destinationId prevents duplicates outright). A customer's
 * first destination automatically becomes the default.
 */
export async function addCustomerDestination(customerId: string, formData: FormData): Promise<void> {
  const destinationId = norm(formData.get("destinationId"));
  if (!destinationId) throw new Error("Bestemming is verplicht");

  const existing = await prisma.customerDestination.findUnique({
    where: { customerId_destinationId: { customerId, destinationId } },
  });
  if (existing?.active) {
    redirect("/customers?msg=destination-link-exists");
  }

  const hasAnyActive = await prisma.customerDestination.count({ where: { customerId, active: true } });
  const makeDefault = hasAnyActive === 0;

  if (existing) {
    await prisma.customerDestination.update({
      where: { id: existing.id },
      data: { active: true, isDefault: existing.isDefault || makeDefault },
    });
  } else {
    await prisma.customerDestination.create({
      data: { customerId, destinationId, active: true, isDefault: makeDefault },
    });
  }

  if (makeDefault) {
    await prisma.customer.update({ where: { id: customerId }, data: { destinationId } });
  }

  revalidatePath("/customers");
  redirect("/customers?msg=destination-link-added");
}

/**
 * Marks one of the customer's linked destinations as the default and mirrors
 * it onto Customer.destinationId (the field the rest of the app still reads
 * directly). Refuses to promote a deactivated link to default.
 */
export async function setDefaultCustomerDestination(customerId: string, customerDestinationId: string): Promise<void> {
  const link = await prisma.customerDestination.findUniqueOrThrow({ where: { id: customerDestinationId } });
  if (link.customerId !== customerId) throw new Error("Bestemming hoort niet bij deze klant");
  if (!link.active) throw new Error("Een gedeactiveerde bestemming kan niet als standaard worden ingesteld");

  await prisma.$transaction([
    prisma.customerDestination.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } }),
    prisma.customerDestination.update({ where: { id: link.id }, data: { isDefault: true } }),
    prisma.customer.update({ where: { id: customerId }, data: { destinationId: link.destinationId } }),
  ]);

  revalidatePath("/customers");
}

/**
 * Deactivates a customer-destination link (kept for history, never deleted).
 * If it was the default, another active link (if any) becomes the new
 * default; otherwise Customer.destinationId is cleared, so a deactivated
 * destination is never left in place as the default.
 */
export async function deactivateCustomerDestination(customerDestinationId: string): Promise<void> {
  const link = await prisma.customerDestination.findUniqueOrThrow({ where: { id: customerDestinationId } });

  await prisma.customerDestination.update({ where: { id: link.id }, data: { active: false, isDefault: false } });

  if (link.isDefault) {
    const next = await prisma.customerDestination.findFirst({
      where: { customerId: link.customerId, active: true },
      orderBy: { createdAt: "asc" },
    });
    if (next) {
      await prisma.customerDestination.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    await prisma.customer.update({
      where: { id: link.customerId },
      data: { destinationId: next?.destinationId ?? null },
    });
  }

  revalidatePath("/customers");
}
