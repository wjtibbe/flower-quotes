-- Assortment restructure (additive):
-- 1. ProductVariant gets an explicit stemLength ("lengte"), previously
--    sometimes stored in the grade column as e.g. "60 cms" / "50-70 CM".
-- 2. PackagingWeightProfile (the supplier-assortment link table) gets an
--    optional supplierCode.
-- No columns are dropped; existing offers/quotes are untouched.

-- AlterTable
ALTER TABLE "PackagingWeightProfile" ADD COLUMN     "supplierCode" TEXT;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "stemLength" TEXT;

-- Data migration: move length-like values out of grade into stemLength,
-- normalized to "NN cm" / "NN-NN cm" (lowercase, "cms" -> "cm").
UPDATE "ProductVariant"
SET "stemLength" = regexp_replace(regexp_replace(lower(trim(grade)), '\s*cms?$', ' cm'), '\s*-\s*', '-'),
    "grade" = NULL
WHERE grade ~* '^\s*[0-9]+(\s*-\s*[0-9]+)?\s*cms?\s*$';

-- DropIndex
DROP INDEX "ProductVariant_productId_variety_color_grade_treatment_key";

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_variety_stemLength_color_grade_tre_key" ON "ProductVariant"("productId", "variety", "stemLength", "color", "grade", "treatment");
