-- Business rule: routes no longer use freight-tariff/additional-cost
-- validity periods or history. Each route keeps exactly one CURRENT
-- FreightRate row, and exactly one CURRENT DdpCostRate row per
-- additionalCostType. This migration deterministically collapses any
-- existing multi-row/history data down to that shape before adding the
-- uniqueness constraints that enforce it going forward, and reports (via
-- RAISE NOTICE) any route/type where more than one row was genuinely tied
-- for "current" so it can be reviewed - it never silently merges conflicting
-- values, it only ever picks one deterministic survivor per group.
--
-- Historical quotes are entirely unaffected: QuoteLine snapshots the
-- freight/additional-cost values it used onto its own columns at creation
-- time (see QuoteLine.freightRatePerKg/additionalCostsSnapshot) rather than
-- referencing these rows by id, so deleting/collapsing rows here can never
-- change a past quote's numbers.

-- ---------------------------------------------------------------------------
-- 1. Report conflicts BEFORE collapsing anything, so they're visible in the
--    migration's own log output even though the collapse below is fully
--    deterministic and always completes.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT "routeId", COUNT(*) AS cnt, "effectiveFrom"
    FROM "FreightRate"
    WHERE "effectiveFrom" <= now() AND ("effectiveTo" IS NULL OR "effectiveTo" >= now())
    GROUP BY "routeId", "effectiveFrom"
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'FreightRate conflict: routeId=% has % currently-valid rows tied at effectiveFrom=% - one was chosen deterministically (newest updatedAt, then highest id), review the others were not silently averaged/merged.',
      rec."routeId", rec.cnt, rec."effectiveFrom";
  END LOOP;

  FOR rec IN
    SELECT "routeId", "additionalCostTypeId", COUNT(*) AS cnt, "effectiveFrom"
    FROM "DdpCostRate"
    WHERE "additionalCostTypeId" IS NOT NULL
      AND "effectiveFrom" <= now() AND ("effectiveTo" IS NULL OR "effectiveTo" >= now())
    GROUP BY "routeId", "additionalCostTypeId", "effectiveFrom"
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'DdpCostRate conflict: routeId=% additionalCostTypeId=% has % currently-valid rows tied at effectiveFrom=% - one was chosen deterministically (newest updatedAt, then highest id), review the others were not silently averaged/merged.',
      rec."routeId", rec."additionalCostTypeId", rec.cnt, rec."effectiveFrom";
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Collapse FreightRate to one row per route: prefer a currently-valid row
--    (effectiveFrom <= now, effectiveTo null or in the future) over an
--    expired/future-dated one, then newest effectiveFrom, then newest
--    updatedAt, then highest id as the final deterministic tiebreak - this
--    reproduces exactly the selection the app itself used at query time
--    before this migration, so the "current" value never changes as a side
--    effect of collapsing history.
-- ---------------------------------------------------------------------------

WITH ranked AS (
  SELECT "id",
    ROW_NUMBER() OVER (
      PARTITION BY "routeId"
      ORDER BY
        CASE WHEN "effectiveFrom" <= now() AND ("effectiveTo" IS NULL OR "effectiveTo" >= now()) THEN 0 ELSE 1 END,
        "effectiveFrom" DESC,
        "updatedAt" DESC,
        "id" DESC
    ) AS rn
  FROM "FreightRate"
)
DELETE FROM "FreightRate" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

-- ---------------------------------------------------------------------------
-- 3. Collapse DdpCostRate to one row per (route, additionalCostType), same
--    ranking rule. Legacy rows with a null additionalCostTypeId are left
--    untouched (each is its own partition, via id) - they were already
--    invisible to pricing/the UI before this change and stay that way; they
--    are never candidates for "current" and never conflict with each other.
-- ---------------------------------------------------------------------------

WITH ranked AS (
  SELECT "id",
    ROW_NUMBER() OVER (
      PARTITION BY "routeId", COALESCE("additionalCostTypeId", "id")
      ORDER BY
        CASE WHEN "effectiveFrom" <= now() AND ("effectiveTo" IS NULL OR "effectiveTo" >= now()) THEN 0 ELSE 1 END,
        "effectiveFrom" DESC,
        "updatedAt" DESC,
        "id" DESC
    ) AS rn
  FROM "DdpCostRate"
)
DELETE FROM "DdpCostRate" WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1);

-- ---------------------------------------------------------------------------
-- 4. Drop the now-meaningless validity columns and enforce "one current row"
--    going forward.
-- ---------------------------------------------------------------------------

ALTER TABLE "FreightRate" DROP COLUMN "effectiveFrom";
ALTER TABLE "FreightRate" DROP COLUMN "effectiveTo";
DROP INDEX IF EXISTS "FreightRate_routeId_idx";
CREATE UNIQUE INDEX "FreightRate_routeId_key" ON "FreightRate"("routeId");

ALTER TABLE "DdpCostRate" DROP COLUMN "effectiveFrom";
ALTER TABLE "DdpCostRate" DROP COLUMN "effectiveTo";
CREATE UNIQUE INDEX "DdpCostRate_routeId_additionalCostTypeId_key" ON "DdpCostRate"("routeId", "additionalCostTypeId");
