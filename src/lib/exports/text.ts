import type { QuoteForExport, QuoteLineForExport } from "./types";

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€" };
const INCOTERM_LABEL: Record<string, string> = { FOB: "FOB", CFR: "C&F", DDP: "DDP" };

function finalPrice(line: QuoteLineForExport): string {
  const price = line.manualSellPricePerStem ?? line.calculatedSellPricePerStem;
  return Number(price.toString()).toFixed(2);
}

function productLabel(line: QuoteLineForExport): string {
  const v = line.farmOfferLine.productVariant;
  const base = v
    ? [v.color, v.variety, v.grade, v.stemLength].filter(Boolean).join(" ") || v.product.name
    : line.farmOfferLine.productGroupRaw ?? line.farmOfferLine.rawText.slice(0, 40);

  const treatment = line.farmOfferLine.treatmentRaw;
  if (treatment && treatment.toLowerCase() !== "normal") {
    return `${base} (${treatment})`;
  }
  return base;
}

function productGroupLabel(line: QuoteLineForExport): string {
  return line.farmOfferLine.productVariant?.product.name ?? line.farmOfferLine.productGroupRaw ?? "Overig";
}

function groupLinesByProductGroup(quote: QuoteForExport): Map<string, QuoteLineForExport[]> {
  const groups = new Map<string, QuoteLineForExport[]>();
  for (const line of quote.lines) {
    const key = productGroupLabel(line);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(line);
  }
  return groups;
}

function originLabel(quote: QuoteForExport): string {
  return quote.origin ? `${quote.origin.country}` : "-";
}

function deliveryLabel(quote: QuoteForExport): string {
  const incoterm = INCOTERM_LABEL[quote.incoterm] ?? quote.incoterm;
  return quote.destination ? `${incoterm} ${quote.destination.city}` : incoterm;
}

function validUntilLabel(quote: QuoteForExport): string {
  return quote.validUntil ? quote.validUntil.toLocaleDateString("nl-NL") : "nader te bepalen";
}

/**
 * Builds a compact, professional WhatsApp message from quote data - see
 * spec section 15 for the target format. Never includes cost price or
 * margin - customer-facing exports only ever show the final sell price.
 */
export function buildWhatsAppText(quote: QuoteForExport): string {
  const symbol = CURRENCY_SYMBOL[quote.currency] ?? quote.currency;
  const groups = groupLinesByProductGroup(quote);

  const lines: string[] = [];
  lines.push(`*Fresh Offer - ${quote.quoteNumber}*`);
  lines.push(`Origin: ${originLabel(quote)}`);
  lines.push(`Delivery: ${deliveryLabel(quote)}`);
  lines.push(`Currency: ${quote.currency}`);
  lines.push("");

  for (const [group, groupLines] of groups) {
    lines.push(`*${group}*`);
    for (const line of groupLines) {
      const stemsInfo = `${line.stemsPerBox} stems/${line.farmOfferLine.boxType ?? "box"}`;
      lines.push(`• ${productLabel(line)} - ${stemsInfo} - ${symbol}${finalPrice(line)} per stem`);
    }
    lines.push("");
  }

  lines.push("Availability subject to confirmation.");
  lines.push(`Prices valid until ${validUntilLabel(quote)}.`);

  return lines.join("\n").trim();
}

/** Builds a professional email text using the same underlying quote data as the WhatsApp export. */
export function buildEmailText(quote: QuoteForExport): string {
  const symbol = CURRENCY_SYMBOL[quote.currency] ?? quote.currency;
  const groups = groupLinesByProductGroup(quote);

  const lines: string[] = [];
  lines.push(`Onderwerp: Bloemenaanbieding ${quote.quoteNumber} - ${deliveryLabel(quote)}`);
  lines.push("");
  lines.push(`Beste ${quote.customer.contactName ?? quote.customer.companyName},`);
  lines.push("");
  lines.push(
    `Hierbij ontvangt u onze actuele aanbieding (${quote.quoteNumber}), oorsprong ${originLabel(quote)}, levering ${deliveryLabel(
      quote,
    )}, prijzen in ${quote.currency}.`,
  );
  lines.push("");

  for (const [group, groupLines] of groups) {
    lines.push(`${group}:`);
    for (const line of groupLines) {
      const stemsInfo = `${line.stemsPerBox} stelen/${line.farmOfferLine.boxType ?? "doos"}`;
      lines.push(`  - ${productLabel(line)} - ${stemsInfo} - ${symbol}${finalPrice(line)} per steel`);
    }
    lines.push("");
  }

  lines.push(`Beschikbaarheid onder voorbehoud. Prijzen geldig tot ${validUntilLabel(quote)}.`);
  lines.push("");
  lines.push("Met vriendelijke groet,");
  lines.push("Flower Quotes");

  return lines.join("\n").trim();
}
