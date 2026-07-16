"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { priceLineForCustomer } from "@/lib/quotePricing";
import { generateQuoteNumber } from "@/lib/quoteNumber";
import type { Incoterm, CurrencyCode } from "@/lib/pricing";
import { QuoteStatus, QuoteExportType } from "@prisma/client";
import { buildWhatsAppText, buildEmailText } from "@/lib/exports/text";
import { buildCustomerExcel, buildInternalExcel } from "@/lib/exports/excel";
import { quoteForExportInclude } from "@/lib/exports/types";

async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Niet ingelogd");
  return session.user.id;
}

export async function createQuotes(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  // Dedupe defensively: the same line submitted twice (e.g. via URL + wizard
  // checkbox) must never produce a duplicate quote line.
  const lineIds = [...new Set(formData.getAll("lineIds").map(String))];
  const customerIds = [...new Set(formData.getAll("customerIds").map(String))];

  if (lineIds.length === 0) throw new Error("Geen productregels geselecteerd");
  if (customerIds.length === 0) throw new Error("Geen klanten geselecteerd");

  const lines = await prisma.farmOfferLine.findMany({
    where: { id: { in: lineIds } },
    include: { farmOffer: { include: { farm: true } } },
  });

  const createdQuoteIds: string[] = [];
  const skipReasons: string[] = [];

  for (const customerId of customerIds) {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    const incoterm = String(formData.get(`incoterm_${customerId}`) ?? customer.defaultIncoterm) as Incoterm;
    const currency = String(formData.get(`currency_${customerId}`) ?? customer.defaultCurrency) as CurrencyCode;
    const marginPercent = String(formData.get(`margin_${customerId}`) ?? customer.defaultMarginPercent.toString());
    // The user may override the customer's default delivery destination for
    // this specific quote; the chosen destination drives the route/rates
    // below and is what gets saved on the quote (never on the customer).
    const destinationId = (formData.get(`destination_${customerId}`) as string) || customer.destinationId;
    // Optional manual exchange-rate override for this specific quote. Empty =
    // use the current standard rate. The override never touches the global
    // exchange-rate records.
    const exchangeRateOverride = (formData.get(`exchangeRate_${customerId}`) as string)?.trim() || null;
    const exchangeRateOverrideReason = (formData.get(`exchangeRateReason_${customerId}`) as string)?.trim() || null;

    const priced: {
      line: (typeof lines)[number];
      breakdown: NonNullable<Awaited<ReturnType<typeof priceLineForCustomer>>["breakdown"]>;
      context: Awaited<ReturnType<typeof priceLineForCustomer>>["context"];
    }[] = [];

    for (const line of lines) {
      const result = await priceLineForCustomer(
        line,
        customer,
        incoterm,
        currency,
        marginPercent,
        destinationId,
        exchangeRateOverride,
      );
      if (result.breakdown) {
        priced.push({ line, breakdown: result.breakdown, context: result.context });
      } else {
        // Lines that fail validation (missing FOB, missing weight, missing
        // freight rate, incoterm not offered on this route, etc.) are
        // skipped from this quote per the spec's hard-blocker rules
        // (section 19) - the reason is collected so the user gets a
        // specific error instead of a generic "something went wrong".
        for (const issue of result.issues) {
          skipReasons.push(`${customer.companyName}: ${issue.message}`);
        }
      }
    }

    if (priced.length === 0) continue;

    const quoteNumber = await generateQuoteNumber();
    const firstOrigin = priced.find((p) => p.context.originId)?.context.originId ?? null;
    // Quote-level exchange snapshot: taken from the first converting line.
    // (Per-line snapshots below are the source of truth when a single quote
    // mixes source currencies.)
    const converting = priced.find((p) => p.breakdown.exchangeRateUsed);
    const exchangeRateUsed = converting?.breakdown;
    const exchangeRateIsManual = converting?.context.exchangeRateIsManual ?? false;
    const exchangeRateDefaultValue = converting?.context.exchangeRateDefault ?? null;

    const quote = await prisma.quote.create({
      data: {
        quoteNumber,
        customerId: customer.id,
        originId: firstOrigin,
        destinationId,
        incoterm: incoterm as never,
        currency: currency as never,
        exchangeRateBase: exchangeRateUsed ? (exchangeRateUsed.sourceCurrency as never) : null,
        exchangeRateQuote: exchangeRateUsed ? (exchangeRateUsed.targetCurrency as never) : null,
        exchangeRateValue: exchangeRateUsed ? exchangeRateUsed.exchangeRateUsed!.toString() : null,
        exchangeRateDate: exchangeRateUsed ? new Date() : null,
        exchangeRateIsManual,
        exchangeRateDefaultValue: exchangeRateIsManual ? exchangeRateDefaultValue : null,
        exchangeRateOverrideReason: exchangeRateIsManual ? exchangeRateOverrideReason : null,
        marginPercentDefault: marginPercent,
        status: QuoteStatus.CONCEPT,
        createdById: userId,
        lines: {
          create: priced.map(({ line, breakdown, context }) => ({
            farmOfferLineId: line.id,
            // Supplier snapshot per line - one quote can mix leveranciers.
            farmId: line.farmOffer.farmId,
            fobPricePerStem: breakdown.fobPricePerStem.toString(),
            sourceCurrency: line.currency,
            weightPerBoxKg: line.weightPerBoxKg,
            stemsPerBox: line.stemsPerBox!,
            // Snapshot of the freight rate actually used, so the quote stays
            // explainable even after the route's rates change later.
            freightRatePerKg: context.freightRatePerKg,
            freightRateUnit: context.freightRateUnit,
            freightPerStem: breakdown.freightPerStem.toString(),
            clearingAndInspectionPerStem: breakdown.clearingAndInspectionPerStem.toString(),
            handlingPerBox: null,
            handlingPerStem: breakdown.handlingPerStem.toString(),
            // Full additional-cost snapshot: total per stem + itemized JSON, so
            // the quote stays reproducible after route costs change later.
            additionalCostPerStem: breakdown.additionalCostPerStem.toString(),
            additionalCostsSnapshot: breakdown.additionalCosts as never,
            costPricePerStemSource: breakdown.totalCostPricePerStemSource.toString(),
            costPricePerStemQuote: breakdown.costPricePerStemTarget.toString(),
            // Per-line exchange-rate snapshot (source of truth). Null when the
            // line needed no conversion.
            exchangeRateBase: breakdown.exchangeRateUsed ? (breakdown.sourceCurrency as never) : null,
            exchangeRateQuote: breakdown.exchangeRateUsed ? (breakdown.targetCurrency as never) : null,
            exchangeRateValue: breakdown.exchangeRateUsed ? breakdown.exchangeRateUsed.toString() : null,
            marginPercent: breakdown.marginPercent.toString(),
            calculatedSellPricePerStem: breakdown.calculatedSellPricePerStemRounded.toString(),
            quantityBoxes: line.boxesAvailable ?? 1,
          })),
        },
      },
    });

    createdQuoteIds.push(quote.id);
  }

  if (createdQuoteIds.length === 0) {
    const uniqueReasons = [...new Set(skipReasons)].slice(0, 5);
    const detail =
      uniqueReasons.length > 0
        ? uniqueReasons.join("; ")
        : "controleer of FOB-prijs, gewicht, vrachttarief en wisselkoers aanwezig zijn";
    throw new Error(`Geen offerteregels konden worden berekend - ${detail}.`);
  }

  if (createdQuoteIds.length === 1) {
    redirect(`/quotes/${createdQuoteIds[0]}`);
  }
  redirect(`/quotes?justCreated=${createdQuoteIds.join(",")}`);
}

