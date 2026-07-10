import type { Prisma } from "@prisma/client";

export const quoteForExportInclude = {
  customer: { include: { destination: true } },
  origin: true,
  destination: true,
  lines: {
    include: {
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
