-- CreateTable
CREATE TABLE "SupplierLineMapping" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "normalizedSource" TEXT NOT NULL,
    "rawSource" TEXT NOT NULL,
    "packagingWeightProfileId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "timesUsed" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierLineMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierLineMapping_farmId_idx" ON "SupplierLineMapping"("farmId");

-- CreateIndex
CREATE INDEX "SupplierLineMapping_packagingWeightProfileId_idx" ON "SupplierLineMapping"("packagingWeightProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierLineMapping_farmId_normalizedSource_key" ON "SupplierLineMapping"("farmId", "normalizedSource");

-- AddForeignKey
ALTER TABLE "SupplierLineMapping" ADD CONSTRAINT "SupplierLineMapping_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierLineMapping" ADD CONSTRAINT "SupplierLineMapping_packagingWeightProfileId_fkey" FOREIGN KEY ("packagingWeightProfileId") REFERENCES "PackagingWeightProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierLineMapping" ADD CONSTRAINT "SupplierLineMapping_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
