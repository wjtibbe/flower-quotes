import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * These tests read the actual applied backfill migration SQL (rather than a
 * re-implementation in TypeScript) so they can never drift from what really
 * ran against the database - see prisma/migrations/20260729191100_seed_backfill_additional_cost_types.
 */
const migrationSql = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../prisma/migrations/20260729191100_seed_backfill_additional_cost_types/migration.sql",
  ),
  "utf-8",
);

describe("additional cost type backfill migration", () => {
  it("13: Clearing, Inklaring, Customs clearance and Douane all map to the single canonical 'clearing' type", () => {
    const clearingBlock = migrationSql.match(/where t\."normalizedName" = 'clearing'[\s\S]*?;/)?.[0] ?? "";
    expect(clearingBlock).toMatch(/'clearing'/);
    expect(clearingBlock).toMatch(/'inklaring'/);
    expect(clearingBlock).toMatch(/'customs clearance'/);
    expect(clearingBlock).toMatch(/'douane'/);
  });

  it("14: Handling, Handling fee and Afhandeling all map to the single canonical 'handling' type", () => {
    const handlingBlock = migrationSql.match(/where t\."normalizedName" = 'handling'[\s\S]*?;/)?.[0] ?? "";
    expect(handlingBlock).toMatch(/'handling'/);
    expect(handlingBlock).toMatch(/'handling fee'/);
    expect(handlingBlock).toMatch(/'afhandeling'/);
  });

  it("Inspection, Inspectie and Quality inspection all map to the single canonical 'inspection' type", () => {
    const inspectionBlock = migrationSql.match(/where t\."normalizedName" = 'inspection'[\s\S]*?;/)?.[0] ?? "";
    expect(inspectionBlock).toMatch(/'inspection'/);
    expect(inspectionBlock).toMatch(/'inspectie'/);
    expect(inspectionBlock).toMatch(/'quality inspection'/);
  });

  it("17: every seeding insert is guarded with ON CONFLICT DO NOTHING on the unique normalizedName, so re-running never creates duplicates", () => {
    const inserts = migrationSql.match(/insert into "AdditionalCostType"[\s\S]*?on conflict \("normalizedName"\) do nothing;/g) ?? [];
    // The 3 canonical seeds + the 1 auto-create-from-unmatched-data statement.
    expect(inserts.length).toBe(2);
    for (const stmt of inserts) {
      expect(stmt).toMatch(/on conflict \("normalizedName"\) do nothing;/);
    }
  });

  it("17: every backfill update only touches rows where additionalCostTypeId is still null, so re-running is a no-op", () => {
    const updates = migrationSql.match(/update "DdpCostRate"[\s\S]*?;/g) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const stmt of updates) {
      expect(stmt).toMatch(/r\."additionalCostTypeId" is null/);
    }
  });
});