export async function overrideQuoteLinePrice(quoteLineId: string, formData: FormData): Promise<void> {
  const manualSellPricePerStem = (formData.get("manualSellPricePerStem") as string) || null;
  const overrideReason = (formData.get("overrideReason") as string) || null;

  const quoteLine = await prisma.quoteLine.update({
    where: { id: quoteLineId },
    data: {
      manualSellPricePerStem,
      isManualOverride: manualSellPricePerStem !== null,
      overrideReason,
    },
  });
  revalidatePath(`/quotes/${quoteLine.quoteId}`);
}

export async function clearQuoteLineOverride(quoteLineId: string): Promise<void> {
  const quoteLine = await prisma.quoteLine.update({
    where: { id: quoteLineId },
    data: { manualSellPricePerStem: null, isManualOverride: false, overrideReason: null },
  });
  revalidatePath(`/quotes/${quoteLine.quoteId}`);
}

export async function setQuoteStatus(quoteId: string, status: QuoteStatus): Promise<void> {
  await prisma.quote.update({ where: { id: quoteId }, data: { status } });
  revalidatePath(`/quotes/${quoteId}`);
}

export async function generateExport(quoteId: string, type: QuoteExportType): Promise<void> {
  const quote = await prisma.quote.findUniqueOrThrow({
    where: { id: quoteId },
    include: quoteForExportInclude,
  });

  if (type === QuoteExportType.WHATSAPP || type === QuoteExportType.EMAIL) {
    const content = type === QuoteExportType.WHATSAPP ? buildWhatsAppText(quote) : buildEmailText(quote);
    await prisma.quoteExport.create({ data: { quoteId, type, content } });
  } else {
    const buffer =
      type === QuoteExportType.EXCEL_CUSTOMER ? await buildCustomerExcel(quote) : await buildInternalExcel(quote);
    const fileName = `${quote.quoteNumber}-${type === QuoteExportType.EXCEL_CUSTOMER ? "klant" : "intern"}.xlsx`;
    // Excel bytes are stored in the database (fileData), not on local disk -
    // serverless hosting (Vercel) has no writable/durable filesystem outside
    // a request's own /tmp. filePath is kept only to derive the file name.
    await prisma.quoteExport.create({ data: { quoteId, type, filePath: fileName, fileData: buffer } });
  }

  if (quote.status === QuoteStatus.READY) {
    await prisma.quote.update({ where: { id: quoteId }, data: { status: QuoteStatus.EXPORTED } });
  }

  revalidatePath(`/quotes/${quoteId}`);
}
