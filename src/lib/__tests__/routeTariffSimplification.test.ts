import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * These tests read the actual applied migration SQL and Prisma schema
 * (rather than re-implementing the logic in TypeScript) so they can never
 * drift from what really runs against the database - same pattern as
 * additionalCostTypeBackfillMigration.test.ts.
 */
const migrationSql = fs.readFileSync(
  path.resolve(__dirname, "../../../prisma/migrations/20260806090000_route_current_tariff_and_cost/migration.sql"),
  "utf-8",
);
const schemaPrisma = fs.readFileSync(path.resolve(__dirname, "../../../prisma/schema.prisma"), "utf-8");
const routesPageTsx = fs.readFileSync(
  path.resolve(__dirname, "../../app/(app)/routes/page.tsx"),
  "utf-8",
);

describe("1: a route has only one freight tariff (schema-enforced)", () => {
  it("FreightRate.routeId is @unique in the Prisma schema", () => {
    const freightRateModel = schemaPrisma.match(/model FreightRate \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(freightRateModel).toMatch(/routeId\s+String\s+@unique/);
  });

  it("the migration creates a unique index on FreightRate(routeId)", () => {
    expect(migrationSql).toMatch(/CREATE UNIQUE INDEX "FreightRate_routeId_key" ON "FreightRate"\("routeId"\)/);
  });
});

describe("6: one additional cost per route + additionalCostType (schema-enforced)", () => {
  it("DdpCostRate has @@unique([routeId, additionalCostTypeId]) in the Prisma schema", () => {
    const ddpCostRateModel = schemaPrisma.match(/model DdpCostRate \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(ddpCostRateModel).toMatch(/@@unique\(\[routeId, additionalCostTypeId\]\)/);
  });

  it("the migration creates a unique index on DdpCostRate(routeId, additionalCostTypeId)", () => {
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX "DdpCostRate_routeId_additionalCostTypeId_key" ON "DdpCostRate"\("routeId", "additionalCostTypeId"\)/,
    );
  });
});

describe("5: validFrom/validTo columns no longer exist at all (schema-enforced)", () => {
  it("FreightRate has no effectiveFrom/effectiveTo field", () => {
    const freightRateModel = schemaPrisma.match(/model FreightRate \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(freightRateModel).not.toMatch(/effectiveFrom/);
    expect(freightRateModel).not.toMatch(/effectiveTo/);
  });

  it("DdpCostRate has no effectiveFrom/effectiveTo field", () => {
    const ddpCostRateModel = schemaPrisma.match(/model DdpCostRate \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(ddpCostRateModel).not.toMatch(/effectiveFrom/);
    expect(ddpCostRateModel).not.toMatch(/effectiveTo/);
  });

  it("the migration actually drops both columns from both tables", () => {
    expect(migrationSql).toMatch(/ALTER TABLE "FreightRate" DROP COLUMN "effectiveFrom"/);
    expect(migrationSql).toMatch(/ALTER TABLE "FreightRate" DROP COLUMN "effectiveTo"/);
    expect(migrationSql).toMatch(/ALTER TABLE "DdpCostRate" DROP COLUMN "effectiveFrom"/);
    expect(migrationSql).toMatch(/ALTER TABLE "DdpCostRate" DROP COLUMN "effectiveTo"/);
  });
});

describe("11: migration/backfill chooses the current value safely (deterministic, not arbitrary)", () => {
  it("FreightRate collapse prefers a currently-valid row, then newest effectiveFrom, then newest updatedAt, then highest id", () => {
    const freightBlock = migrationSql.match(/WITH ranked AS \(\s*SELECT "id",[\s\S]*?FROM "FreightRate"\s*\)\s*DELETE FROM "FreightRate"[\s\S]*?;/)?.[0] ?? "";
    expect(freightBlock).toMatch(/PARTITION BY "routeId"/);
    expect(freightBlock).toMatch(/"effectiveFrom" DESC/);
    expect(freightBlock).toMatch(/"updatedAt" DESC/);
    expect(freightBlock).toMatch(/"id" DESC/);
    expect(freightBlock).toMatch(/rn > 1/);
  });

  it("DdpCostRate collapse uses the same ranking, partitioned per (routeId, additionalCostTypeId)", () => {
    const ddpBlock = migrationSql.match(/WITH ranked AS \(\s*SELECT "id",[\s\S]*?FROM "DdpCostRate"\s*\)\s*DELETE FROM "DdpCostRate"[\s\S]*?;/)?.[0] ?? "";
    expect(ddpBlock).toMatch(/PARTITION BY "routeId", COALESCE\("additionalCostTypeId", "id"\)/);
    expect(ddpBlock).toMatch(/"effectiveFrom" DESC/);
    expect(ddpBlock).toMatch(/rn > 1/);
  });

  it("legacy rows with no additionalCostTypeId are never merged with each other (each gets its own partition via id)", () => {
    // COALESCE(additionalCostTypeId, id) means a null-typed row's partition
    // key is its own unique id - it can never collide/merge with another
    // null-typed row.
    expect(migrationSql).toMatch(/COALESCE\("additionalCostTypeId", "id"\)/);
  });
});

describe("12: conflicting duplicate records are reported, not silently merged", () => {
  it("reports a FreightRate conflict via RAISE NOTICE before collapsing, for routes with more than one currently-valid tied row", () => {
    expect(migrationSql).toMatch(/RAISE NOTICE 'FreightRate conflict:/);
    expect(migrationSql).toMatch(/HAVING COUNT\(\*\) > 1/);
  });

  it("reports a DdpCostRate conflict via RAISE NOTICE before collapsing", () => {
    expect(migrationSql).toMatch(/RAISE NOTICE 'DdpCostRate conflict:/);
  });

  it("the conflict report never averages/merges values - it only ever picks one deterministic survivor", () => {
    expect(migrationSql).toMatch(/one was chosen deterministically/);
    expect(migrationSql).not.toMatch(/AVG\(/i);
    expect(migrationSql).not.toMatch(/SUM\(/i);
  });
});

describe("10: historical quotes remain unchanged", () => {
  it("the migration never runs a DDL/DML statement against the QuoteLine table (mentioning it in a comment is fine - the point is it's never altered/updated/deleted)", () => {
    expect(migrationSql).not.toMatch(/(ALTER TABLE|UPDATE|DELETE FROM|DROP TABLE|INSERT INTO)\s+"QuoteLine"/i);
  });

  it("QuoteLine snapshots freight/additional-cost values onto its own columns rather than referencing FreightRate/DdpCostRate by id", () => {
    const quoteLineModel = schemaPrisma.match(/model QuoteLine \{[\s\S]*?\n\}/)?.[0] ?? "";
    // Its own decimal snapshot columns exist...
    expect(quoteLineModel).toMatch(/freightRatePerKg\s+Decimal/);
    expect(quoteLineModel).toMatch(/additionalCostsSnapshot\s+Json/);
    // ...and there is no foreign key relation to FreightRate/DdpCostRate at all.
    expect(quoteLineModel).not.toMatch(/FreightRate\s+FreightRate/);
    expect(quoteLineModel).not.toMatch(/DdpCostRate\s+DdpCostRate/);
  });
});

describe("13/14: Routes UI no longer renders validity/date fields or tariff history", () => {
  it("13: no 'Geldig vanaf'/'Geldig tot' date inputs anywhere on the page", () => {
    expect(routesPageTsx).not.toMatch(/Geldig vanaf/);
    expect(routesPageTsx).not.toMatch(/Geldig tot/);
    expect(routesPageTsx).not.toMatch(/name="effectiveFrom"/);
    expect(routesPageTsx).not.toMatch(/name="effectiveTo"/);
    expect(routesPageTsx).not.toMatch(/type="date"/);
  });

  it("14: no 'Tariefgeschiedenis' section or per-tariff delete-from-history row", () => {
    expect(routesPageTsx).not.toMatch(/Tariefgeschiedenis/);
    expect(routesPageTsx).not.toMatch(/deleteFreightRate/);
  });

  it("14: no 'in gebruik' status badge (meaningless once every shown row already IS current)", () => {
    expect(routesPageTsx).not.toMatch(/in gebruik/);
  });

  it("the freight tariff section uses the compact save form, not an add-to-history form", () => {
    expect(routesPageTsx).toMatch(/saveFreightRate/);
    expect(routesPageTsx).toMatch(/Vrachttarief/);
  });
});
