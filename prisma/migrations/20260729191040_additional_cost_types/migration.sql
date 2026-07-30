-- AlterTable
ALTER TABLE "DdpCostRate" ADD COLUMN     "additionalCostTypeId" TEXT;

-- CreateTable
CREATE TABLE "AdditionalCostType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "category" "CostCategory" NOT NULL,
    "defaultUnit" "CostRateUnit" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdditionalCostType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdditionalCostType_normalizedName_key" ON "AdditionalCostType"("normalizedName");

-- CreateIndex
CREATE INDEX "DdpCostRate_additionalCostTypeId_idx" ON "DdpCostRate"("additionalCostTypeId");

-- AddForeignKey
ALTER TABLE "DdpCostRate" ADD CONSTRAINT "DdpCostRate_additionalCostTypeId_fkey" FOREIGN KEY ("additionalCostTypeId") REFERENCES "AdditionalCostType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
