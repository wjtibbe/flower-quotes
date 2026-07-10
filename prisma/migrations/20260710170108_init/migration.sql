-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SALES', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "DdpCostType" AS ENUM ('CLEARING_PER_STEM', 'INSPECTION_PER_STEM', 'HANDLING_PER_BOX');

-- CreateEnum
CREATE TYPE "Incoterm" AS ENUM ('FOB', 'CFR', 'DDP');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('USD', 'EUR');

-- CreateEnum
CREATE TYPE "SourceFileType" AS ENUM ('IMAGE', 'PDF', 'EMAIL', 'EXCEL', 'MANUAL');

-- CreateEnum
CREATE TYPE "FarmOfferStatus" AS ENUM ('DRAFT', 'REVIEWED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('CONCEPT', 'READY', 'EXPORTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QuoteExportType" AS ENUM ('WHATSAPP', 'EMAIL', 'EXCEL_CUSTOMER', 'EXCEL_INTERNAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'SALES',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Farm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "originId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Farm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmAlias" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FarmAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "productGroup" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variety" TEXT,
    "color" TEXT,
    "grade" TEXT,
    "treatment" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagingWeightProfile" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "productVariantId" TEXT NOT NULL,
    "boxType" TEXT NOT NULL,
    "stemsPerBox" INTEGER NOT NULL,
    "weightPerBoxKg" DECIMAL(10,3) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackagingWeightProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Origin" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Origin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Destination" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Destination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "originId" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreightRate" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "ratePerKg" DECIMAL(10,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreightRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DdpCostRate" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "costType" "DdpCostType" NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(10,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DdpCostRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT,
    "whatsappNumber" TEXT,
    "email" TEXT,
    "destinationId" TEXT,
    "defaultCurrency" "Currency" NOT NULL DEFAULT 'USD',
    "defaultIncoterm" "Incoterm" NOT NULL DEFAULT 'FOB',
    "defaultMarginPercent" DECIMAL(6,3) NOT NULL DEFAULT 15,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "baseCurrency" "Currency" NOT NULL,
    "quoteCurrency" "Currency" NOT NULL,
    "rate" DECIMAL(12,6) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceUpload" (
    "id" TEXT NOT NULL,
    "fileType" "SourceFileType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "rawText" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmOffer" (
    "id" TEXT NOT NULL,
    "farmId" TEXT,
    "sourceUploadId" TEXT,
    "title" TEXT,
    "offerDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "status" "FarmOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmOfferLine" (
    "id" TEXT NOT NULL,
    "farmOfferId" TEXT NOT NULL,
    "productVariantId" TEXT,
    "rawText" TEXT NOT NULL,
    "farmNameRaw" TEXT,
    "countryOfOrigin" TEXT,
    "originId" TEXT,
    "productGroupRaw" TEXT,
    "productNameRaw" TEXT,
    "varietyRaw" TEXT,
    "colorRaw" TEXT,
    "gradeRaw" TEXT,
    "treatmentRaw" TEXT,
    "boxType" TEXT,
    "boxesAvailable" INTEGER,
    "stemsPerBox" INTEGER,
    "fobPricePerStem" DECIMAL(10,4),
    "currency" "Currency" NOT NULL DEFAULT 'USD',
    "weightPerBoxKg" DECIMAL(10,3),
    "notes" TEXT,
    "extraLeadTimeHrs" INTEGER,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "confidence" "ConfidenceLevel" NOT NULL DEFAULT 'MEDIUM',
    "fieldConfidence" JSONB,
    "needsReview" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmOfferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "originId" TEXT,
    "destinationId" TEXT,
    "incoterm" "Incoterm" NOT NULL,
    "currency" "Currency" NOT NULL,
    "exchangeRateBase" "Currency",
    "exchangeRateQuote" "Currency",
    "exchangeRateValue" DECIMAL(12,6),
    "exchangeRateDate" TIMESTAMP(3),
    "marginPercentDefault" DECIMAL(6,3) NOT NULL,
    "status" "QuoteStatus" NOT NULL DEFAULT 'CONCEPT',
    "validUntil" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "farmOfferLineId" TEXT NOT NULL,
    "fobPricePerStem" DECIMAL(10,6) NOT NULL,
    "sourceCurrency" "Currency" NOT NULL,
    "weightPerBoxKg" DECIMAL(10,3),
    "stemsPerBox" INTEGER NOT NULL,
    "freightRatePerKg" DECIMAL(10,4),
    "freightPerStem" DECIMAL(12,6),
    "clearingPerStem" DECIMAL(12,6),
    "inspectionPerStem" DECIMAL(12,6),
    "handlingPerBox" DECIMAL(12,6),
    "handlingPerStem" DECIMAL(12,6),
    "costPricePerStemSource" DECIMAL(12,6) NOT NULL,
    "costPricePerStemQuote" DECIMAL(12,6) NOT NULL,
    "marginPercent" DECIMAL(6,3) NOT NULL,
    "calculatedSellPricePerStem" DECIMAL(12,6) NOT NULL,
    "manualSellPricePerStem" DECIMAL(12,6),
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "quantityBoxes" INTEGER NOT NULL,
    "warnings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteExport" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "type" "QuoteExportType" NOT NULL,
    "content" TEXT,
    "filePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuoteExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Farm_originId_idx" ON "Farm"("originId");

-- CreateIndex
CREATE UNIQUE INDEX "FarmAlias_farmId_alias_key" ON "FarmAlias"("farmId", "alias");

-- CreateIndex
CREATE INDEX "Product_productGroup_idx" ON "Product"("productGroup");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_productId_alias_key" ON "ProductAlias"("productId", "alias");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_variety_color_grade_treatment_key" ON "ProductVariant"("productId", "variety", "color", "grade", "treatment");

-- CreateIndex
CREATE INDEX "PackagingWeightProfile_farmId_productVariantId_boxType_stem_idx" ON "PackagingWeightProfile"("farmId", "productVariantId", "boxType", "stemsPerBox");

-- CreateIndex
CREATE UNIQUE INDEX "Origin_city_country_key" ON "Origin"("city", "country");

-- CreateIndex
CREATE UNIQUE INDEX "Destination_city_country_key" ON "Destination"("city", "country");

-- CreateIndex
CREATE UNIQUE INDEX "Route_originId_destinationId_key" ON "Route"("originId", "destinationId");

-- CreateIndex
CREATE INDEX "FreightRate_routeId_active_idx" ON "FreightRate"("routeId", "active");

-- CreateIndex
CREATE INDEX "DdpCostRate_routeId_costType_active_idx" ON "DdpCostRate"("routeId", "costType", "active");

-- CreateIndex
CREATE INDEX "Customer_destinationId_idx" ON "Customer"("destinationId");

-- CreateIndex
CREATE INDEX "ExchangeRate_baseCurrency_quoteCurrency_active_idx" ON "ExchangeRate"("baseCurrency", "quoteCurrency", "active");

-- CreateIndex
CREATE INDEX "FarmOffer_farmId_idx" ON "FarmOffer"("farmId");

-- CreateIndex
CREATE INDEX "FarmOffer_status_idx" ON "FarmOffer"("status");

-- CreateIndex
CREATE INDEX "FarmOfferLine_farmOfferId_idx" ON "FarmOfferLine"("farmOfferId");

-- CreateIndex
CREATE INDEX "FarmOfferLine_productVariantId_idx" ON "FarmOfferLine"("productVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_quoteNumber_key" ON "Quote"("quoteNumber");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Quote_status_idx" ON "Quote"("status");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

-- CreateIndex
CREATE INDEX "QuoteExport_quoteId_idx" ON "QuoteExport"("quoteId");

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Origin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmAlias" ADD CONSTRAINT "FarmAlias_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingWeightProfile" ADD CONSTRAINT "PackagingWeightProfile_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagingWeightProfile" ADD CONSTRAINT "PackagingWeightProfile_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Origin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Route" ADD CONSTRAINT "Route_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreightRate" ADD CONSTRAINT "FreightRate_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DdpCostRate" ADD CONSTRAINT "DdpCostRate_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_destinationId_fkey" FOREIGN KEY ("destinationId") REFERENCES "Destination"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmOffer" ADD CONSTRAINT "FarmOffer_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmOffer" ADD CONSTRAINT "FarmOffer_sourceUploadId_fkey" FOREIGN KEY ("sourceUploadId") REFERENCES "SourceUpload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmOffer" ADD CONSTRAINT "FarmOffer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmOfferLine" ADD CONSTRAINT "FarmOfferLine_farmOfferId_fkey" FOREIGN KEY ("farmOfferId") REFERENCES "FarmOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmOfferLine" ADD CONSTRAINT "FarmOfferLine_productVariantId_fkey" FOREIGN KEY ("productVariantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmOfferLine" ADD CONSTRAINT "FarmOfferLine_originId_fkey" FOREIGN KEY ("originId") REFERENCES "Origin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_farmOfferLineId_fkey" FOREIGN KEY ("farmOfferLineId") REFERENCES "FarmOfferLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteExport" ADD CONSTRAINT "QuoteExport_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;
