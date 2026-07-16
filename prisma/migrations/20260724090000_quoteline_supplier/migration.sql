-- Multi-supplier quotes (additive): each QuoteLine gets its own supplier
-- reference, so one quote can combine lines from several leveranciers. No
-- columns dropped or renamed; existing financial snapshots untouched.

-- AlterTable
ALTER TABLE "QuoteLine" ADD COLUMN     "farmId" TEXT;

-- CreateIndex
CREATE INDEX "QuoteLine_farmId_idx" ON "QuoteLine"("farmId");

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing quote lines derive their supplier from the farm offer
-- they were created from, so historical quotes show the right leverancier
-- without any recalculation.
UPDATE "QuoteLine" ql
SET "farmId" = fo."farmId"
FROM "FarmOfferLine" fol
JOIN "FarmOffer" fo ON fo."id" = fol."farmOfferId"
WHERE ql."farmOfferLineId" = fol."id"
  AND ql."farmId" IS NULL
  AND fo."farmId" IS NOT NULL;
