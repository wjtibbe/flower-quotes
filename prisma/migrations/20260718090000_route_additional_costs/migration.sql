-- Route additional costs (additive): generalize DdpCostRate into a flexible
-- per-route cost line (name + category + rateUnit) while keeping the legacy
-- costType column and all existing rows. QuoteLine gets a per-stem total and
-- a JSON breakdown so new quotes snapshot the full cost detail.
-- No columns or tables dropped; existing QuoteLines untouched.

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('CLEARING', 'INSPECTION', 'IMPORT', 'HANDLING', 'LOCAL_DELIVERY', 'DOCUMENTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "CostRateUnit" AS ENUM ('PER_STEM', 'PER_KG', 'PER_BOX', 'FLAT');

-- AlterTable
ALTER TABLE "DdpCostRate" ADD COLUMN     "category" "CostCategory",
ADD COLUMN     "name" TEXT,
ADD COLUMN     "rateUnit" "CostRateUnit",
ALTER COLUMN "costType" DROP NOT NULL;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "additionalCostPerStem" DECIMAL(12,6),
ADD COLUMN     "additionalCostsSnapshot" JSONB;

-- CreateIndex
CREATE INDEX "DdpCostRate_routeId_active_idx" ON "DdpCostRate"("routeId", "active");

-- Backfill name/category/rateUnit on existing rows from the legacy costType.
UPDATE "DdpCostRate"
SET name = 'Clearing & inspection', category = 'CLEARING', "rateUnit" = 'PER_STEM'
WHERE category IS NULL AND "costType" = 'CLEARING_AND_INSPECTION_PER_STEM';

UPDATE "DdpCostRate"
SET name = 'Clearing', category = 'CLEARING', "rateUnit" = 'PER_STEM'
WHERE category IS NULL AND "costType" = 'CLEARING_PER_STEM';

UPDATE "DdpCostRate"
SET name = 'Inspection', category = 'INSPECTION', "rateUnit" = 'PER_STEM'
WHERE category IS NULL AND "costType" = 'INSPECTION_PER_STEM';

UPDATE "DdpCostRate"
SET name = 'Handling', category = 'HANDLING', "rateUnit" = 'PER_BOX'
WHERE category IS NULL AND "costType" = 'HANDLING_PER_BOX';
