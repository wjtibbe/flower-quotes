-- Routes & freight foundation (additive):
-- 1. Origin/Destination get optional locationName + code (IATA/location code).
-- 2. Route gets a transportType (default AIR - everything existing is air freight).
--    Uniqueness widens from (origin, destination) to (origin, destination, transportType).
-- 3. FreightRate gets a rateUnit (default PER_KG - matches all existing rates;
--    the legacy "ratePerKg" column name is kept and now simply holds the amount).
-- 4. QuoteLine gets freightRateUnit so new snapshots record which unit was used.
-- No columns or tables are dropped; existing quotes are untouched.

-- CreateEnum
CREATE TYPE "TransportType" AS ENUM ('AIR', 'ROAD', 'LOCAL_DELIVERY', 'SEA');

-- CreateEnum
CREATE TYPE "FreightRateUnit" AS ENUM ('PER_KG', 'PER_BOX', 'PER_STEM');

-- AlterTable
ALTER TABLE "Destination" ADD COLUMN     "code" TEXT,
ADD COLUMN     "locationName" TEXT;

-- AlterTable
ALTER TABLE "FreightRate" ADD COLUMN     "rateUnit" "FreightRateUnit" NOT NULL DEFAULT 'PER_KG';

-- AlterTable
ALTER TABLE "Origin" ADD COLUMN     "code" TEXT,
ADD COLUMN     "locationName" TEXT;

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "freightRateUnit" "FreightRateUnit";

-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "transportType" "TransportType" NOT NULL DEFAULT 'AIR';

-- DropIndex
DROP INDEX "Route_originId_destinationId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Route_originId_destinationId_transportType_key" ON "Route"("originId", "destinationId", "transportType");

-- Data backfill: IATA codes for the known seeded cities (no-op elsewhere).
UPDATE "Origin" SET code = 'UIO' WHERE code IS NULL AND lower(city) = 'quito';
UPDATE "Origin" SET code = 'BOG' WHERE code IS NULL AND lower(city) = 'bogotá';
UPDATE "Destination" SET code = 'DOH' WHERE code IS NULL AND lower(city) = 'doha';
UPDATE "Destination" SET code = 'DXB' WHERE code IS NULL AND lower(city) = 'dubai';
UPDATE "Destination" SET code = 'AMS' WHERE code IS NULL AND lower(city) = 'amsterdam';
