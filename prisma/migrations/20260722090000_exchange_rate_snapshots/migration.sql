-- Exchange rates: make the screen editable/auditable and make the used rate a
-- per-line snapshot (additive only). No existing column is dropped or renamed;
-- no historical rate or financial snapshot is altered.

-- ExchangeRate: optional validity end, "laatst gewijzigd" + "gewijzigd door".
ALTER TABLE "ExchangeRate" ADD COLUMN     "effectiveTo" TIMESTAMP(3);
ALTER TABLE "ExchangeRate" ADD COLUMN     "updatedAt" TIMESTAMP(3);
ALTER TABLE "ExchangeRate" ADD COLUMN     "updatedById" TEXT;

-- Backfill updatedAt for existing rows to their createdAt, then enforce a
-- default going forward (Prisma manages @updatedAt at the app layer).
UPDATE "ExchangeRate" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "ExchangeRate" ALTER COLUMN "updatedAt" SET NOT NULL;
ALTER TABLE "ExchangeRate" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quote: manual-override transparency (never touches existing snapshots).
ALTER TABLE "Quote" ADD COLUMN     "exchangeRateIsManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Quote" ADD COLUMN     "exchangeRateDefaultValue" DECIMAL(12,6);
ALTER TABLE "Quote" ADD COLUMN     "exchangeRateOverrideReason" TEXT;

-- QuoteLine: per-line exchange-rate snapshot (source of truth). Null on legacy
-- lines and on lines that needed no conversion.
ALTER TABLE "QuoteLine" ADD COLUMN     "exchangeRateBase" "Currency";
ALTER TABLE "QuoteLine" ADD COLUMN     "exchangeRateQuote" "Currency";
ALTER TABLE "QuoteLine" ADD COLUMN     "exchangeRateValue" DECIMAL(12,6);

-- Backfill the per-line snapshot for existing quotes from the Quote-level
-- snapshot where the line's source currency differs from the quote currency,
-- so historical lines keep a readable rate instead of showing "unknown".
UPDATE "QuoteLine" ql
SET "exchangeRateBase" = q."exchangeRateBase",
    "exchangeRateQuote" = q."exchangeRateQuote",
    "exchangeRateValue" = q."exchangeRateValue"
FROM "Quote" q
WHERE ql."quoteId" = q."id"
  AND q."exchangeRateValue" IS NOT NULL
  AND ql."sourceCurrency" <> q."currency";
