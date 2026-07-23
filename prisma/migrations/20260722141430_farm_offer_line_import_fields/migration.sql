-- CreateEnum
CREATE TYPE "OfferUnit" AS ENUM ('STEMS', 'BUNCHES', 'BOXES', 'KILOGRAMS');

-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('PER_STEM');

-- CreateEnum
CREATE TYPE "LineMatchStatus" AS ENUM ('UNMATCHED', 'AUTO_MATCHED', 'AMBIGUOUS', 'DERIVED', 'USER_LINKED');

-- AlterTable
ALTER TABLE "FarmOfferLine" ADD COLUMN     "extractedSnapshot" JSONB,
ADD COLUMN     "matchStatus" "LineMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
ADD COLUMN     "packagingWeightProfileId" TEXT,
ADD COLUMN     "priceUnit" "PriceUnit" NOT NULL DEFAULT 'PER_STEM',
ADD COLUMN     "quantity" DECIMAL(12,3),
ADD COLUMN     "stemLengthCm" INTEGER,
ADD COLUMN     "totalStems" INTEGER,
ADD COLUMN     "unit" "OfferUnit",
ADD COLUMN     "validationErrors" JSONB,
ADD COLUMN     "validationWarnings" JSONB;

-- CreateIndex
CREATE INDEX "FarmOfferLine_packagingWeightProfileId_idx" ON "FarmOfferLine"("packagingWeightProfileId");

-- AddForeignKey
ALTER TABLE "FarmOfferLine" ADD CONSTRAINT "FarmOfferLine_packagingWeightProfileId_fkey" FOREIGN KEY ("packagingWeightProfileId") REFERENCES "PackagingWeightProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
