import "server-only";
import { prisma } from "@/lib/db";

/** Generates a unique, human-readable quote number like "Q-20260710-0007". */
export async function generateQuoteNumber(): Promise<string> {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const countToday = await prisma.quote.count({
    where: { quoteNumber: { startsWith: `Q-${datePart}-` } },
  });
  const seq = String(countToday + 1).padStart(4, "0");
  return `Q-${datePart}-${seq}`;
}
