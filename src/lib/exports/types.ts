import type { Prisma } from "@prisma/client";

export const quoteForExportInclude = {
  customer: { include: { destination: true } },
  origin: true,
  destination: true,
  lines: {
    include: {
      // Supplier snapshot on the line itself (multi-supplier quotes); the
      // farmOffer.farm path stays as fallback for legacy lines.
      farm: true,
      farmOfferLine: {
        include: {
          productVariant: { include: { product: true } },
          farmOffer: { include: { farm: true } },
        },
      },
    },
  },
} satisfies Prisma.QuoteInclude;

export type QuoteForExport = Prisma.QuoteGetPayload<{ include: typeof quoteForExportInclude }>;
export type QuoteLineForExport = QuoteForExport["lines"][number];
