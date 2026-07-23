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
import { normalizeBulkIds } from "@/lib/bulkIds";
import type { ActionResult } from "@/lib/actionResult";
import { isFarmOfferLineQuotable } from "@/lib/quotes/lineGating";
import { resolveCanonicalPackaging } from "@/lib/quotes/canonicalPackaging";
import { resolveOfferLinePricingQuantity, type OfferLineUnit } from "@/lib/quotes/quantityResolution";
import { isPackagingProfileValidForSupplier } from "@/lib/import/offerLineValidation";

async function requireUserId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new Error("Niet ingelogd");
  return session.user.id;
}

/** A resolved, quote-safe packaging + quantity snapshot for one FarmOfferLine. */
interface ResolvedQuoteLineInput {
  stemsPerBox: number;
  weightPerBoxKg: string | null;
  quantityBoxes: number;
  totalStems: number;
}

/** Short, non-technical label for a line in an error message - never a Prisma id/internal detail. */
function describeLineForError(line: { varietyRaw: string | null; productGroupRaw: string | null; rawText: string }): string {
  const label = [line.productGroupRaw, line.varietyRaw].filter(Boolean).join(" ");
  return label || line.rawText.slice(0, 40);
}

/**
 * Re-reads every requested FarmOfferLine fresh from the database and
 * re-validates it server-side - the server action is leading, a
 * manipulated client can never smuggle in a DRAFT offer's line or an
 * unmatched/ambiguous line just because it once appeared in a page's HTML
 * (section 1/2 of the quote-pipeline consistency fix). Checks, per line:
 *   - the line still exists
 *   - its offer is REVIEWED and its matchStatus is one of the quotable ones
 *   - its PackagingWeightProfile (if any) belongs to the SAME supplier as
 *     the offer - a database FK cannot express that on its own
 *   - a price and currency are present
 *   - the offer's quantity/unit can be deterministically resolved to a whole
 *     number of boxes (see `resolveOfferLinePricingQuantity` - never a
 *     silent "1 box" default)
 *
 * All-or-nothing: if ANY requested line fails any of these checks, NO quote
 * is created for ANY customer and nothing is written - never a partial
 * quote built from a mix of valid and invalid lines (section 14).
 */
