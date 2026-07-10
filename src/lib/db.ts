import "server-only";
import { PrismaClient } from "@prisma/client";

// Standard Next.js dev-mode singleton to avoid exhausting DB connections
// across hot reloads (each reload would otherwise create a new PrismaClient).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
