import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { seedDatabase } from "@/lib/seedData";

/**
 * One-time setup endpoint: loads demo users/farms/customers/offers into a
 * fresh production database, without needing a terminal or database client.
 * Protected by a shared secret (ADMIN_SEED_TOKEN) so it can't be triggered
 * by a random visitor. Safe to call more than once - it's a no-op once
 * users already exist (see seedDatabase).
 *
 * Usage: visit /api/admin/seed?token=<ADMIN_SEED_TOKEN> once after the
 * first deploy.
 */
export async function GET(req: Request) {
  const token = process.env.ADMIN_SEED_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "ADMIN_SEED_TOKEN is niet ingesteld in de environment variables." },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  if (searchParams.get("token") !== token) {
    return NextResponse.json({ error: "Ongeldig token." }, { status: 401 });
  }

  try {
    const message = await seedDatabase(prisma);
    return NextResponse.json({ message });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Onbekende fout tijdens seed." },
      { status: 500 },
    );
  }
}
