-- Customers & destinations (additive): a customer may link several of the
-- existing Destination locations (no second location system), one marked as
-- default. Customer.destinationId is kept and mirrored from the default
-- CustomerDestination row so all existing pricing/export code that reads it
-- keeps working unchanged. No columns or tables dropped; existing quotes
-- and QuoteLines untouched.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "country" TEXT,
ADD COLUMN     "invoiceAddress" TEXT;

-- CreateTable
CREATE TABLE "CustomerDestination" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDestination_customerId_destinationId_key" ON "CustomerDestination"("customerId", "destinationId");

-- CreateIndex
CREATE INDEX "CustomerDestination_customerId_idx" ON "CustomerDestination"("customerId");

-- CreateIndex
CREATE INDEX "CustomerDestination_destinationId_idx" ON "CustomerDestination"("destinationId");

-- AddForeignKey
ALTER TABLE "CustomerDestination" ADD CONSTRAINT "CustomerDestination_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDestination" ADD CONSTRAINT "CustomerDestination_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing customer with a destinationId gets a matching
-- CustomerDestination row marked as the default, so multi-destination
-- support is additive and no existing customer loses its destination.
INSERT INTO "CustomerDestination" ("id", "customerId", "destinationId", "isDefault", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), "id", "destinationId", true, true, "createdAt", now()
FROM "Customer"
WHERE "destinationId" IS NOT NULL;
