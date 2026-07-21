"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { Currency, Incoterm } from "@prisma/client";
import { blockedDeleteMessage } from "@/lib/deletionMessage";

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
        data: { customerId: customer.id, destinationId, isDefault: true },
      });
    });
  }

  revalidatePath("/customers");
}

/**
 * Hard-deletes a customer. Blocked (with a clear message) when the customer
 * still has quotes, so historical quotes stay intact. The customer's own
 * destination links are deleted along with it.
 */
export async function deleteCustomer(id: string): Promise<void> {
  const quotes = await prisma.quote.count({ where: { customerId: id } });
  const blocked = blockedDeleteMessage("Deze klant", [{ count: quotes, label: "offerte(s)" }]);
  if (blocked) redirect(`/customers?err=${encodeURIComponent(blocked)}`);

  await prisma.$transaction([
    prisma.customerDestination.deleteMany({ where: { customerId: id } }),
    prisma.customer.delete({ where: { id } }),
  ]);
  revalidatePath("/customers");
  redirect("/customers?msg=deleted");
}

/**
 * Adds a delivery destination link to a customer, reusing the shared
 * Destination locations from Routes & vracht. A duplicate link is prevented by
 * the unique constraint on customerId+destinationId. A customer's first
 * destination automatically becomes the default.
 */
export async function addCustomerDestination(customerId: string, formData: FormData): Promise<void> {
  const destinationId = norm(formData.get("destinationId"));
  if (!destinationId) throw new Error("Bestemming is verplicht");

  const existing = await prisma.customerDestination.findUnique({
    where: { customerId_destinationId: { customerId, destinationId } },
  });
  if (existing) {
    redirect("/customers?msg=destination-link-exists");
  }

  const hasAny = await prisma.customerDestination.count({ where: { customerId } });
  const makeDefault = hasAny === 0;

  await prisma.customerDestination.create({
    data: { customerId, destinationId, isDefault: makeDefault },
  });

  if (makeDefault) {
    await prisma.customer.update({ where: { id: customerId }, data: { destinationId } });
  }

  revalidatePath("/customers");
  redirect("/customers?msg=destination-link-added");
}

/**
 * Marks one of the customer's linked destinations as the default and mirrors
 * it onto Customer.destinationId (the field the rest of the app still reads
 * directly).
 */
export async function setDefaultCustomerDestination(customerId: string, customerDestinationId: string): Promise<void> {
  const link = await prisma.customerDestination.findUniqueOrThrow({ where: { id: customerDestinationId } });
  if (link.customerId !== customerId) throw new Error("Bestemming hoort niet bij deze klant");

  await prisma.$transaction([
    prisma.customerDestination.updateMany({ where: { customerId, isDefault: true }, data: { isDefault: false } }),
    prisma.customerDestination.update({ where: { id: link.id }, data: { isDefault: true } }),
    prisma.customer.update({ where: { id: customerId }, data: { destinationId: link.destinationId } }),
  ]);

  revalidatePath("/customers");
}

/**
 * Removes a customer-destination link outright. If it was the default,
 * another remaining link (if any) becomes the new default; otherwise
 * Customer.destinationId is cleared.
 */
export async function deleteCustomerDestination(customerDestinationId: string): Promise<void> {
  const link = await prisma.customerDestination.findUniqueOrThrow({ where: { id: customerDestinationId } });

  await prisma.customerDestination.delete({ where: { id: link.id } });

  if (link.isDefault) {
    const next = await prisma.customerDestination.findFirst({
      where: { customerId: link.customerId },
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