async function loadAndValidateQuotableLines(lineIds: string[]) {
  const lines = await prisma.farmOfferLine.findMany({
    where: { id: { in: lineIds } },
    include: { farmOffer: { include: { farm: true } }, packagingWeightProfile: true },
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const errors: string[] = [];
  const resolved = new Map<string, (typeof lines)[number] & { __resolved: ResolvedQuoteLineInput }>();

  for (const id of lineIds) {
    const line = lineById.get(id);
    if (!line) {
      errors.push("Offerregel bestaat niet meer.");
      continue;
    }
    const label = describeLineForError(line);

    const gate = isFarmOfferLineQuotable({
      offerStatus: line.farmOffer.status,
      matchStatus: line.matchStatus,
      packagingWeightProfileId: line.packagingWeightProfileId,
    });
    if (!gate.ok) {
      errors.push(`${label}: ${gate.message}`);
      continue;
    }

    if (
      line.packagingWeightProfile &&
      !isPackagingProfileValidForSupplier(line.farmOffer.farmId, line.packagingWeightProfile.farmId)
    ) {
      errors.push(`${label}: Packaging profile belongs to another supplier.`);
      continue;
    }

    if (line.fobPricePerStem == null) {
      errors.push(`${label}: FOB price is missing.`);
      continue;
    }
    if (!line.currency) {
      errors.push(`${label}: Currency is missing.`);
      continue;
    }

    const packaging = resolveCanonicalPackaging(line.packagingWeightProfile, {
      boxType: line.boxType,
      stemsPerBox: line.stemsPerBox,
      weightPerBoxKg: line.weightPerBoxKg,
    });

    const quantity = resolveOfferLinePricingQuantity({
      quantity: line.quantity != null ? Number(line.quantity.toString()) : null,
      unit: line.unit as OfferLineUnit | null,
      boxesAvailable: line.boxesAvailable,
      stemsPerBox: packaging.stemsPerBox,
    });
    if (!quantity.ok) {
      errors.push(`${label}: ${quantity.message}`);
      continue;
    }

    resolved.set(id, {
      ...line,
      __resolved: {
        stemsPerBox: quantity.stemsPerBox,
        weightPerBoxKg: packaging.weightPerBoxKg,
        quantityBoxes: quantity.quantityBoxes,
        totalStems: quantity.totalStems,
      },
    });
  }

  if (errors.length > 0) {
    const uniqueErrors = [...new Set(errors)].slice(0, 5);
    throw new Error(`Kan geen offerte maken - ${uniqueErrors.join("; ")}.`);
  }

  return resolved;
}

export async function createQuotes(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  // Dedupe defensively: the same line submitted twice (e.g. via URL + wizard
  // checkbox) must never produce a duplicate quote line.
  const lineIds = [...new Set(formData.getAll("lineIds").map(String))];
  const customerIds = [...new Set(formData.getAll("customerIds").map(String))];

  if (lineIds.length === 0) throw new Error("Geen productregels geselecteerd");
  if (customerIds.length === 0) throw new Error("Geen klanten geselecteerd");

  // Gating + quantity/packaging resolution happens once, up front, for the
  // whole batch - before any customer loop and before any write - so an
  // invalid line blocks quote creation entirely rather than silently being
  // skipped for one customer while still (partially) quoted for another.
  const resolvedLines = await loadAndValidateQuotableLines(lineIds);
  const lines = [...resolvedLines.values()];

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
        { stemsPerBox: line.__resolved.stemsPerBox, weightPerBoxKg: line.__resolved.weightPerBoxKg },
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
            // Canonical packaging snapshot, resolved once up front (profile
            // over legacy, never a guess) - frozen here forever, so the
            // quote never silently changes if the assortment profile does
            // (section 6/9/21 of the consistency fix).
            weightPerBoxKg: line.__resolved.weightPerBoxKg,
            stemsPerBox: line.__resolved.stemsPerBox,
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
            // Exact resolved quantity - never a silent "1 box" default (section 3).
            quantityBoxes: line.__resolved.quantityBoxes,
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

/**
 * Hard-deletes a single quote. A quote is always safe to remove: its lines
 * (QuoteLine) and exports (QuoteExport) both cascade on delete at the database
 * level, and nothing else references a Quote - so no orphan rows are left
 * behind. Returns a result object so the list can refresh in place and toast
 * the outcome (never a raw SQL error).
 */
export async function deleteQuote(id: string): Promise<ActionResult> {
  await requireUserId();
  const quote = await prisma.quote.findUnique({ where: { id }, select: { quoteNumber: true } });
  if (!quote) return { ok: false, message: "Deze offerte bestaat niet meer. Ververs de pagina." };

  try {
    await prisma.quote.delete({ where: { id } });
  } catch {
    return { ok: false, message: "Verwijderen is mislukt door een databasefout. Probeer het opnieuw." };
  }
  revalidatePath("/quotes");
  return { ok: true, message: `Offerte ${quote.quoteNumber} verwijderd.` };
}

/**
 * Hard-deletes every selected quote in one transaction. Same cascade safety as
 * the single delete, so this is a plain deleteMany; the count returned is the
 * number of rows actually removed.
 */
export async function bulkDeleteQuotes(ids: string[]): Promise<ActionResult> {
  await requireUserId();
  const norm = normalizeBulkIds(ids);
  if ("error" in norm) return { ok: false, message: norm.error };

  try {
    const res = await prisma.quote.deleteMany({ where: { id: { in: norm.ids } } });
    revalidatePath("/quotes");
    return { ok: true, message: `${res.count} offerte(s) verwijderd.` };
  } catch {
    return { ok: false, message: "Verwijderen is mislukt door een databasefout. Probeer het opnieuw." };
  }
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
