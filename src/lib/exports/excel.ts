import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import type { QuoteForExport } from "./types";

function decOrZero(value: Prisma.Decimal | null): number {
  return value ? Number(value.toString()) : 0;
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2D6A42" },
};

function styleHeaderRow(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
  });
}

/**
 * Customer-facing Excel export - product/price/logistics info only. Never
 * includes cost price, margin or internal cost breakdown (section 17/25).
 */
export async function buildCustomerExcel(quote: QuoteForExport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flower Quotes";
  const sheet = workbook.addWorksheet(`Offerte ${quote.quoteNumber}`.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 3 }],
  });

  sheet.mergeCells("A1:D1");
  sheet.getCell("A1").value = `Aanbieding ${quote.quoteNumber} - ${quote.customer.companyName}`;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A3").value = `Herkomst: ${quote.origin?.country ?? "-"}  |  Levering: ${quote.incoterm} ${
    quote.destination?.city ?? ""
  }  |  Valuta: ${quote.currency}`;
  sheet.getCell("A3").font = { italic: true };

  const headerRowIndex = 5;
  const columns = [
    "Productgroep",
    "Product",
    "Variëteit",
    "Lengte",
    "Kleur",
    "Kwaliteit",
    "Behandeling",
    "Box type",
    "Stelen/doos",
    "Dozen beschikbaar",
    "Prijs per steel",
    "Valuta",
    "Incoterm",
    "Herkomst",
    "Bestemming",
    "Opmerkingen",
  ];
  sheet.getRow(headerRowIndex).values = columns;
  styleHeaderRow(sheet.getRow(headerRowIndex));
  sheet.columns = columns.map((c) => ({ width: Math.max(14, c.length + 4) }));
  sheet.autoFilter = { from: { row: headerRowIndex, column: 1 }, to: { row: headerRowIndex, column: columns.length } };

  let r = headerRowIndex + 1;
  for (const line of quote.lines) {
    const variant = line.farmOfferLine.productVariant;
    const finalPrice = Number((line.manualSellPricePerStem ?? line.calculatedSellPricePerStem).toString());
    sheet.getRow(r).values = [
      variant?.product.productGroup ?? line.farmOfferLine.productGroupRaw ?? "",
      variant?.product.name ?? line.farmOfferLine.productGroupRaw ?? "",
      variant?.variety ?? line.farmOfferLine.varietyRaw ?? "",
      variant?.stemLength ?? "",
      variant?.color ?? line.farmOfferLine.colorRaw ?? "",
      variant?.grade ?? line.farmOfferLine.gradeRaw ?? "",
      line.farmOfferLine.treatmentRaw ?? "",
      line.farmOfferLine.boxType ?? "",
      line.stemsPerBox,
      line.farmOfferLine.boxesAvailable ?? "",
      finalPrice,
      quote.currency,
      quote.incoterm,
      quote.origin?.city ?? "",
      quote.destination?.city ?? "",
      line.farmOfferLine.notes ?? "",
    ];
    sheet.getCell(`K${r}`).numFmt = "0.00";
    r++;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Internal Excel export - full cost breakdown, margin and calculation
 * inputs, kept clearly separate from the customer version (never sent
 * externally).
 */
export async function buildInternalExcel(quote: QuoteForExport): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Flower Quotes";
  const sheet = workbook.addWorksheet("Interne calculatie", { views: [{ state: "frozen", ySplit: 1 }] });

  const columns = [
    "Product",
    "Leverancier",
    "Incoterm",
    "FOB/steel",
    "Vracht/steel",
    "Clearing & Inspection/steel",
    "Handling/steel",
    "Kostprijs/steel (bron)",
    "Wisselkoers",
    "Kostprijs/steel (offertevaluta)",
    "Marge %",
    "Berekende verkoopprijs",
    "Handmatige prijs",
    "Definitieve verkoopprijs",
  ];
  sheet.getRow(1).values = columns;
  styleHeaderRow(sheet.getRow(1));
  sheet.columns = columns.map((c) => ({ width: Math.max(16, c.length + 2) }));

  let r = 2;
  for (const line of quote.lines) {
    const variant = line.farmOfferLine.productVariant;
    const finalPrice = line.manualSellPricePerStem ?? line.calculatedSellPricePerStem;
    sheet.getRow(r).values = [
      variant
        ? [variant.product.name, variant.variety, variant.color, variant.grade, variant.stemLength]
            .filter(Boolean)
            .join(" - ")
        : line.farmOfferLine.productGroupRaw ?? "",
      line.farmOfferLine.farmOffer.farm?.name ?? "",
      quote.incoterm,
      Number(line.fobPricePerStem.toString()),
      decOrZero(line.freightPerStem),
      decOrZero(line.clearingAndInspectionPerStem),
      decOrZero(line.handlingPerStem),
      Number(line.costPricePerStemSource.toString()),
      quote.exchangeRateValue ? Number(quote.exchangeRateValue.toString()) : "",
      Number(line.costPricePerStemQuote.toString()),
      Number(line.marginPercent.toString()),
      Number(line.calculatedSellPricePerStem.toString()),
      line.manualSellPricePerStem ? Number(line.manualSellPricePerStem.toString()) : "",
      Number(finalPrice.toString()),
    ];
    r++;
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
