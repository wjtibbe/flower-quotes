-- Simplify: remove the soft-delete "active" concept everywhere. Records are
-- now either present or hard-deleted; deletion is blocked in the server
-- actions when a record is still referenced. Historical quotes snapshot their
-- own numbers, so dropping these columns never changes past quotes.

-- Drop indexes that included the active column, recreate them without it.
DROP INDEX IF EXISTS "FreightRate_routeId_active_idx";
DROP INDEX IF EXISTS "DdpCostRate_routeId_active_idx";
DROP INDEX IF EXISTS "DdpCostRate_routeId_costType_active_idx";
DROP INDEX IF EXISTS "ExchangeRate_baseCurrency_quoteCurrency_active_idx";

ALTER TABLE "User" DROP COLUMN "active";
ALTER TABLE "Farm" DROP COLUMN "active";
ALTER TABLE "Product" DROP COLUMN "active";
ALTER TABLE "ProductVariant" DROP COLUMN "active";
ALTER TABLE "PackagingWeightProfile" DROP COLUMN "active";
ALTER TABLE "Origin" DROP COLUMN "active";
ALTER TABLE "Destination" DROP COLUMN "active";
ALTER TABLE "Route" DROP COLUMN "active";
ALTER TABLE "FreightRate" DROP COLUMN "active";
ALTER TABLE "DdpCostRate" DROP COLUMN "active";
ALTER TABLE "Customer" DROP COLUMN "active";
ALTER TABLE "CustomerDestination" DROP COLUMN "active";
ALTER TABLE "ExchangeRate" DROP COLUMN "active";

CREATE INDEX "FreightRate_routeId_idx" ON "FreightRate"("routeId");
CREATE INDEX "DdpCostRate_routeId_idx" ON "DdpCostRate"("routeId");
CREATE INDEX "DdpCostRate_routeId_costType_idx" ON "DdpCostRate"("routeId", "costType");
CREATE INDEX "ExchangeRate_baseCurrency_quoteCurrency_idx" ON "ExchangeRate"("baseCurrency", "quoteCurrency");
